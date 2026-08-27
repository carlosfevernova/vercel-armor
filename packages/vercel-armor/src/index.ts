export { CircuitBreaker } from "./circuit-breaker.js";
export type {
  CircuitBreakerOptions,
  CircuitState,
  CircuitCheckResult,
} from "./circuit-breaker.js";

export { abortableFetch } from "./abortable-fetch.js";
export type { AbortableFetchOptions, AbortableFetchResult } from "./abortable-fetch.js";

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

export const VERSION = "0.1.0";
