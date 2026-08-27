export interface ArmorHeadersOptions {
  /** Fresh-cache seconds. Vercel CDN request-collapsing kicks in during this window. Default 60. */
  sMaxAge?: number;
  /** stale-while-revalidate seconds. Default 300. */
  staleWhileRevalidate?: number;
  /** stale-if-error seconds — serves last-good response when origin returns 5xx. Default 86_400 (24h). */
  staleIfError?: number;
  /** If false, forces `cache-control: no-store` (useful for authenticated / force=1 requests). Default true. */
  cacheable?: boolean;
  /** Optional Vary header value. */
  vary?: string;
}

export interface HeaderSink {
  setHeader(name: string, value: string): void;
}

function buildCacheControl(o: ArmorHeadersOptions): string {
  if (o.cacheable === false) return "no-store";
  const s = o.sMaxAge ?? 60;
  const swr = o.staleWhileRevalidate ?? 300;
  const sie = o.staleIfError ?? 86_400;
  return `public, s-maxage=${s}, stale-while-revalidate=${swr}, stale-if-error=${sie}`;
}

/**
 * Set armor cache headers on a Node.js-style `res` object.
 * Use inside Vercel serverless functions with `(req, res) => ...` handlers.
 */
export function armorHeaders(res: HeaderSink, opts: ArmorHeadersOptions = {}): void {
  res.setHeader("cache-control", buildCacheControl(opts));
  if (opts.vary) res.setHeader("vary", opts.vary);
}

/**
 * Return a plain header object suitable for `new Response(body, { headers })`.
 * Use inside Next.js App Router `route.ts` handlers or Edge runtime.
 */
export function armorHeadersObject(opts: ArmorHeadersOptions = {}): Record<string, string> {
  const h: Record<string, string> = { "cache-control": buildCacheControl(opts) };
  if (opts.vary) h.vary = opts.vary;
  return h;
}
