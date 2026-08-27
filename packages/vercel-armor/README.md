# vercel-armor

**Resilience toolkit for Vercel serverless APIs that depend on flaky external services.**
Three-state circuit breaker · retry with backoff · one-line Next.js App Router wrapper · observability events. Zero runtime deps. Node 20+.

```bash
npm i vercel-armor
```

[![CI](https://github.com/carlosfevernova/vercel-armor/actions/workflows/ci.yml/badge.svg)](https://github.com/carlosfevernova/vercel-armor/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/vercel-armor.svg)](https://www.npmjs.com/package/vercel-armor)
[![minzipped](https://img.shields.io/bundlephobia/minzip/vercel-armor)](https://bundlephobia.com/package/vercel-armor)
[![license](https://img.shields.io/npm/l/vercel-armor.svg)](./LICENSE)

## The problem

Your handler does `fetch(externalUrl)`. The external is a legacy ERP, a raw IP, or a partner API that occasionally hangs for 30 seconds. Under 10-20 concurrent users, every request eats your function budget and cascades 504s to the UI.

A production incident on an INUIT Corp ERP integration — 20 concurrent users hitting a dead upstream — went from **~30 seconds wall time and full 504 saturation** down to **under 2 seconds** after applying this pattern. The library extracts that pattern so you don't reinvent it every time.

## One-line handler with `armoredRoute`

```ts
// app/api/inventory/route.ts
import { armoredRoute, getCircuitBreaker } from "vercel-armor";

const cb = getCircuitBreaker("erp", { failThreshold: 3, cooldownMs: 60_000 });

export const GET = armoredRoute({
  cb,
  fetcher: async () => {
    const r = await fetch(process.env.ERP_URL!, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) throw new Error(`erp_http_${r.status}`);
    return r.json();
  },
  fallback: () => loadStaleFromSupabase(),
  onEvent: (e) => log(e),
});
```

Response shape (JSON body):
```json
{
  "status": "ok" | "stale" | "error",
  "source": "live" | "fallback" | "none",
  "cbState": "closed" | "open" | "half-open",
  "cbOpen": true,
  "cbRemainingMs": 42123,
  "data": { ... },
  "errorInfo": "upstream_http_502"
}
```

Response headers:
- `cache-control: public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400` when live
- `x-armor-status`
- `x-armor-cb-state`
- `x-armor-cb-remaining-ms` (when open)

## The 4 layers

| Layer | Primitive                                | What it stops |
|-------|------------------------------------------|---------------|
| 1     | Client cache discipline (no ad-hoc `?_=Date.now()`) | Breaks Vercel CDN request-collapsing |
| 2     | `CircuitBreaker` (closed → open → half-open) | Serving 30s timeouts once upstream is known-dead |
| 3     | `abortableFetch` (+ retry with backoff) | Individual fetches hogging the function budget |
| 4     | `armorHeaders` (`stale-if-error`)        | Users seeing 503 when a stale response is still useful |

## Detailed API

### `CircuitBreaker`

Three-state machine: `closed → open → half-open`. After the cooldown elapses the next request is treated as a probe — success closes the breaker, failure re-opens with a fresh cooldown. Concurrent callers during half-open are shed to the fallback path via `tryAcquireProbe()`, preventing thundering-herd on a just-recovered upstream.

```ts
new CircuitBreaker({
  name?: string,
  failThreshold?: number,   // default 3
  windowMs?: number,        // default 60_000
  cooldownMs?: number,      // default 60_000
  now?: () => number,       // injectable clock (tests)
  onEvent?: (e: ArmorEvent) => void,
})
```

Methods: `check() → { state, open, remainingMs?, probeAvailable? }`, `tryAcquireProbe() → boolean`, `recordFail()`, `recordSuccess()`, `reset()`, `metrics()`.

### `abortableFetch<T>(input, init?)`

Timeout via `AbortController` + optional retry-with-backoff. Never throws — resolves with:

```ts
{
  ok: boolean;
  status: number;
  data?: T;
  attempts: number;
  raw?: Response;
  error?: string;
  timedOut?: boolean;
  retryAfterSec?: number;
}
```

Enable retries:

```ts
await abortableFetch(url, {
  timeoutMs: 5_000,
  retry: {
    attempts: 4,               // total tries
    baseMs: 100,               // starting backoff
    maxDelayMs: 5_000,         // cap
    jitter: 0.3,               // ±30% randomness
    retryOn: [429, 500, 502, 503, 504],
    maxRetryAfterSec: 30,      // clamp for 429 Retry-After
  },
  onEvent: (e) => log(e),
});
```

### `withArmor(opts, fetcher)`

Composes CB + fallback around any fetcher. Same return shape as `armoredRoute` but returns a plain `ArmorResult<T>` (not a `Response`) so it can be used from any handler style.

### `armoredRoute(opts)`

One-line Next.js App Router wrapper. See top-of-README example.

### `throttledMap(items, concurrency, fn)`

Order-preserving bounded-concurrency map for fan-out.

### `armorHeaders(res, opts?)` / `armorHeadersObject(opts?)`

Sets `cache-control: public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400` (all tunable). Node-style and Web Response variants.

### Observability

Every state transition emits an `ArmorEvent`:

```ts
type ArmorEvent =
  | { type: "circuit_opened"; name?: string; failCount: number }
  | { type: "circuit_closed"; name?: string }
  | { type: "circuit_half_open"; name?: string }
  | { type: "probe_succeeded"; name?: string }
  | { type: "probe_failed"; name?: string }
  | { type: "fetch_timeout"; url?: string; timeoutMs: number }
  | { type: "fetch_retry"; url?: string; attempt: number; delayMs: number; reason: string }
  | { type: "fetch_rate_limited"; url?: string; retryAfterSec?: number }
  | { type: "fallback_served"; name?: string; reason: string }
  | { type: "fallback_failed"; name?: string; reason: string };
```

Wire it to Sentry, OpenTelemetry, Datadog, Axiom — or dump to a ring buffer for a `/api/telemetry` endpoint (see the demo app).

### Named singleton registry

Multiple external dependencies? One CB each.

```ts
import { getCircuitBreaker, listCircuitBreakers } from "vercel-armor";

const erp = getCircuitBreaker("erp", { cooldownMs: 60_000 });
const crm = getCircuitBreaker("crm", { failThreshold: 5 });

// /api/telemetry
export const GET = () =>
  Response.json({
    breakers: [...listCircuitBreakers().values()].map((cb) => cb.metrics()),
  });
```

## Comparison

|                        | `vercel-armor` | `opossum` | `cockatiel` | `p-retry` |
|------------------------|:--:|:--:|:--:|:--:|
| Node 20+ / Vercel-first | ✅ | ✅ | ✅ | ✅ |
| Zero runtime deps       | ✅ | ❌ (`eventemitter3`) | ✅ | ✅ |
| Bundle size (min+gz)    | ~3 KB | ~24 KB | ~14 KB | ~2 KB |
| Three-state CB (half-open) | ✅ | ✅ | ✅ | ❌ (no CB) |
| Probe slot lock         | ✅ | ⚠️ (needs config) | ✅ | – |
| Retry-with-backoff      | ✅ | ⚠️ (via wrapper) | ✅ | ✅ |
| Honors `Retry-After`    | ✅ | ❌ | ⚠️ | ⚠️ |
| Fallback composition    | ✅ | ✅ | ⚠️ (policy) | ❌ |
| One-line App Router wrapper | ✅ | ❌ | ❌ | ❌ |
| Observability events    | ✅ discriminated union | ✅ EventEmitter | ✅ Rx-style | ❌ |
| Cache-header helpers    | ✅ | ❌ | ❌ | ❌ |
| Named singleton registry | ✅ | ❌ (DIY) | ❌ (DIY) | – |

`vercel-armor` is not trying to replace `opossum` or `cockatiel` when you're building a generic Node service. It's opinionated around one problem: **your Vercel handler depends on something that occasionally goes down**. The API is 5 primitives, one wrapper, and a rings-buffer of events.

## Frontend hygiene (Layer 1)

The circuit breaker is worthless if the frontend busts the CDN cache key:

```ts
// ❌ Bypasses the CDN entirely — every request hits your function
fetch(url, { cache: "no-store" });

// ❌ Unique URL per request — cache MISS every time
fetch(`${url}?_=${Date.now()}`);
```

The library returns proper `cache-control` on `armorHeaders`. Trust it — 100 concurrent users on the same URL collapse into 1 upstream fetch at the edge.

## Runtime support

- Node.js 20+ (uses global `fetch` and `AbortController`).
- **Vercel Node runtime** — recommended. Circuit breaker state persists across warm invocations.
- **Vercel Edge runtime** — works, but the breaker state resets per isolate. Prefer the Node runtime when you want deep fail-fast protection.
- Cloudflare Workers — usable but same caveat as Edge.

## License

MIT — Carlos F. Vernova
