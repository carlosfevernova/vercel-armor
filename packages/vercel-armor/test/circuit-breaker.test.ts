import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "../src/circuit-breaker.js";

function makeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("CircuitBreaker", () => {
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

  it("stays open during cooldown, then auto-resets", () => {
    const clock = makeClock();
    const cb = new CircuitBreaker({
      failThreshold: 2,
      windowMs: 60_000,
      cooldownMs: 5_000,
      now: clock.now,
    });
    cb.recordFail();
    cb.recordFail();
    expect(cb.check().open).toBe(true);
    expect(cb.check().remainingMs).toBe(5_000);

    clock.advance(3_000);
    const mid = cb.check();
    expect(mid.open).toBe(true);
    expect(mid.remainingMs).toBe(2_000);

    clock.advance(2_500);
    expect(cb.check().open).toBe(false);
  });

  it("recordSuccess clears failures", () => {
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
});
