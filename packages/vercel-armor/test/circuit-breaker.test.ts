import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker.js";
import type { ArmorEvent } from "../src/events.js";

function makeClock(start = 1_700_000_000_000) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("CircuitBreaker — v0.2 three-state machine", () => {
  it("starts closed", () => {
    const cb = new CircuitBreaker();
    expect(cb.state).toBe("closed");
    expect(cb.check().open).toBe(false);
  });

  it("stays closed below failThreshold", () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    cb.recordFail();
    cb.recordFail();
    expect(cb.state).toBe("closed");
  });

  it("trips open at failThreshold", () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    cb.recordFail();
    cb.recordFail();
    cb.recordFail();
    expect(cb.state).toBe("open");
  });

  it("drops failures outside the window", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failThreshold: 3, windowMs: 1000, now: clock.now });
    cb.recordFail();
    cb.recordFail();
    clock.advance(1500);
    cb.recordFail();
    expect(cb.state).toBe("closed");
  });

  it("transitions open → half-open after cooldown elapses", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      failThreshold: 2,
      windowMs: 60_000,
      cooldownMs: 5_000,
      now: clock.now,
    });
    cb.recordFail();
    cb.recordFail();
    expect(cb.state).toBe("open");
    clock.advance(4_999);
    expect(cb.state).toBe("open");
    clock.advance(2);
    expect(cb.state).toBe("half-open");
  });

  it("half-open: first probe caller wins, others get 'open' semantics", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failThreshold: 2, cooldownMs: 100, now: clock.now });
    cb.recordFail();
    cb.recordFail();
    clock.advance(101);
    expect(cb.state).toBe("half-open");

    expect(cb.tryAcquireProbe()).toBe(true);
    expect(cb.tryAcquireProbe()).toBe(false);
    expect(cb.tryAcquireProbe()).toBe(false);
  });

  it("probe success closes the breaker", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failThreshold: 2, cooldownMs: 100, now: clock.now });
    cb.recordFail();
    cb.recordFail();
    clock.advance(101);
    cb.tryAcquireProbe();
    cb.recordSuccess();
    expect(cb.state).toBe("closed");
  });

  it("probe failure re-opens with fresh cooldown", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failThreshold: 2, cooldownMs: 100, now: clock.now });
    cb.recordFail();
    cb.recordFail();
    clock.advance(101);
    cb.tryAcquireProbe();
    cb.recordFail();
    expect(cb.state).toBe("open");
    // Cooldown reset by the probe failure
    const remaining = cb.check().remainingMs ?? 0;
    expect(remaining).toBeGreaterThan(90);
    expect(remaining).toBeLessThanOrEqual(100);
  });

  it("recordSuccess clears failures in closed state", () => {
    const cb = new CircuitBreaker({ failThreshold: 3 });
    cb.recordFail();
    cb.recordFail();
    cb.recordSuccess();
    cb.recordFail();
    cb.recordFail();
    expect(cb.state).toBe("closed");
  });

  it("reset() forces closed", () => {
    const cb = new CircuitBreaker({ failThreshold: 2 });
    cb.recordFail();
    cb.recordFail();
    expect(cb.state).toBe("open");
    cb.reset();
    expect(cb.state).toBe("closed");
  });

  it("metrics() reports state, failCount, remaining cooldown, probe flag", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      name: "erp",
      failThreshold: 2,
      cooldownMs: 1_000,
      now: clock.now,
    });
    expect(cb.metrics()).toMatchObject({ name: "erp", state: "closed", failCount: 0 });
    cb.recordFail();
    cb.recordFail();
    const m1 = cb.metrics();
    expect(m1.state).toBe("open");
    expect(m1.failCount).toBe(2);
    expect(m1.remainingCooldownMs).toBeGreaterThan(0);
    clock.advance(1_001);
    const m2 = cb.metrics();
    expect(m2.state).toBe("half-open");
    expect(m2.remainingCooldownMs).toBe(0);
    cb.tryAcquireProbe();
    expect(cb.metrics().probeInFlight).toBe(true);
  });

  it("emits events for every state transition", () => {
    const clock = makeClock();
    const events: ArmorEvent[] = [];
    const cb = new CircuitBreaker({
      name: "erp",
      failThreshold: 2,
      cooldownMs: 100,
      now: clock.now,
      onEvent: (e) => events.push(e),
    });
    cb.recordFail();
    cb.recordFail();
    // circuit_opened
    clock.advance(101);
    cb.tryAcquireProbe(); // triggers circuit_half_open
    cb.recordFail(); // probe_failed + circuit_opened
    clock.advance(101);
    cb.tryAcquireProbe(); // circuit_half_open (again)
    cb.recordSuccess(); // probe_succeeded + circuit_closed

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "circuit_opened",
      "circuit_half_open",
      "probe_failed",
      "circuit_opened",
      "circuit_half_open",
      "probe_succeeded",
      "circuit_closed",
    ]);
    for (const e of events) expect(e.name).toBe("erp");
  });

  it("emits circuit_closed when reset() is called on an open breaker", () => {
    const events: ArmorEvent[] = [];
    const cb = new CircuitBreaker({
      failThreshold: 1,
      onEvent: (e) => events.push(e),
    });
    cb.recordFail();
    cb.reset();
    expect(events.map((e) => e.type)).toEqual(["circuit_opened", "circuit_closed"]);
  });

  it("swallows exceptions thrown by onEvent handler", () => {
    const cb = new CircuitBreaker({
      failThreshold: 1,
      onEvent: () => {
        throw new Error("telemetry_broken");
      },
    });
    // Must not throw even though onEvent threw.
    expect(() => cb.recordFail()).not.toThrow();
    expect(cb.state).toBe("open");
  });

  it("check() is idempotent — calling it does not mutate state", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({ failThreshold: 1, cooldownMs: 1_000, now: clock.now });
    cb.recordFail();
    const spy = vi.fn();
    cb.check();
    cb.check();
    cb.check();
    expect(cb.state).toBe("open"); // Still open, not accidentally reset
  });
});
