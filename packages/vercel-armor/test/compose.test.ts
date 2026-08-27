import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker.js";
import type { ArmorEvent } from "../src/events.js";
import { withArmor } from "../src/compose.js";

describe("withArmor", () => {
  it("live path: returns ok when fetcher succeeds", async () => {
    const cb = new CircuitBreaker();
    const r = await withArmor({ cb }, async () => ({ value: 42 }));
    expect(r.status).toBe("ok");
    expect(r.source).toBe("live");
    expect(r.data).toEqual({ value: 42 });
    expect(r.cbOpen).toBe(false);
    expect(r.cbState).toBe("closed");
  });

  it("recordFail on fetcher throw + fallback served as stale", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    const r = await withArmor(
      { cb, fallback: async () => ({ cached: true }) },
      async () => {
        throw new Error("upstream_down");
      },
    );
    expect(r.status).toBe("stale");
    expect(r.source).toBe("fallback");
    expect(r.data).toEqual({ cached: true });
    expect(r.errorInfo).toContain("upstream_down");
  });

  it("errors out when fetcher fails and no fallback", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    const r = await withArmor({ cb }, async () => {
      throw new Error("nope");
    });
    expect(r.status).toBe("error");
    expect(r.source).toBe("none");
    expect(r.errorInfo).toContain("nope");
  });

  it("skips fetcher and serves fallback when breaker already open", async () => {
    const cb = new CircuitBreaker({ failThreshold: 2, cooldownMs: 60_000 });
    cb.recordFail();
    cb.recordFail();
    expect(cb.state).toBe("open");

    let fetcherCalled = false;
    const r = await withArmor(
      { cb, fallback: async () => ({ stored: 1 }) },
      async () => {
        fetcherCalled = true;
        return { stored: 999 };
      },
    );
    expect(fetcherCalled).toBe(false);
    expect(r.status).toBe("stale");
    expect(r.cbOpen).toBe(true);
    expect(r.cbState).toBe("open");
    expect(r.cbRemainingMs).toBeGreaterThan(0);
    expect(r.data).toEqual({ stored: 1 });
  });

  it("returns error when breaker open and no fallback", async () => {
    const cb = new CircuitBreaker({ failThreshold: 2 });
    cb.recordFail();
    cb.recordFail();
    const r = await withArmor({ cb }, async () => "live");
    expect(r.status).toBe("error");
    expect(r.source).toBe("none");
    expect(r.cbOpen).toBe(true);
  });

  it("propagates fallback failure into errorInfo + emits fallback_failed", async () => {
    const events: ArmorEvent[] = [];
    const cb = new CircuitBreaker({ failThreshold: 3 });
    const r = await withArmor(
      {
        cb,
        onEvent: (e) => events.push(e),
        fallback: async () => {
          throw new Error("db_offline");
        },
      },
      async () => {
        throw new Error("upstream_down");
      },
    );
    expect(r.status).toBe("error");
    expect(r.errorInfo).toContain("upstream_down");
    expect(r.errorInfo).toContain("db_offline");
    expect(events.some((e) => e.type === "fallback_failed")).toBe(true);
  });

  it("emits fallback_served when the fallback returns data", async () => {
    const events: ArmorEvent[] = [];
    const cb = new CircuitBreaker({ failThreshold: 3, name: "erp" });
    await withArmor(
      { cb, onEvent: (e) => events.push(e), fallback: async () => ({ ok: 1 }) },
      async () => {
        throw new Error("boom");
      },
    );
    const served = events.find((e) => e.type === "fallback_served");
    expect(served).toBeDefined();
    if (served?.type === "fallback_served") {
      expect(served.name).toBe("erp");
      expect(served.reason).toContain("boom");
    }
  });

  it("half-open probe: one caller runs fetcher, others go straight to fallback", async () => {
    const clock = { t: 1_000_000, now: () => clock.t };
    const cb = new CircuitBreaker({
      failThreshold: 2,
      cooldownMs: 100,
      now: clock.now,
    });
    cb.recordFail();
    cb.recordFail();
    clock.t += 101;
    expect(cb.state).toBe("half-open");

    let fetcherRuns = 0;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        withArmor(
          { cb, fallback: async () => ({ from: "cache" }) },
          async () => {
            fetcherRuns++;
            await new Promise((r) => setTimeout(r, 5));
            return { from: "live" };
          },
        ),
      ),
    );
    expect(fetcherRuns).toBe(1);
    const live = results.filter((r) => r.status === "ok");
    const stale = results.filter((r) => r.status === "stale");
    expect(live).toHaveLength(1);
    expect(stale).toHaveLength(4);
    expect(cb.state).toBe("closed");
  });

  it("fetcher success on closed CB after prior fails clears failures", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    cb.recordFail();
    cb.recordFail();
    await withArmor({ cb }, async () => "ok");
    cb.recordFail();
    cb.recordFail();
    expect(cb.state).toBe("closed");
  });
});
