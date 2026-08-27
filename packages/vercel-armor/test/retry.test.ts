import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { abortableFetch } from "../src/abortable-fetch.js";
import type { ArmorEvent } from "../src/events.js";

const realFetch = globalThis.fetch;

function mockFetchSequence(responses: Array<() => Promise<Response> | Response>) {
  let i = 0;
  globalThis.fetch = vi.fn(async () => {
    const nextResponse = responses[i] ?? responses[responses.length - 1];
    i++;
    if (!nextResponse) throw new Error("no mock response available");
    return await nextResponse();
  }) as unknown as typeof fetch;
}

beforeEach(() => { globalThis.fetch = realFetch; });
afterEach(() => { globalThis.fetch = realFetch; });

describe("abortableFetch — retry with backoff", () => {
  it("retries on 503 and eventually succeeds", async () => {
    mockFetchSequence([
      () => new Response("dead", { status: 503 }),
      () => new Response("dead", { status: 503 }),
      () => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json" } }),
    ]);
    const events: ArmorEvent[] = [];
    const r = await abortableFetch<{ ok: number }>("https://x.test/", {
      retry: { attempts: 3, baseMs: 5, jitter: 0, random: () => 0.5 },
      onEvent: (e) => events.push(e),
    });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(r.data).toEqual({ ok: 1 });
    expect(events.filter((e) => e.type === "fetch_retry")).toHaveLength(2);
  });

  it("gives up after exhausting attempts, returning the last failure", async () => {
    mockFetchSequence([
      () => new Response("dead", { status: 500 }),
      () => new Response("dead", { status: 500 }),
    ]);
    const r = await abortableFetch("https://x.test/", {
      retry: { attempts: 2, baseMs: 1, jitter: 0, random: () => 0 },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
    expect(r.attempts).toBe(2);
  });

  it("honors Retry-After header on 429", async () => {
    mockFetchSequence([
      () => new Response("slow", { status: 429, headers: { "retry-after": "1" } }),
      () => new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json" } }),
    ]);
    const events: ArmorEvent[] = [];
    const start = performance.now();
    const r = await abortableFetch("https://x.test/", {
      retry: { attempts: 2 },
      onEvent: (e) => events.push(e),
    });
    const elapsed = performance.now() - start;
    expect(r.ok).toBe(true);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(events.some((e) => e.type === "fetch_rate_limited")).toBe(true);
    const retryEvent = events.find((e) => e.type === "fetch_retry");
    expect(retryEvent).toBeDefined();
    if (retryEvent?.type === "fetch_retry") {
      expect(retryEvent.delayMs).toBe(1000);
      expect(retryEvent.reason).toBe("rate_limited");
    }
  });

  it("does NOT retry when Retry-After exceeds maxRetryAfterSec", async () => {
    mockFetchSequence([
      () => new Response("slow", { status: 429, headers: { "retry-after": "999" } }),
    ]);
    const r = await abortableFetch("https://x.test/", {
      retry: { attempts: 5, maxRetryAfterSec: 5 },
    });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(r.attempts).toBe(1);
  });

  it("uses exponential backoff with jitter", async () => {
    mockFetchSequence([
      () => new Response("dead", { status: 502 }),
      () => new Response("dead", { status: 502 }),
      () => new Response("dead", { status: 502 }),
      () => new Response("dead", { status: 502 }),
    ]);
    const delays: number[] = [];
    const events: ArmorEvent[] = [];
    await abortableFetch("https://x.test/", {
      retry: { attempts: 4, baseMs: 10, jitter: 0, random: () => 0.5 },
      onEvent: (e) => {
        events.push(e);
        if (e.type === "fetch_retry") delays.push(e.delayMs);
      },
    });
    // With jitter=0 and baseMs=10: 10 * 2^0=10, 10 * 2^1=20, 10 * 2^2=40
    expect(delays).toEqual([10, 20, 40]);
  });

  it("does not retry on non-retryable statuses", async () => {
    mockFetchSequence([
      () => new Response("not found", { status: 404 }),
    ]);
    const r = await abortableFetch("https://x.test/", {
      retry: { attempts: 3 },
    });
    expect(r.attempts).toBe(1);
    expect(r.status).toBe(404);
  });

  it("skips retry when retryOnNetworkError=false and status is 0", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const r = await abortableFetch("https://x.test/", {
      retry: { attempts: 3, retryOnNetworkError: false },
    });
    expect(r.ok).toBe(false);
    expect(r.attempts).toBe(1);
  });
});
