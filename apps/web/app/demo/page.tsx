"use client";

import Link from "next/link";
import { useState } from "react";

type CallResult = {
  status: number;
  wallMs: number;
  body: unknown;
  cache: string | null;
};

type Aggregate = {
  count: number;
  ok: number;
  err: number;
  wallTotalMs: number;
  wallAvgMs: number;
  cbBadges: Record<string, number>;
};

const CONCURRENCY = 20;

async function callEndpoint(url: string): Promise<CallResult> {
  const t0 = performance.now();
  const res = await fetch(url);
  const wallMs = Math.round(performance.now() - t0);
  const cache = res.headers.get("x-vercel-cache") ?? res.headers.get("x-armor-status");
  let body: unknown = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { status: res.status, wallMs, body, cache };
}

function aggregate(results: CallResult[]): Aggregate {
  const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
  const wallTotalMs = results.reduce((s, r) => s + r.wallMs, 0);
  const cbBadges: Record<string, number> = {};
  for (const r of results) {
    const b = (r.body as { status?: string } | null)?.status ?? "unknown";
    cbBadges[b] = (cbBadges[b] ?? 0) + 1;
  }
  return {
    count: results.length,
    ok,
    err: results.length - ok,
    wallTotalMs,
    wallAvgMs: Math.round(wallTotalMs / results.length),
    cbBadges,
  };
}

export default function DemoPage() {
  const [flaky, setFlaky] = useState<Aggregate | null>(null);
  const [armored, setArmored] = useState<Aggregate | null>(null);
  const [busy, setBusy] = useState(false);

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
    }
  }

  return (
    <main className="container">
      <p><Link href="/">← back</Link></p>
      <h1 style={{ fontSize: 32 }}>Load test — 20 concurrent calls</h1>
      <p className="muted">
        Both endpoints hit the same simulated flaky upstream (~30% fail, 50-3000ms latency).
        <br />
        Only <code>/api/armored</code> is wrapped in <code>withArmor</code>.
      </p>

      <button className="btn" onClick={runBoth} disabled={busy} style={{ marginTop: 8 }}>
        {busy ? "Running…" : "Fire 20+20 requests"}
      </button>

      <div className="grid-two" style={{ marginTop: 32 }}>
        <ResultCard title="/api/flaky (raw)" data={flaky} />
        <ResultCard title="/api/armored (armored)" data={armored} />
      </div>

      <section style={{ marginTop: 40 }}>
        <h2>What you should see</h2>
        <ul>
          <li>Raw endpoint: ~30% return 5xx, average wall-time high, some requests take 3s+.</li>
          <li>Armored endpoint: near-100% status 200, with a <span className="badge stale">stale</span> body once the breaker trips — plus 24h of grace via <code>stale-if-error</code>.</li>
        </ul>
      </section>
    </main>
  );
}

function ResultCard({ title, data }: { title: string; data: Aggregate | null }) {
  return (
    <div style={{ border: "1px solid #222", borderRadius: 12, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      {!data ? (
        <p className="muted">No data yet.</p>
      ) : (
        <>
          <table>
            <tbody>
              <tr><th>calls</th><td>{data.count}</td></tr>
              <tr><th>2xx</th><td><span className="badge ok">{data.ok}</span></td></tr>
              <tr><th>non-2xx</th><td>{data.err > 0 ? <span className="badge err">{data.err}</span> : 0}</td></tr>
              <tr><th>avg wall</th><td>{data.wallAvgMs} ms</td></tr>
              <tr><th>total wall</th><td>{data.wallTotalMs} ms</td></tr>
            </tbody>
          </table>
          <div style={{ marginTop: 12 }}>
            {Object.entries(data.cbBadges).map(([k, v]) => (
              <span key={k} className={`badge ${k === "ok" ? "ok" : k === "stale" ? "stale" : "err"}`} style={{ marginRight: 6 }}>
                {k}: {v}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
