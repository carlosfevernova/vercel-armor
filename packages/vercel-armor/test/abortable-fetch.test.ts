import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abortableFetch } from "../src/abortable-fetch.js";

const realFetch = globalThis.fetch;

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

beforeEach(() => {
  globalThis.fetch = realFetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("abortableFetch", () => {
  it("returns parsed JSON on success", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const r = await abortableFetch<{ hello: string }>("https://x.test/");
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.data).toEqual({ hello: "world" });
  });

  it("returns raw text when content-type is not JSON", async () => {
    mockFetch(async () => new Response("plain body", { status: 200 }));
    const r = await abortableFetch<string>("https://x.test/");
    expect(r.ok).toBe(true);
    expect(r.data).toBe("plain body");
  });

  it("returns ok=false + error preview on non-2xx", async () => {
    mockFetch(async () => new Response("boom internal", { status: 500 }));
    const r = await abortableFetch("https://x.test/");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.error).toContain("boom");
  });

  it("parses retry-after seconds on 429", async () => {
    mockFetch(async () =>
      new Response("slow down", { status: 429, headers: { "retry-after": "42" } }),
    );
    const r = await abortableFetch("https://x.test/");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(r.retryAfterSec).toBe(42);
  });

  it("aborts on timeout and reports timedOut", async () => {
    mockFetch(
      (_, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const r = await abortableFetch("https://x.test/", { timeoutMs: 20 });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
    expect(r.error).toMatch(/timeout_20ms/);
  });

  it("respects an already-aborted external signal", async () => {
    const externalCtrl = new AbortController();
    externalCtrl.abort("upstream_cancelled");
    const r = await abortableFetch("https://x.test/", { signal: externalCtrl.signal });
    expect(r.ok).toBe(false);
    expect(r.error).toBe("aborted_before_start");
  });

  it("composes external signal with internal timeout", async () => {
    mockFetch(
      (_, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const externalCtrl = new AbortController();
    setTimeout(() => externalCtrl.abort(), 10);
    const r = await abortableFetch("https://x.test/", {
      timeoutMs: 10_000,
      signal: externalCtrl.signal,
    });
    expect(r.ok).toBe(false);
    expect(r.timedOut).toBe(true);
  });
});
