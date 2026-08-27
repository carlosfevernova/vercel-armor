import { NextResponse } from "next/server";
import { simulateFlakyUpstream } from "../_flaky-upstream";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await simulateFlakyUpstream();
    return NextResponse.json({ status: "ok", source: "live", data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ status: "error", source: "none", error: msg }, { status: 502 });
  }
}
