import { afterEach, describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker.js";
import {
  clearCircuitBreakers,
  getCircuitBreaker,
  listCircuitBreakers,
  registerCircuitBreaker,
} from "../src/registry.js";

afterEach(() => clearCircuitBreakers());

describe("registry", () => {
  it("getCircuitBreaker returns the same instance on repeat calls", () => {
    const a = getCircuitBreaker("erp", { failThreshold: 5 });
    const b = getCircuitBreaker("erp");
    expect(a).toBe(b);
  });

  it("distinct names get distinct instances", () => {
    const a = getCircuitBreaker("erp");
    const b = getCircuitBreaker("crm");
    expect(a).not.toBe(b);
    expect(a.name).toBe("erp");
    expect(b.name).toBe("crm");
  });

  it("registerCircuitBreaker overwrites existing entries", () => {
    const first = getCircuitBreaker("erp");
    const mock = new CircuitBreaker({ name: "erp", failThreshold: 999 });
    registerCircuitBreaker("erp", mock);
    expect(getCircuitBreaker("erp")).toBe(mock);
    expect(getCircuitBreaker("erp")).not.toBe(first);
  });

  it("listCircuitBreakers exposes all registered", () => {
    getCircuitBreaker("erp");
    getCircuitBreaker("crm");
    const list = listCircuitBreakers();
    expect([...list.keys()].sort()).toEqual(["crm", "erp"]);
  });

  it("clearCircuitBreakers removes all entries", () => {
    getCircuitBreaker("erp");
    clearCircuitBreakers();
    expect(listCircuitBreakers().size).toBe(0);
  });
});
