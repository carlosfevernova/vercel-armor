export interface AbortableFetchOptions extends Omit<RequestInit, "signal"> {
  /** Per-request timeout in ms. Should be << your function maxDuration. Default 5000. */
  timeoutMs?: number;
  /** Optional external signal to compose with the internal timeout signal. */
  signal?: AbortSignal;
}

export interface AbortableFetchResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  raw?: Response;
  error?: string;
  timedOut?: boolean;
  retryAfterSec?: number;
}

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

/**
 * fetch() wrapper with a hard per-request timeout via AbortController.
 * Never returns a raw thrown error — always resolves with an ok/error shape,
 * so callers don't need try/catch and can feed the result straight into
 * circuit-breaker `recordFail` / `recordSuccess`.
 *
 * Content-Type handling:
 *  - application/json → parsed into `data`
 *  - anything else → `data` is the raw string body
 */
export async function abortableFetch<T = unknown>(
  input: string | URL,
  init: AbortableFetchOptions = {},
): Promise<AbortableFetchResult<T>> {
  const { timeoutMs = 5000, signal: externalSignal, ...rest } = init;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  // Compose external signal with the internal timeout signal.
  const onExternalAbort = () => ctrl.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      return { ok: false, status: 0, error: "aborted_before_start", timedOut: false };
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
      };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: res.status, raw: res, error: body.slice(0, 200) || `http_${res.status}` };
    }

    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const data = (await res.json().catch(() => null)) as T | null;
      return { ok: true, status: res.status, raw: res, data: data ?? (undefined as T | undefined) };
    }
    const text = (await res.text().catch(() => "")) as unknown as T;
    return { ok: true, status: res.status, raw: res, data: text };
  } catch (e: unknown) {
    clearTimeout(timer);
    const err = e as { name?: string; message?: string };
    const isAbort = err?.name === "AbortError";
    return {
      ok: false,
      status: 0,
      error: isAbort ? `timeout_${timeoutMs}ms` : String(err?.message ?? e).slice(0, 200),
      timedOut: isAbort,
    };
  } finally {
    if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort);
  }
}
