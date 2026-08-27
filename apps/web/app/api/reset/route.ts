import { NextResponse } from "next/server";
import { getCircuitBreaker } from "vercel-armor";
import { clearEvents } from "../_event-log";

export const dynamic = "force-dynamic";

/** POST /api/reset — clears the demo CB and event log. Wired to the demo UI's "Reset" button. */
export async function POST() {
  const cb = getCircuitBreaker("demo-upstream");
  cb.reset();
  clearEvents();
  return NextResponse.json({ ok: true, resetAt: Date.now() }, { headers: { "cache-control": "no-store" } });
}
