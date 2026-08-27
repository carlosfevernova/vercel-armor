export interface CircuitBreakerOptions {
  /** Consecutive failures within `windowMs` that trip the breaker. Default 3. */
  failThreshold?: number;
  /** Sliding window in ms for counting failures. Default 60_000. */
  windowMs?: number;
  /** How long the breaker stays open after tripping. Default 60_000. */
  cooldownMs?: number;
  /** Injectable clock — useful for deterministic tests. */
  now?: () => number;
}

export type CircuitState = "closed" | "open";

export interface CircuitCheckResult {
  open: boolean;
  remainingMs?: number;
}

/**
 * In-memory circuit breaker. State persists across requests on the same warm
 * serverless instance. Cheap fail-fast when the downstream is dead — serve 503
 * (or a fallback) in <1ms instead of blocking the function budget for 30s.
 */
export class CircuitBreaker {
  private readonly failThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private fails: number[] = [];
  private trippedAt: number | null = null;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failThreshold = opts.failThreshold ?? 3;
    this.windowMs = opts.windowMs ?? 60_000;
    this.cooldownMs = opts.cooldownMs ?? 60_000;
    this.now = opts.now ?? Date.now;
  }

  check(): CircuitCheckResult {
    const now = this.now();
    if (this.trippedAt !== null && now - this.trippedAt < this.cooldownMs) {
      return { open: true, remainingMs: this.cooldownMs - (now - this.trippedAt) };
    }
    if (this.trippedAt !== null && now - this.trippedAt >= this.cooldownMs) {
      this.trippedAt = null;
      this.fails = [];
    }
    return { open: false };
  }

  recordFail(): void {
    const now = this.now();
    this.fails.push(now);
    this.fails = this.fails.filter((t) => now - t < this.windowMs);
    if (this.fails.length >= this.failThreshold) {
      this.trippedAt = now;
    }
  }

  recordSuccess(): void {
    this.fails = [];
    this.trippedAt = null;
  }

  reset(): void {
    this.recordSuccess();
  }

  get state(): CircuitState {
    return this.check().open ? "open" : "closed";
  }
}
