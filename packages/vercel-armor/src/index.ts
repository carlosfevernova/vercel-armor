export { CircuitBreaker } from "./circuit-breaker.js";
export type {
  CircuitBreakerOptions,
  CircuitState,
  CircuitCheckResult,
  CircuitMetrics,
} from "./circuit-breaker.js";

export {
  getCircuitBreaker,
  registerCircuitBreaker,
  listCircuitBreakers,
  clearCircuitBreakers,
} from "./registry.js";

export { abortableFetch } from "./abortable-fetch.js";
export type {
  AbortableFetchOptions,
  AbortableFetchResult,
  RetryOptions,
} from "./abortable-fetch.js";

export { throttledMap } from "./throttled-map.js";

export { armorHeaders, armorHeadersObject } from "./cache-headers.js";
export type { ArmorHeadersOptions, HeaderSink } from "./cache-headers.js";

export { withArmor } from "./compose.js";
export type {
  WithArmorOptions,
  ArmorResult,
  ArmorStatus,
  ArmorSource,
} from "./compose.js";

export { armoredRoute } from "./route-wrapper.js";
export type { ArmoredRouteOptions } from "./route-wrapper.js";

export { safeEmit } from "./events.js";
export type { ArmorEvent, ArmorEventType, ArmorEventHandler } from "./events.js";

export const VERSION = "0.2.0";
