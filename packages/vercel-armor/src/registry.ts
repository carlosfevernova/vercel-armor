import { CircuitBreaker, type CircuitBreakerOptions } from "./circuit-breaker.js";

const registry = new Map<string, CircuitBreaker>();

/**
 * Get or create a named CircuitBreaker singleton. Reuses the same instance
 * across imports within a warm serverless invocation — which is exactly what
 * you want when you have one CB per external dependency (ERP, third-party API,
 * legacy DB).
 *
 * Options are only honored the first time the name is registered. Subsequent
 * calls with the same name return the existing instance regardless of options,
 * so put the config next to the first call site or centralize with `registerCircuitBreaker`.
 */
export function getCircuitBreaker(name: string, opts?: CircuitBreakerOptions): CircuitBreaker {
  let cb = registry.get(name);
  if (!cb) {
    cb = new CircuitBreaker({ ...opts, name });
    registry.set(name, cb);
  }
  return cb;
}

/**
 * Explicit registration — overwrites any existing entry. Useful in tests or
 * when you want to hot-swap a breaker instance with a mock.
 */
export function registerCircuitBreaker(name: string, cb: CircuitBreaker): void {
  registry.set(name, cb);
}

/** Iterate all currently-registered breakers. Useful for a `/api/telemetry` route. */
export function listCircuitBreakers(): ReadonlyMap<string, CircuitBreaker> {
  return registry;
}

/** Test hook — remove all registered breakers. */
export function clearCircuitBreakers(): void {
  registry.clear();
}
