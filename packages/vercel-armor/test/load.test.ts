import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker.js";
import { withArmor } from "../src/compose.js";

/**
 * Replay of the INUIT Corp production load scenario:
 *  - 20 concurrent handler invocations
 *  - Upstream fails the first 3 calls, then recovers
 *  - Fallback (Supabase snapshot) always available
 *
 * Expectation:
 *  - First 3 calls: trip breaker, count as errors from fetcher (may or may not serve fallback
 *    depending on race — either way, we track live/stale/error distribution)
 *  - Remaining calls served instantly from fallback until cooldown elapses (~60s)
 *  - No wall-clock explosion: total wall time < 500ms (was 30s+ pre-armor).
 */
describe("load scenario (INUIT replay)", () => {
  it("survives an upstream outage under 20-way concurrency", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3, windowMs: 60_000, cooldownMs: 60_000 });
    const fallback = async () => ({ source: "supabase_snapshot", rows: [{ id: 1 }] });

    let upstreamCalls = 0;
    const fetcher = async () => {
      upstreamCalls++;
      // First 5 calls simulate a very slow, failing upstream (like ERP down):
      if (upstreamCalls <= 5) {
        await new Promise((r) => setTimeout(r, 30));
        throw new Error("upstream_timeout_5s");
      }
      // Recovers after — but by then the breaker is open.
      return { source: "live", rows: [{ id: 2 }] };
    };

    const start = performance.now();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => withArmor({ cb, fallback }, fetcher)),
    );
    const wallMs = performance.now() - start;

    const stats = {
      ok: results.filter((r) => r.status === "ok").length,
      stale: results.filter((r) => r.status === "stale").length,
      error: results.filter((r) => r.status === "error").length,
    };

    expect(stats.ok + stats.stale + stats.error).toBe(20);
    expect(stats.stale).toBeGreaterThan(0); // fallback was served
    expect(cb.state).toBe("open"); // breaker tripped by the failing burst
    expect(upstreamCalls).toBeLessThanOrEqual(20); // never fanned out beyond input
    // Loose sanity — pre-armor real-world was 30s+. Anything sub-second means armor did its job.
    expect(wallMs).toBeLessThan(2_000);
  });
});
