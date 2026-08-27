import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker.js";
import type { ArmorEvent } from "../src/events.js";
import { armoredRoute } from "../src/route-wrapper.js";

function makeReq(): Request {
  return new Request("http://localhost/test");
}

describe("armoredRoute", () => {
  it("returns 200 + ok on fetcher success", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    const handler = armoredRoute({
      cb,
      fetcher: async () => ({ hello: "world" }),
    });
    const res = await handler(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-armor-status")).toBe("ok");
    expect(res.headers.get("x-armor-cb-state")).toBe("closed");
    expect(res.headers.get("cache-control")).toContain("s-maxage");
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.data).toEqual({ hello: "world" });
  });

  it("returns 200 (default) + stale when fetcher fails but fallback provides data", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    const handler = armoredRoute({
      cb,
      fetcher: async () => {
        throw new Error("upstream_down");
      },
      fallback: async () => ({ from: "cache" }),
    });
    const res = await handler(makeReq());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-armor-status")).toBe("stale");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.status).toBe("stale");
    expect(body.data).toEqual({ from: "cache" });
  });

  it("returns 503 (default) + error when both fetcher and fallback fail", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    const handler = armoredRoute({
      cb,
      fetcher: async () => {
        throw new Error("upstream_down");
      },
    });
    const res = await handler(makeReq());
    expect(res.status).toBe(503);
    expect(res.headers.get("x-armor-status")).toBe("error");
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.errorInfo).toContain("upstream_down");
  });

  it("respects custom errorStatus + staleStatus", async () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    const staleHandler = armoredRoute({
      cb,
      fetcher: async () => {
        throw new Error("nope");
      },
      fallback: async () => "cached",
      staleStatus: 203,
    });
    const errorHandler = armoredRoute({
      cb: new CircuitBreaker({ failThreshold: 3 }),
      fetcher: async () => {
        throw new Error("nope");
      },
      errorStatus: 502,
    });
    expect((await staleHandler(makeReq())).status).toBe(203);
    expect((await errorHandler(makeReq())).status).toBe(502);
  });

  it("skips fetcher when breaker is open and serves fallback", async () => {
    const cb = new CircuitBreaker({ failThreshold: 2, cooldownMs: 60_000 });
    cb.recordFail();
    cb.recordFail();
    let called = false;
    const handler = armoredRoute({
      cb,
      fetcher: async () => {
        called = true;
        return { live: true };
      },
      fallback: async () => ({ live: false }),
    });
    const res = await handler(makeReq());
    expect(called).toBe(false);
    expect(res.headers.get("x-armor-status")).toBe("stale");
    expect(res.headers.get("x-armor-cb-state")).toBe("open");
    expect(Number(res.headers.get("x-armor-cb-remaining-ms"))).toBeGreaterThan(0);
  });

  it("applies serialize() to shape the data field", async () => {
    const cb = new CircuitBreaker();
    const handler = armoredRoute({
      cb,
      fetcher: async () => ({ deep: { hidden: "secret", public: 42 } }),
      serialize: (d) => ({ public: d.deep.public }),
    });
    const body = await (await handler(makeReq())).json();
    expect(body.data).toEqual({ public: 42 });
    expect(body.data.hidden).toBeUndefined();
  });

  it("passes the incoming Request through to fetcher and fallback", async () => {
    const cb = new CircuitBreaker();
    const seen: { fetcher?: string; fallback?: string } = {};
    const handler = armoredRoute({
      cb,
      fetcher: async (req) => {
        seen.fetcher = new URL(req.url).pathname;
        throw new Error("die");
      },
      fallback: async (req) => {
        seen.fallback = new URL(req.url).pathname;
        return { stale: true };
      },
    });
    await handler(new Request("http://localhost/inventory/34?force=1"));
    expect(seen.fetcher).toBe("/inventory/34");
    expect(seen.fallback).toBe("/inventory/34");
  });

  it("forwards onEvent hook to composed layers", async () => {
    const events: ArmorEvent[] = [];
    const cb = new CircuitBreaker({ failThreshold: 3 });
    const handler = armoredRoute({
      cb,
      fetcher: async () => {
        throw new Error("boom");
      },
      fallback: async () => ({ from: "db" }),
      onEvent: (e) => events.push(e),
    });
    await handler(makeReq());
    expect(events.some((e) => e.type === "fallback_served")).toBe(true);
  });
});
