import type { CircuitBreaker } from "./circuit-breaker.js";
import { armorHeadersObject, type ArmorHeadersOptions } from "./cache-headers.js";
import { withArmor } from "./compose.js";
import type { ArmorEventHandler } from "./events.js";

export interface ArmoredRouteOptions<T> {
  cb: CircuitBreaker;
  /** The primary data fetcher — throws or resolves. */
  fetcher: (req: Request) => Promise<T>;
  /** Optional last-known-good fallback (Supabase, KV, D1). */
  fallback?: (req: Request) => Promise<T | null | undefined> | T | null | undefined;
  /** Cache headers config. Only applied when the fetcher succeeds. */
  headers?: ArmorHeadersOptions;
  /** HTTP status returned when both fetcher and fallback fail. Default 503. */
  errorStatus?: number;
  /** HTTP status returned when the fallback served stale data. Default 200 (Vercel edge can still cache it). */
  staleStatus?: number;
  /** Optional serializer — useful to shape/prune before JSON stringify. */
  serialize?: (data: T) => unknown;
  /** Observability hook. */
  onEvent?: ArmorEventHandler;
}

/**
 * One-line Next.js App Router handler that gets circuit-breaker, fallback,
 * armor headers, and diagnostic `x-armor-*` response headers for free.
 *
 * ```ts
 * // app/api/inventory/route.ts
 * import { armoredRoute, getCircuitBreaker } from "vercel-armor";
 *
 * const cb = getCircuitBreaker("erp", { failThreshold: 3, cooldownMs: 60_000 });
 *
 * export const GET = armoredRoute({
 *   cb,
 *   fetcher: async () => {
 *     const r = await fetch(process.env.ERP_URL!);
 *     if (!r.ok) throw new Error(`erp_http_${r.status}`);
 *     return r.json();
 *   },
 *   fallback: () => loadStaleFromDb(),
 * });
 * ```
 *
 * Response shape (JSON body):
 * ```
 * { status: 'ok' | 'stale' | 'error', source: 'live' | 'fallback' | 'none',
 *   data?, cbState, cbOpen, cbRemainingMs?, errorInfo? }
 * ```
 *
 * Response headers include:
 *   - `cache-control` (with `stale-if-error` for error tolerance at the edge)
 *   - `x-armor-status`   → ok | stale | error
 *   - `x-armor-cb-state` → closed | open | half-open
 *   - `x-armor-cb-remaining-ms` (only when open)
 */
export function armoredRoute<T>(opts: ArmoredRouteOptions<T>): (req: Request) => Promise<Response> {
  const {
    cb,
    fetcher,
    fallback,
    headers,
    errorStatus = 503,
    staleStatus = 200,
    serialize,
    onEvent,
  } = opts;

  return async function armoredHandler(req: Request): Promise<Response> {
    const result = await withArmor(
      {
        cb,
        fallback: fallback ? () => fallback(req) : undefined,
        onEvent,
      },
      () => fetcher(req),
    );

    const httpStatus = result.status === "error" ? errorStatus : result.status === "stale" ? staleStatus : 200;
    const cacheable = result.status === "ok";
    const respHeaders: Record<string, string> = {
      ...armorHeadersObject({ cacheable, ...(headers ?? {}) }),
      "content-type": "application/json; charset=utf-8",
      "x-armor-status": result.status,
      "x-armor-cb-state": result.cbState,
    };
    if (result.cbRemainingMs !== undefined) {
      respHeaders["x-armor-cb-remaining-ms"] = String(Math.max(0, Math.round(result.cbRemainingMs)));
    }

    const body =
      serialize && result.data !== undefined
        ? { ...result, data: serialize(result.data) }
        : result;

    return new Response(JSON.stringify(body), { status: httpStatus, headers: respHeaders });
  };
}
