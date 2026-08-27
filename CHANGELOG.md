# Changelog

All notable changes to `vercel-armor` are documented here.
Format loosely follows [Keep a Changelog](https://keepachangelog.com); versions follow [semver](https://semver.org).

## [0.2.0] — 2026-08-26

### Added

- **Three-state circuit breaker** — `closed → open → half-open → closed | open`. After the cooldown expires, the next request is treated as a probe. Success closes the breaker; failure re-opens with fresh cooldown. Prevents thundering-herd on a just-recovered upstream.
- **`CircuitBreaker#tryAcquireProbe()`** — atomic single-probe slot acquisition, so concurrent callers during half-open cannot pile on the upstream.
- **`CircuitBreaker#metrics()`** — returns `{ name, state, failCount, trippedAt, remainingCooldownMs, probeInFlight }` for `/api/telemetry`-style dashboards.
- **Observability event stream** — new `ArmorEvent` discriminated union: `circuit_opened`, `circuit_closed`, `circuit_half_open`, `probe_succeeded`, `probe_failed`, `fetch_timeout`, `fetch_retry`, `fetch_rate_limited`, `fallback_served`, `fallback_failed`. Wire your telemetry via the `onEvent` option on `CircuitBreaker`, `withArmor`, `armoredRoute`, and `abortableFetch`.
- **`abortableFetch` retry** — optional exponential backoff with jitter. Automatically honors `Retry-After` on 429 responses (clamped by `maxRetryAfterSec`). Configurable per-status retry policy.
- **`AbortableFetchResult.attempts`** — number of attempts made, exposed on every result.
- **`armoredRoute(...)`** — one-line Next.js App Router wrapper that ties CircuitBreaker + fallback + cache-headers into a `(req: Request) => Promise<Response>` handler. Sets `x-armor-status`, `x-armor-cb-state`, and `x-armor-cb-remaining-ms` diagnostic headers.
- **Named singleton registry** — `getCircuitBreaker(name, opts)`, `registerCircuitBreaker(name, cb)`, `listCircuitBreakers()`, `clearCircuitBreakers()`. Enables one breaker instance per external dependency, indexed by name.
- **Playwright E2E tests** under `apps/web/tests/e2e.spec.ts`. Boots the demo app, fires the load test, asserts the UI + `x-armor-*` headers.
- **Demo app v2** — live circuit-breaker state table + event timeline, polling `/api/telemetry` every second. "Reset CB" button clears the breaker and event log.
- **GitHub Actions CI** — install / build / test on push and PR.
- **CHANGELOG.md, dependabot.yml.**

### Changed

- **`CircuitCheckResult`** now includes a discriminated `state: "closed" | "open" | "half-open"` field. The existing `open: boolean` remains for backward compat.
- **`ArmorResult`** gains `cbState` and (optionally) `attempts`.
- `check()` is now guaranteed idempotent — it never mutates internal state. State transitions happen explicitly via `recordFail`, `recordSuccess`, `reset`, or `tryAcquireProbe`.

### Fixed

- Initial-timestamp bug: when a breaker tripped at `clock.now() === 0` (deterministic tests), the falsy check on `trippedAt` reported the breaker as closed. Now uses a `null` sentinel.

## [0.1.0] — 2026-08-26

Initial release.

- `CircuitBreaker`, `abortableFetch`, `throttledMap`, `armorHeaders` / `armorHeadersObject`, `withArmor`.
- Zero runtime dependencies.
- Extracted from a production INUIT Corp ERP integration where the 4-layer pattern took wall time from 30s+ down to under 2s on a 20-way concurrent burst.
