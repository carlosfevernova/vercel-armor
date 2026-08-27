import { NextResponse } from "next/server";
import { listCircuitBreakers } from "vercel-armor";
import { readEvents } from "../_event-log";

export const dynamic = "force-dynamic";

export async function GET() {
  const breakers = Array.from(listCircuitBreakers().values()).map((cb) => cb.metrics());
  return NextResponse.json(
    {
      generatedAt: Date.now(),
      breakers,
      events: readEvents(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
