import { describe, expect, it, vi } from "vitest";
import { armorHeaders, armorHeadersObject } from "../src/cache-headers.js";

describe("armorHeaders (Node-style)", () => {
  it("applies default cache-control", () => {
    const setHeader = vi.fn();
    armorHeaders({ setHeader });
    expect(setHeader).toHaveBeenCalledWith(
      "cache-control",
      "public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400",
    );
  });

  it("applies no-store when cacheable=false", () => {
    const setHeader = vi.fn();
    armorHeaders({ setHeader }, { cacheable: false });
    expect(setHeader).toHaveBeenCalledWith("cache-control", "no-store");
  });

  it("honors custom durations", () => {
    const setHeader = vi.fn();
    armorHeaders({ setHeader }, { sMaxAge: 10, staleWhileRevalidate: 20, staleIfError: 30 });
    expect(setHeader).toHaveBeenCalledWith(
      "cache-control",
      "public, s-maxage=10, stale-while-revalidate=20, stale-if-error=30",
    );
  });

  it("adds vary when provided", () => {
    const setHeader = vi.fn();
    armorHeaders({ setHeader }, { vary: "accept-language" });
    expect(setHeader).toHaveBeenCalledWith("vary", "accept-language");
  });
});

describe("armorHeadersObject (Web-style)", () => {
  it("returns a headers object with defaults", () => {
    const h = armorHeadersObject();
    expect(h["cache-control"]).toBe(
      "public, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400",
    );
  });

  it("no-store on cacheable=false", () => {
    const h = armorHeadersObject({ cacheable: false });
    expect(h["cache-control"]).toBe("no-store");
  });
});
