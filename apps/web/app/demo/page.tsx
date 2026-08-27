"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type CallResult = {
  status: number;
  wallMs: number;
  armorStatus: string | null;
  cbState: string | null;
};

type Aggregate = {
  count: number;
  ok: number;
  err: number;
  wallTotalMs: number;
  wallAvgMs: number;
  wallP95Ms: number;
  armorBreakdown: Record<string, number>;
};

type Breaker = {
  name?: string;
  state: "closed" | "open" | "half-open";
  failCount: number;
  trippedAt: number | null;
  remainingCooldownMs: number;
  probeInFlight: boolean;
};

type ArmorEvent = {
  type: string;
  at: number;
  name?: string;
  [k: string]: unknown;
};

const CONCURRENCY = 20;

async function callEndpoint(url: string): Promise<CallResult> {
  const t0 = performance.now();
  const res = await fetch(url);
  const wallMs = Math.round(performance.now() - t0);
  await res.text().catch(() => "");
  return {
    status: res.status,
    wallMs,
    armorStatus: res.headers.get("x-armor-status"),
    cbState: res.headers.get("x-armor-cb-state"),
  };
}

function aggregate(results: CallResult[]): Aggregate {
  const ok = results.filter((r) => r.status >= 200 && r.status < 400).length;
  const wallTotalMs = results.reduce((s, r) => s + r.wallMs, 0);
  const sorted = [...results].sort((a, b) => a.wallMs - b.wallMs);
  const p95Idx = Math.min(results.length - 1, Math.floor(results.length * 0.95));
  const armorBreakdown: Record<string, number> = {};
  for (const r of results) {
    const key = r.armorStatus ?? "raw";
    armorBreakdown[key] = (armorBreakdown[key] ?? 0) + 1;
  }
  return {
    count: results.length,
    ok,
    err: results.length - ok,
    wallTotalMs,
    wallAvgMs: Math.round(wallTotalMs / results.length),
    wallP95Ms: sorted[p95Idx]?.wallMs ?? 0,
    armorBreakdown,
  };
}

export default function DemoPage() {
  const [flaky, setFlaky] = useState<Aggregate | null>(null);
  const [armored, setArmored] = useState<Aggregate | null>(null);
  const [busy, setBusy] = useState(false);
  const [breakers, setBreakers] = useState<Breaker[]>([]);
  const [events, setEvents] = useState<ArmorEvent[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/telemetry", { cache: "no-store" });
      const j = await r.json();
      setBreakers(j.breakers ?? []);
      setEvents(j.events ?? []);
    } catch {
      /* transient, keep last */
    }
  }, []);

  useEffect(() => {
    refresh();
    if (!autoRefresh) return;
    pollRef.current = window.setInterval(refresh, 1000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [autoRefresh, refresh]);

  async function runBoth() {
    setBusy(true);
    setFlaky(null);
    setArmored(null);
    try {
      const [a, b] = await Promise.all([
        Promise.all(Array.from({ length: CONCURRENCY }, () => callEndpoint("/api/flaky"))),
        Promise.all(Array.from({ length: CONCURRENCY }, () => callEndpoint("/api/armored"))),
      ]);
      setFlaky(aggregate(a));
      setArmored(aggregate(b));
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function resetState() {
    await fetch("/api/reset", { method: "POST" });
    setFlaky(null);
    setArmored(null);
    refresh();
  }

  return (
    <main className="container">
      <p><Link href="/">← back</Link></p>
      <h1 style={{ fontSize: 32, margin: "8px 0 4px" }}>Interactive load test</h1>
      <p className="muted">
        Both endpoints hit the same simulated flaky upstream (~30% fail, 50-3000ms latency).
        Only <code>/api/armored</code> is wrapped in <code>armoredRoute</code>.
      </p>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn" onClick={runBoth} disabled={busy}>
          {busy ? "Running…" : `Fire ${CONCURRENCY}+${CONCURRENCY} requests`}
        </button>
        <button className="btn secondary" onClick={resetState} disabled={busy}>
          Reset CB + events
        </button>
        <label className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
          <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
          Auto-refresh telemetry
        </label>
      </div>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ marginBottom: 8, fontSize: 20 }}>Results</h2>
        <div className="grid-two">
          <ResultCard title="/api/flaky (raw)" data={flaky} />
          <ResultCard title="/api/armored (armored)" data={armored} />
        </div>
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ marginBottom: 8, fontSize: 20 }}>Live circuit-breaker state</h2>
        {breakers.length === 0 ? (
          <p className="muted">No breakers registered yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th><th>State</th><th>Fail count</th><th>Cooldown left</th><th>Probe in flight?</th>
              </tr>
            </thead>
            <tbody>
              {breakers.map((b) => (
                <tr key={b.name ?? "(unnamed)"}>
                  <td><code>{b.name ?? "(unnamed)"}</code></td>
                  <td>
                    <span className={`badge ${b.state === "closed" ? "ok" : b.state === "half-open" ? "stale" : "err"}`}>
                      {b.state}
                    </span>
                  </td>
                  <td>{b.failCount}</td>
                  <td>{b.remainingCooldownMs > 0 ? `${(b.remainingCooldownMs / 1000).toFixed(1)}s` : "–"}</td>
                  <td>{b.probeInFlight ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h2 style={{ marginBottom: 8, fontSize: 20 }}>Event timeline <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>(last 60)</span></h2>
        {events.length === 0 ? (
          <p className="muted">No events yet. Fire the load test to trigger some.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, maxHeight: 320, overflowY: "auto", border: "1px solid #222", borderRadius: 8 }}>
            {[...events].reverse().map((e, i) => {
              const kind = e.type.startsWith("circuit_") ? "cb" : e.type.startsWith("probe_") ? "probe" : e.type.startsWith("fetch_") ? "fetch" : "fallback";
              return (
                <li key={i} style={{ padding: "6px 12px", borderBottom: "1px solid #1a1a1a", display: "grid", gridTemplateColumns: "80px 1fr auto", gap: 8, alignItems: "center" }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {new Date(e.at).toLocaleTimeString()}
                  </span>
                  <code style={{ fontSize: 12 }}>{e.type}</code>
                  <span className="muted" style={{ fontSize: 11 }}>{kind}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ fontSize: 20 }}>What you should see</h2>
        <ul>
          <li><code>/api/flaky</code>: ~30% return 5xx, wall-times spike near 3s.</li>
          <li><code>/api/armored</code>: near-100% return 200 — a mix of <span className="badge ok">ok</span> (live) and <span className="badge stale">stale</span> (fallback).</li>
          <li>After 3 failures the breaker trips <span className="badge err">open</span>. Wait ~20s; the next request enters <span className="badge stale">half-open</span> as a probe.</li>
          <li>Every state transition emits an event, streamed above in real time.</li>
        </ul>
      </section>
    </main>
  );
}

function ResultCard({ title, data }: { title: string; data: Aggregate | null }) {
  return (
    <div style={{ border: "1px solid #222", borderRadius: 12, padding: 16 }}>
      <h3 style={{ marginTop: 0, fontSize: 15 }}>{title}</h3>
      {!data ? (
        <p className="muted">No data yet.</p>
      ) : (
        <>
          <table>
            <tbody>
              <tr><th>calls</th><td>{data.count}</td></tr>
              <tr><th>2xx / 3xx</th><td><span className="badge ok">{data.ok}</span></td></tr>
              <tr><th>non-2xx</th><td>{data.err > 0 ? <span className="badge err">{data.err}</span> : 0}</td></tr>
              <tr><th>avg wall</th><td>{data.wallAvgMs} ms</td></tr>
              <tr><th>p95 wall</th><td>{data.wallP95Ms} ms</td></tr>
              <tr><th>total wall</th><td>{data.wallTotalMs} ms</td></tr>
            </tbody>
          </table>
          <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.entries(data.armorBreakdown).map(([k, v]) => (
              <span key={k} className={`badge ${k === "ok" ? "ok" : k === "stale" ? "stale" : k === "error" ? "err" : ""}`}>
                {k}: {v}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
