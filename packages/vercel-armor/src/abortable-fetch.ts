import { type ArmorEventHandler, safeEmit } from "./events.js";

export interface RetryOptions {
  /** Total attempts including the first. Default 1 (no retry). */
  attempts?: number;
  /** Base delay in ms for exponential backoff. Default 100. */
  baseMs?: number;
  /** Delay cap in ms. Default 5000. */
  maxDelayMs?: number;
  /** Jitter factor 0..1 — the actual delay is uniformly sampled from `[base * (1-jitter/2), base * (1+jitter/2)]`. Default 0.3. */
  jitter?: number;
  /** HTTP status codes that trigger a retry. Default: [429, 500, 502, 503, 504]. */
  retryOn?: readonly number[];
  /** Retry on network / timeout / abort errors. Default true. */
  retryOnNetworkError?: boolean;
  /** Maximum Retry-After value (seconds) the retry loop will honor before giving up. Default 30. */
  maxRetryAfterSec?: number;
  /** Injectable RNG (0..1). Useful for deterministic tests. */
  random?: () => number;
}

export interface AbortableFetchOptions extends Omit<RequestInit, "signal"> {
  /** Per-request timeout in ms. Should be << your function maxDuration. Default 5000. */
  timeoutMs?: number;
  /** Optional external signal to compose with the internal timeout signal. */
  signal?: AbortSignal;
  /** Retry-with-backoff strategy. Default: no retries. */
  retry?: RetryOptions;
  /** Observability hook — receives `fetch_timeout`, `fetch_retry`, `fetch_rate_limited` events. */
  onEvent?: ArmorEventHandler;
}

export interface AbortableFetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  raw?: Response;
  error?: string;
  timedOut?: boolean;
  retryAfterSec?: number;
  /** Number of attempts made (1 = no retry, 2 = one retry, etc.). */
  attempts: number;
}

const DEFAULT_RETRY_STATUSES: readonly number[] = [429, 500, 502, 503, 504];

function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers.get("retry-after");
  if (!raw) return undefined;
  const asInt = Number.parseInt(raw, 10);
  if (Number.isFinite(asInt)) return asInt;
  const asDate = Date.parse(raw);
  if (Number.isFinite(asDate)) {
    return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  }
  return undefined;
}

function computeBackoff(attempt: number, opts: Required<Pick<RetryOptions, "baseMs" | "maxDelayMs" | "jitter" | "random">>): number {
  const exp = Math.min(opts.maxDelayMs, opts.baseMs * Math.pow(2, attempt));
  const spread = exp * opts.jitter;
  const min = exp - spread / 2;
  const delay = min + spread * opts.random();
  return Math.max(0, Math.round(delay));
}

async function singleAttempt<T>(
  input: string | URL,
  init: Omit<AbortableFetchOptions, "retry" | "onEvent">,
): Promise<AbortableFetchResult<T>> {
  const { timeoutMs = 5000, signal: externalSignal, ...rest } = init;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  const onExternalAbort = () => ctrl.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      return { ok: false, status: 0, error: "aborted_before_start", timedOut: false, attempts: 1 };
    }
    externalSignal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    const res = await fetch(input, { ...rest, signal: ctrl.signal });
    clearTimeout(timer);

    if (res.status === 429) {
      return {
        ok: false,
        status: 429,
        raw: res,
        retryAfterSec: parseRetryAfter(res),
        error: "rate_limited",
        attempts: 1,
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        raw: res,
        error: body.slice(0, 200) || `http_${res.status}`,
        attempts: 1,
      };
    }

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const data = (await res.json().catch(() => null)) as T | null;
      return { ok: true, status: res.status, raw: res, data: data ?? (undefined as T | undefined), attempts: 1 };
    }
    const text = (await res.text().catch(() => "")) as unknown as T;
    return { ok: true, status: res.status, raw: res, data: text, attempts: 1 };
  } catch (e: unknown) {
    clearTimeout(timer);
    const err = e as { name?: string; message?: string };
    const isAbort = err?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      error: isAbort ? `timeout_${timeoutMs}ms` : String(err?.message ?? e).slice(0, 200),
      timedOut: isAbort,
      attempts: 1,
    };
  } finally {
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * fetch() with hard timeout and optional retry-with-backoff.
 *
 * Never throws — always resolves with `{ ok, status, data, error, attempts }`
 * so callers plug it straight into circuit-breaker + fallback logic.
 *
 * When `retry.attempts > 1`:
 *   - Retries on network errors, timeouts, and configurable HTTP status codes
 *     (default: 429, 500, 502, 503, 504).
 *   - 429 responses with a `Retry-After` header honor the server-supplied delay
 *     (clamped to `maxRetryAfterSec`).
 *   - Other retries use exponential backoff with configurable jitter.
 *   - Emits `fetch_retry`, `fetch_timeout`, and `fetch_rate_limited` events
 *     via the optional `onEvent` hook.
 */
export async function abortableFetch<T = unknown>(
  input: string | URL,
  init: AbortableFetchOptions = {},
): Promise<AbortableFetchResult<T>> {
  const { retry, onEvent, ...rest } = init;
  const maxAttempts = Math.max(1, retry?.attempts ?? 1);
  const retryOn = retry?.retryOn ?? DEFAULT_RETRY_STATUSES;
  const retryOnNetworkError = retry?.retryOnNetworkError ?? true;
  const maxRetryAfterSec = retry?.maxRetryAfterSec ?? 30;
  const backoffOpts = {
    baseMs: retry?.baseMs ?? 100,
    maxDelayMs: retry?.maxDelayMs ?? 5_000,
    jitter: Math.min(1, Math.max(0, retry?.jitter ?? 0.3)),
    random: retry?.random ?? Math.random,
  };
  const urlAsString = typeof input === "string" ? input : input.toString();

  let last: AbortableFetchResult<T> | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await singleAttempt<T>(input, rest);
    result.attempts = attempt;
    last = result;

    if (result.ok) return result;

    const isTimeout = result.timedOut === true;
    if (isTimeout) {
      safeEmit(onEvent, { type: "fetch_timeout", url: urlAsString, timeoutMs: rest.timeoutMs ?? 5000 });
    }
    if (result.status === 429) {
      safeEmit(onEvent, { type: "fetch_rate_limited", url: urlAsString, retryAfterSec: result.retryAfterSec });
    }

    if (attempt === maxAttempts) return result;

    const networkErrorRetryable = result.status === 0 && retryOnNetworkError;
    const statusRetryable = result.status !== 0 && retryOn.includes(result.status);
    if (!networkErrorRetryable && !statusRetryable) return result;

    let delay: number;
    if (result.status === 429 && typeof result.retryAfterSec === "number") {
      if (result.retryAfterSec > maxRetryAfterSec) return result;
      delay = result.retryAfterSec * 1000;
    } else {
      delay = computeBackoff(attempt - 1, backoffOpts);
    }

    safeEmit(onEvent, {
      type: "fetch_retry",
      url: urlAsString,
      attempt,
      delayMs: delay,
      reason: result.timedOut ? "timeout" : result.status === 429 ? "rate_limited" : `http_${result.status || "network"}`,
    });

    await sleep(delay);
  }
  // Unreachable — every path in the loop either returns or continues.
  return last as AbortableFetchResult<T>;
}
