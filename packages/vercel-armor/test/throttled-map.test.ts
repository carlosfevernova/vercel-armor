import { describe, expect, it } from "vitest";
import { throttledMap } from "../src/throttled-map.js";

describe("throttledMap", () => {
  it("returns empty for empty input", async () => {
    const out = await throttledMap([], 5, async (x) => x);
    expect(out).toEqual([]);
  });

  it("preserves input order in output", async () => {
    const items = [1, 2, 3, 4, 5, 6, 7];
    const out = await throttledMap(items, 3, async (n) => {
      await new Promise((r) => setTimeout(r, (7 - n) * 5));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });

  it("never exceeds the configured concurrency", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await throttledMap(items, 4, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it("throws on invalid concurrency", async () => {
    await expect(throttledMap([1], 0, async (x) => x)).rejects.toThrow(RangeError);
    await expect(throttledMap([1], -1, async (x) => x)).rejects.toThrow(RangeError);
    await expect(throttledMap([1], 1.5, async (x) => x)).rejects.toThrow(RangeError);
  });

  it("propagates fn errors", async () => {
    await expect(
      throttledMap([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});
