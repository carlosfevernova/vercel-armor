/**
 * Discriminated union of all observable events emitted by the library.
 * Wire this into your telemetry pipe (Sentry, OTel, Datadog, plain console) via
 * `onEvent` on CircuitBreaker or armoredRoute options.
 */
export type ArmorEvent =
  | { type: "circuit_opened"; name?: string; failCount: number }
  | { type: "circuit_closed"; name?: string }
  | { type: "circuit_half_open"; name?: string }
  | { type: "probe_succeeded"; name?: string }
  | { type: "probe_failed"; name?: string }
  | { type: "fetch_timeout"; url?: string; timeoutMs: number }
  | { type: "fetch_retry"; url?: string; attempt: number; delayMs: number; reason: string }
  | { type: "fetch_rate_limited"; url?: string; retryAfterSec?: number }
  | { type: "fallback_served"; name?: string; reason: string }
  | { type: "fallback_failed"; name?: string; reason: string };

export type ArmorEventType = ArmorEvent["type"];

export type ArmorEventHandler = (event: ArmorEvent) => void;

/**
 * Safely emit an event without letting handler errors break the request path.
 * Observability must never take down the endpoint it's observing.
 */
export function safeEmit(handler: ArmorEventHandler | undefined, event: ArmorEvent): void {
  if (!handler) return;
  try {
    handler(event);
  } catch {
    /* observability handler threw — swallow so the request continues */
  }
}
