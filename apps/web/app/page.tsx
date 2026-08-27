import Link from "next/link";

export default function Landing() {
  return (
    <main className="container">
      <header style={{ marginBottom: 40 }}>
        <span className="badge ok">v0.1.0 · MIT · zero deps</span>
        <h1 style={{ fontSize: 42, margin: "16px 0 8px" }}>vercel-armor</h1>
        <p style={{ fontSize: 18, color: "#bbb", margin: 0 }}>
          4-layer resilience for Vercel serverless APIs that depend on flaky external services.
        </p>
      </header>

      <section style={{ marginBottom: 32 }}>
        <p>
          If your handler does <code>fetch(externalUrl)</code> and the external is a legacy ERP, a raw
          IP, or any provider that occasionally chokes — this is the primitive you reach for.
        </p>
        <p>
          <strong>Battle-tested against a real ERP outage</strong>: 30s function timeouts and 504s
          cascading across 20 concurrent users, before → after applying this pattern.
        </p>
        <div style={{ display: "flex", gap: 12, marginTop: 24 }}>
          <Link className="btn" href="/demo">Try the live demo</Link>
          <a className="btn secondary" href="https://github.com/carlosfevernova/vercel-armor" target="_blank" rel="noopener noreferrer">
            View source
          </a>
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>What&apos;s in the box</h2>
        <ol>
          <li><strong>CircuitBreaker</strong> — in-memory, tunable threshold + cooldown. Serves 503 in &lt;1ms once tripped.</li>
          <li><strong>abortableFetch</strong> — hard per-request timeout via AbortController. Never throws.</li>
          <li><strong>throttledMap</strong> — bounded-concurrency fan-out for N external calls.</li>
          <li><strong>armorHeaders</strong> — sets <code>cache-control: s-maxage=60, stale-while-revalidate=300, stale-if-error=86400</code>. Vercel CDN honors all three.</li>
          <li><strong>withArmor</strong> — composes CB + fallback around any fetcher. One-line handler upgrade.</li>
        </ol>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>Install</h2>
        <pre><code>npm i vercel-armor</code></pre>
        <h2>Wrap any handler in 6 lines</h2>
        <pre><code>{`import { CircuitBreaker, abortableFetch, withArmor, armorHeaders } from "vercel-armor";

const cb = new CircuitBreaker({ failThreshold: 3, cooldownMs: 60_000 });

export default async function handler(req, res) {
  const result = await withArmor(
    { cb, fallback: () => loadStaleFromDb() },
    async () => {
      const r = await abortableFetch("https://legacy-erp.example/api", { timeoutMs: 5000 });
      if (!r.ok) throw new Error(r.error);
      return r.data;
    },
  );
  armorHeaders(res);
  res.status(result.status === "error" ? 503 : 200).json(result);
}`}</code></pre>
      </section>

      <section style={{ marginBottom: 32 }}>
        <h2>Why this exists</h2>
        <p>
          Vercel serverless functions are cheap to invoke but expensive to hang. A legacy upstream
          that timeouts at 30s + 20 concurrent users = 20 &times; 30s of function budget burned per
          minute, plus 504s cascading to your UI. This library caps the blast radius by:
        </p>
        <ul>
          <li>Aborting individual fetches at 5s (not 30s).</li>
          <li>Skipping the fetcher entirely once N failures land inside a window.</li>
          <li>Serving your last-known-good snapshot (Supabase, KV, D1) instead of a 503.</li>
          <li>Letting Vercel&apos;s edge serve <code>stale-if-error</code> for 24h.</li>
        </ul>
        <p className="muted">
          Node 20+. Works in Node runtime and Edge runtime. No Redis. No cost.
        </p>
      </section>

      <footer style={{ borderTop: "1px solid #222", paddingTop: 24, marginTop: 48, color: "#666", fontSize: 13 }}>
        <p>
          MIT · <a href="https://github.com/carlosfevernova/vercel-armor">github.com/carlosfevernova/vercel-armor</a> · Built by Carlos F. Vernova
        </p>
      </footer>
    </main>
  );
}
