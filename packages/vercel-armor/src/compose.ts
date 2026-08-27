import type { CircuitBreaker } from "./circuit-breaker.js";

export type ArmorStatus = "ok" | "stale" | "error";
export type ArmorSource = "live" | "fallback" | "none";

export interface WithArmorOptions<T> {
  cb: CircuitBreaker;
  /** Optional stale-data fallback used when the breaker is open. */
  fallback?: () => Promise<T | null | undefined> | T | null | undefined;
  /** Called when the fetcher succeeds. Defaults to `cb.recordSuccess()`. */
  onSuccess?: () => void;
  /** Called when the fetcher fails or throws. Defaults to `cb.recordFail()`. */
  onFailure?: (err: unknown) => void;
}

export interface ArmorResult<T> {
  status: ArmorStatus;
  source: ArmorSource;
  data?: T;
  cbOpen: boolean;
  cbRemainingMs?: number;
  errorInfo?: string;
}

/**
 * Composes CircuitBreaker + fallback around a fetcher function.
 *
 * Flow:
 *   1. If breaker is OPEN → skip fetcher, try fallback, else return `error`.
 *   2. Else run `fetcher`:
 *      - success → recordSuccess → `{ status: 'ok', source: 'live', data }`
 *      - failure → recordFail → try fallback, else return `error`.
 *
 * `fetcher` is expected to throw on failure OR resolve to a value; if you're
 * using `abortableFetch`, you can either throw manually on `!result.ok` or use
 * the flat-callback form via `onFailure`.
 */
export async function withArmor<T>(
  opts: WithArmorOptions<T>,
  fetcher: () => Promise<T>,
): Promise<ArmorResult<T>> {
  const { cb, fallback, onSuccess, onFailure } = opts;
  const check = cb.check();

  const tryFallback = async (errorInfo?: string): Promise<ArmorResult<T>> => {
    if (!fallback) {
      return { status: "error", source: "none", cbOpen: check.open, cbRemainingMs: check.remainingMs, errorInfo };
    }
    try {
      const stale = await fallback();
      if (stale !== null && stale !== undefined) {
        return {
          status: "stale",
          source: "fallback",
          data: stale,
          cbOpen: check.open,
          cbRemainingMs: check.remainingMs,
          errorInfo,
        };
      }
    } catch (fbErr: unknown) {
      const msg = fbErr instanceof Error ? fbErr.message : String(fbErr);
      return {
        status: "error",
        source: "none",
        cbOpen: check.open,
        cbRemainingMs: check.remainingMs,
        errorInfo: `${errorInfo ?? "primary_failed"}; fallback_failed: ${msg.slice(0, 100)}`,
      };
    }
    return { status: "error", source: "none", cbOpen: check.open, cbRemainingMs: check.remainingMs, errorInfo };
  };

  if (check.open) {
    return tryFallback("circuit_breaker_open");
  }

  try {
    const data = await fetcher();
    (onSuccess ?? (() => cb.recordSuccess()))();
    return { status: "ok", source: "live", data, cbOpen: false };
  } catch (err: unknown) {
    (onFailure ?? (() => cb.recordFail()))(err);
    const msg = err instanceof Error ? err.message : String(err);
    return tryFallback(msg.slice(0, 200));
  }
}
