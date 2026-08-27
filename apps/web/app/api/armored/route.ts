import { armoredRoute, getCircuitBreaker } from "vercel-armor";
import { simulateFlakyUpstream } from "../_flaky-upstream";
import { recordEvent } from "../_event-log";

export const dynamic = "force-dynamic";

const cb = getCircuitBreaker("demo-upstream", {
  failThreshold: 3,
  windowMs: 60_000,
  cooldownMs: 20_000,
  onEvent: recordEvent,
});

let lastKnownGood: unknown = null;

export const GET = armoredRoute({
  cb,
  fetcher: async () => {
    const data = await simulateFlakyUpstream();
    lastKnownGood = data;
    return data;
  },
  fallback: () => lastKnownGood,
  onEvent: recordEvent,
});
