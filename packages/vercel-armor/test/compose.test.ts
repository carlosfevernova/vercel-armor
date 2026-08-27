import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker.js";
import { withArmor } from "../src/compose.js";

describe("withArmor", () => {
  it("live path: returns ok when fetcher succeeds", async () => {
    const cb = new CircuitBreaker();
    const r = await withArmor({ cb }, async () => ({ value: 42 }));
    expect(r.status).toBe("ok");
    expect(r.source).toBe("live");
    expect(r.data).toEqual({ value: 42 });
    expect(r.cbOpen).toBe(false);
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
    expect(r.errorInfo).toBe("circuit_breaker_open");
  });

  it("propagates fallback failure into errorInfo", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    const r = await withArmor(
      {
        cb,
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
  });

  it("fetcher success on closed CB after prior fails clears failures", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    cb.recordFail();
    cb.recordFail();
    await withArmor({ cb }, async () => "ok");
    // Now 2 more fails should NOT trip because record-success cleared prior counts.
    cb.recordFail();
    cb.recordFail();
    expect(cb.state).toBe("closed");
  });
});
