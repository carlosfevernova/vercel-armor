import { NextResponse } from "next/server";
import { CircuitBreaker, withArmor, armorHeadersObject } from "vercel-armor";
import { simulateFlakyUpstream } from "../_flaky-upstream";

export const dynamic = "force-dynamic";

// Module-scoped: state persists across warm invocations, exactly as it does in prod.
const cb = new CircuitBreaker({ failThreshold: 3, windowMs: 60_000, cooldownMs: 20_000 });

let lastKnownGood: unknown = null;

async function fallbackFromSnapshot() {
  return lastKnownGood;
}

export async function GET() {
  const result = await withArmor(
    { cb, fallback: fallbackFromSnapshot },
    async () => {
      const data = await simulateFlakyUpstream();
      lastKnownGood = data;
      return data;
    },
  );

  const headers = {
    ...armorHeadersObject({ cacheable: result.status === "ok" }),
    "x-armor-status": result.status,
    ...(result.cbOpen ? { "x-armor-cb-remaining-ms": String(result.cbRemainingMs ?? 0) } : {}),
  };

  const httpStatus = result.status === "error" ? 503 : 200;
  return NextResponse.json(result, { status: httpStatus, headers });
}
