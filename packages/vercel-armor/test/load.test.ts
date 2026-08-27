import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker.js";
import { withArmor } from "../src/compose.js";

/**
 * Replay of the INUIT Corp production load scenario:
 *  - 20 concurrent handler invocations
 *  - Upstream fails the first 5 calls, then recovers
 *  - Fallback (Supabase snapshot) always available
 */
describe("load scenario (INUIT replay)", () => {
  it("survives an upstream outage under 20-way concurrency", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3, windowMs: 60_000, cooldownMs: 60_000 });
    const fallback = async () => ({ source: "supabase_snapshot", rows: [{ id: 1 }] });

    let upstreamCalls = 0;
    const fetcher = async () => {
      upstreamCalls++;
      if (upstreamCalls <= 5) {
        await new Promise((r) => setTimeout(r, 30));
        throw new Error("upstream_timeout_5s");
      }
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
    expect(stats.stale).toBeGreaterThan(0);
    expect(cb.state).toBe("open");
    expect(upstreamCalls).toBeLessThanOrEqual(20);
    expect(wallMs).toBeLessThan(2_000);
  });
});
