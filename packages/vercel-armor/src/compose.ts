import type { CircuitBreaker } from "./circuit-breaker.js";
import { type ArmorEventHandler, safeEmit } from "./events.js";

export type ArmorStatus = "ok" | "stale" | "error";
export type ArmorSource = "live" | "fallback" | "none";

export interface WithArmorOptions<T> {
  cb: CircuitBreaker;
  /** Optional stale-data fallback used when the breaker is open or the fetcher fails. */
  fallback?: () => Promise<T | null | undefined> | T | null | undefined;
  /** Called when the fetcher succeeds. Defaults to `cb.recordSuccess()`. */
  onSuccess?: () => void;
  /** Called when the fetcher fails or throws. Defaults to `cb.recordFail(err)`. */
  onFailure?: (err: unknown) => void;
  /** Observability hook — receives `fallback_served`, `fallback_failed`. Bubbles up CB events too. */
  onEvent?: ArmorEventHandler;
}

export interface ArmorResult<T> {
  status: ArmorStatus;
  source: ArmorSource;
  data?: T;
  cbOpen: boolean;
  cbState: "closed" | "open" | "half-open";
  cbRemainingMs?: number;
  attempts?: number;
  errorInfo?: string;
}

/**
 * Composes CircuitBreaker (with half-open probe semantics) + fallback around a fetcher.
 *
 * Behavior:
 *   1. If breaker is fully open OR half-open with the probe slot taken → skip
 *      the fetcher, try the fallback, else return `error`.
 *   2. Otherwise run `fetcher`:
 *      - success → `recordSuccess()` (closes the breaker if it was half-open)
 *        → `{ status: 'ok', source: 'live', data }`
 *      - failure → `recordFail(err)` (re-opens with fresh cooldown if it was
 *        half-open) → try fallback → else `error`.
 */
export async function withArmor<T>(
  opts: WithArmorOptions<T>,
  fetcher: () => Promise<T>,
): Promise<ArmorResult<T>> {
  const { cb, fallback, onSuccess, onFailure, onEvent } = opts;
  const initialCheck = cb.check();

  const tryFallback = async (errorInfo?: string): Promise<ArmorResult<T>> => {
    const c = cb.check();
    if (!fallback) {
      return {
        status: "error",
        source: "none",
        cbOpen: c.open,
        cbState: c.state,
        ...(c.remainingMs !== undefined ? { cbRemainingMs: c.remainingMs } : {}),
        errorInfo,
      };
    }
    try {
      const stale = await fallback();
      if (stale !== null && stale !== undefined) {
        safeEmit(onEvent, { type: "fallback_served", name: cb.name, reason: errorInfo ?? "unknown" });
        return {
          status: "stale",
          source: "fallback",
          data: stale,
          cbOpen: c.open,
          cbState: c.state,
          ...(c.remainingMs !== undefined ? { cbRemainingMs: c.remainingMs } : {}),
          errorInfo,
        };
      }
    } catch (fbErr: unknown) {
      const msg = fbErr instanceof Error ? fbErr.message : String(fbErr);
      safeEmit(onEvent, { type: "fallback_failed", name: cb.name, reason: msg.slice(0, 100) });
      return {
        status: "error",
        source: "none",
        cbOpen: c.open,
        cbState: c.state,
        ...(c.remainingMs !== undefined ? { cbRemainingMs: c.remainingMs } : {}),
        errorInfo: `${errorInfo ?? "primary_failed"}; fallback_failed: ${msg.slice(0, 100)}`,
      };
    }
    return {
      status: "error",
      source: "none",
      cbOpen: c.open,
      cbState: c.state,
      ...(c.remainingMs !== undefined ? { cbRemainingMs: c.remainingMs } : {}),
      errorInfo,
    };
  };

  const acquired = cb.tryAcquireProbe();
  if (!acquired) {
    const reason = initialCheck.state === "half-open" ? "half_open_probe_busy" : "circuit_breaker_open";
    return tryFallback(reason);
  }

  try {
    const data = await fetcher();
    (onSuccess ?? (() => cb.recordSuccess()))();
    const post = cb.check();
    return { status: "ok", source: "live", data, cbOpen: false, cbState: post.state };
  } catch (err: unknown) {
    (onFailure ?? (() => cb.recordFail()))(err);
    const msg = err instanceof Error ? err.message : String(err);
    return tryFallback(msg.slice(0, 200));
  }
}
