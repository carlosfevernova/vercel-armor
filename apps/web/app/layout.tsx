import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "vercel-armor — 4-layer resilience for flaky external APIs",
  description:
    "Circuit breaker + abortable fetch + throttled map + stale-if-error headers. Zero runtime deps. Battle-tested in production against a legacy ERP that goes down weekly.",
  metadataBase: new URL("https://vercel-armor.vercel.app"),
  openGraph: {
    title: "vercel-armor",
    description: "4-layer armor for Vercel serverless APIs that depend on flaky external services.",
    url: "https://vercel-armor.vercel.app",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
