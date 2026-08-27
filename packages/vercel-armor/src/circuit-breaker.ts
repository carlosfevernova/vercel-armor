import { type ArmorEventHandler, safeEmit } from "./events.js";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** Optional name — surfaced in events for multi-breaker dashboards. */
  name?: string;
  /** Consecutive failures within `windowMs` that trip the breaker. Default 3. */
  failThreshold?: number;
  /** Sliding window in ms for counting failures. Default 60_000. */
  windowMs?: number;
  /** How long the breaker stays fully open before transitioning to half-open. Default 60_000. */
  cooldownMs?: number;
  /** Injectable clock — useful for deterministic tests. */
  now?: () => number;
  /** Observability hook. Fired for every state transition. Must not throw. */
  onEvent?: ArmorEventHandler;
}

export interface CircuitCheckResult {
  state: CircuitState;
  /** `true` when state is `"open"`. Kept for backward-compat with v0.1. */
  open: boolean;
  /** ms until cooldown expires. Only present when state === "open". */
  remainingMs?: number;
  /** `true` when state is `"half-open"` and no probe is currently in-flight. */
  probeAvailable?: boolean;
}

export interface CircuitMetrics {
  name?: string;
  state: CircuitState;
  failCount: number;
  trippedAt: number | null;
  remainingCooldownMs: number;
  probeInFlight: boolean;
}

/**
 * In-memory circuit breaker with three-state machine: closed → open → half-open.
 *
 * State transitions:
 *   - closed --(N fails within window)--> open
 *   - open --(cooldown expires)--> half-open (one probe request allowed)
 *   - half-open --(probe succeeds)--> closed
 *   - half-open --(probe fails)--> open (fresh cooldown)
 *
 * State persists across requests hitting the same warm serverless instance.
 *
 * Half-open concurrency: only ONE caller acquires the probe slot at a time.
 * Concurrent callers during half-open see the breaker as open and take the
 * fallback path — preventing thundering-herd on an upstream that just recovered.
 */
export class CircuitBreaker {
  readonly name?: string;
  private readonly failThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly clock: () => number;
  private readonly onEvent?: ArmorEventHandler;
  private failedAts: number[] = [];
  private trippedAt: number | null = null;
  private probeInFlight = false;
  private emittedHalfOpen = false;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.name = opts.name;
    this.failThreshold = opts.failThreshold ?? 3;
    this.windowMs = opts.windowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.clock = opts.now ?? Date.now;
    this.onEvent = opts.onEvent;
  }

  private computeState(): CircuitState {
    if (this.trippedAt === null) return "closed";
    const elapsed = this.clock() - this.trippedAt;
    return elapsed >= this.cooldownMs ? "half-open" : "open";
  }

  check(): CircuitCheckResult {
    const state = this.computeState();
    if (state === "open") {
      return {
        state,
        open: true,
        remainingMs: this.cooldownMs - (this.clock() - (this.trippedAt as number)),
      };
    }
    if (state === "half-open") {
      return { state, open: false, probeAvailable: !this.probeInFlight };
    }
    return { state, open: false };
  }

  /**
   * Atomically try to acquire the single probe slot when the breaker is half-open.
   * - Returns `true` when caller may proceed with the request:
   *   - state is `closed` (no probe needed, normal path)
   *   - state is `half-open` AND no probe is currently in-flight
   * - Returns `false` when caller should take the fallback path:
   *   - state is `open`
   *   - state is `half-open` AND another caller already holds the probe slot
   */
  tryAcquireProbe(): boolean {
    const state = this.computeState();
    if (state === "closed") return true;
    if (state === "open") return false;
    // half-open
    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    if (!this.emittedHalfOpen) {
      this.emittedHalfOpen = true;
      safeEmit(this.onEvent, { type: "circuit_half_open", name: this.name });
    }
    return true;
  }

  recordSuccess(): void {
    const wasHalfOpen = this.computeState() === "half-open";
    const wasOpen = this.trippedAt !== null;
    this.failedAts = [];
    this.trippedAt = null;
    this.probeInFlight = false;
    this.emittedHalfOpen = false;
    if (wasHalfOpen) {
      safeEmit(this.onEvent, { type: "probe_succeeded", name: this.name });
      safeEmit(this.onEvent, { type: "circuit_closed", name: this.name });
    } else if (wasOpen) {
      safeEmit(this.onEvent, { type: "circuit_closed", name: this.name });
    }
  }

  recordFail(): void {
    const wasHalfOpen = this.computeState() === "half-open";
    const now = this.clock();
    this.failedAts.push(now);
    this.failedAts = this.failedAts.filter((t) => now - t < this.windowMs);
    this.probeInFlight = false;

    if (wasHalfOpen) {
      safeEmit(this.onEvent, { type: "probe_failed", name: this.name });
      this.trippedAt = now;
      this.emittedHalfOpen = false;
      safeEmit(this.onEvent, {
        type: "circuit_opened",
        name: this.name,
        failCount: this.failedAts.length,
      });
      return;
    }
    if (this.trippedAt === null && this.failedAts.length >= this.failThreshold) {
      this.trippedAt = now;
      safeEmit(this.onEvent, {
        type: "circuit_opened",
        name: this.name,
        failCount: this.failedAts.length,
      });
    }
  }

  reset(): void {
    const wasOpen = this.trippedAt !== null || this.computeState() !== "closed";
    this.failedAts = [];
    this.trippedAt = null;
    this.probeInFlight = false;
    this.emittedHalfOpen = false;
    if (wasOpen) safeEmit(this.onEvent, { type: "circuit_closed", name: this.name });
  }

  get state(): CircuitState {
    return this.computeState();
  }

  metrics(): CircuitMetrics {
    const state = this.computeState();
    return {
      name: this.name,
      state,
      failCount: this.failedAts.length,
      trippedAt: this.trippedAt,
      remainingCooldownMs:
        state === "open" && this.trippedAt !== null
          ? Math.max(0, this.cooldownMs - (this.clock() - this.trippedAt))
          : 0,
      probeInFlight: this.probeInFlight,
    };
  }
}
