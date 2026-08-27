# vercel-armor

**4-layer resilience for Vercel serverless APIs that depend on flaky external services.**
Circuit breaker + abortable fetch + throttled map + `stale-if-error` cache headers. Zero runtime deps. Node 20+. Works in Node runtime and Edge.

```bash
npm i vercel-armor
```

## The problem

Your handler does `fetch(externalUrl)`. The external is a legacy ERP, a raw IP, or a partner API that occasionally hangs for 30 seconds. Under 10-20 concurrent users, every request eats your function budget and cascades 504s to the UI.

A production incident on a live INUIT Corp ERP integration — 20 concurrent users hitting a dead upstream — went from **~30 seconds wall time and full 504 saturation** down to **under 2 seconds** after applying this pattern. The library extracts that pattern so you don't reinvent it every time.

## The 4 layers

| Layer | Primitive                                | What it stops |
|-------|------------------------------------------|---------------|
| 1     | Client cache discipline (no ad-hoc `?_=Date.now()`) | Breaks Vercel CDN request-collapsing |
| 2     | `CircuitBreaker`                         | Serving 30s timeouts once upstream is known-dead |
| 3     | `abortableFetch`                         | Individual fetches hogging the function budget |
| 4     | `armorHeaders` (`stale-if-error`)        | Users seeing 503 when a stale response is still useful |

Plus `withArmor` — a composer that ties the CircuitBreaker to a user-provided fallback (Supabase snapshot, KV, D1, in-memory).

## Full example

```ts
// /api/inventory.ts — Vercel Node runtime
import { CircuitBreaker, abortableFetch, withArmor, armorHeaders } from "vercel-armor";

const cb = new CircuitBreaker({
  failThreshold: 3,      // 3 fails within...
  windowMs: 60_000,      // ...60s trips the breaker
  cooldownMs: 60_000,    // stays open for 60s
});

async function loadStaleFromDb() {
  // e.g. Supabase last known good
  const r = await fetch(`${SUPABASE_URL}/rest/v1/inventory_snapshot`, { headers: authHeaders });
  return r.ok ? await r.json() : null;
}

export default async function handler(req, res) {
  const result = await withArmor(
    { cb, fallback: loadStaleFromDb },
    async () => {
      const r = await abortableFetch("http://legacy-erp.example/api/stock", { timeoutMs: 5000 });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
  );

  armorHeaders(res, { cacheable: result.status === "ok" });
  res.setHeader("x-armor-status", result.status);
  res.status(result.status === "error" ? 503 : 200).json(result);
}
```

Frontend keeps its side of the request-collapsing bargain:

```ts
// GOOD — lets Vercel CDN collapse concurrent requests
const r = await fetch("/api/inventory");

// BAD — the query string busts the cache key on every call
const r = await fetch(`/api/inventory?_=${Date.now()}`, { cache: "no-store" });
```

## API

### `CircuitBreaker`

```ts
new CircuitBreaker({
  failThreshold?: number;    // default 3
  windowMs?: number;         // default 60_000
  cooldownMs?: number;       // default 60_000
  now?: () => number;        // injectable clock (tests)
})
```

Methods: `check() → { open, remainingMs? }`, `recordFail()`, `recordSuccess()`, `reset()`. Getter: `state → "open" | "closed"`.

State is per-instance and in-memory. On Vercel it persists across requests hitting the same warm serverless instance — which is exactly what you want for fail-fast behavior without adding Redis.

### `abortableFetch<T>(input, init?)`

Drop-in wrapper around `fetch` with a hard per-request timeout via `AbortController`. Never throws — always resolves with:

```ts
{
  ok: boolean;
  status: number;
  data?: T;              // parsed JSON if content-type is JSON, else raw text
  raw?: Response;
  error?: string;
  timedOut?: boolean;
  retryAfterSec?: number; // parsed from 429 responses
}
```

Options extend `RequestInit` and add `timeoutMs` (default 5000). You can also pass a `signal` — it composes with the internal timeout via `AbortSignal.any`-style semantics.

### `throttledMap<T, R>(items, concurrency, fn)`

Order-preserving bounded-concurrency map. When you fan out N external calls, unbounded `Promise.all` saturates the upstream and blows your function budget. Use `throttledMap(items, 5, fn)` instead.

### `armorHeaders(res, opts?)` / `armorHeadersObject(opts?)`

Sets `cache-control: public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400` (all tunable). Two variants:

- `armorHeaders(res)` for Node-style handlers (`res.setHeader`).
- `armorHeadersObject()` returns a plain object for `new Response(body, { headers })` inside Next.js App Router or Edge.

Pass `cacheable: false` to force `no-store` (authenticated endpoints, `?force=1` bypasses).

### `withArmor(opts, fetcher)`

```ts
withArmor(
  { cb, fallback?, onSuccess?, onFailure? },
  fetcher: () => Promise<T>
) → Promise<{
  status: "ok" | "stale" | "error";
  source: "live" | "fallback" | "none";
  data?: T;
  cbOpen: boolean;
  cbRemainingMs?: number;
  errorInfo?: string;
}>
```

- Breaker open + fallback available → serves `stale`.
- Breaker open + no fallback → returns `error`.
- Breaker closed, fetcher succeeds → `ok` + `recordSuccess()`.
- Breaker closed, fetcher throws → `recordFail()`, tries fallback, else `error`.

## Frontend hygiene (Layer 1)

The circuit breaker is worthless if the frontend busts the CDN cache key. Two anti-patterns to avoid:

```ts
// ❌ Bypasses the CDN entirely — every request hits your function
fetch(url, { cache: "no-store" });

// ❌ Unique URL per request — cache MISS every time
fetch(`${url}?_=${Date.now()}`);
```

The library returns proper `cache-control` on `armorHeaders`. Trust it — 100 concurrent users on the same URL collapse into 1 upstream fetch at the edge.

## Runtime support

- Node.js 20+ (uses global `fetch` and `AbortController`).
- Vercel Node runtime — recommended, because circuit breaker state persists across warm invocations.
- Vercel Edge runtime — works, but breaker state resets per isolate. Prefer Node runtime for high-value protection.

## License

MIT — Carlos F. Vernova
