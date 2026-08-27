/**
 * Simulates a slow, flaky external service. Shared between /api/flaky and /api/armored
 * so the comparison is apples-to-apples.
 *
 * - 30% failure rate
 * - 50-3000ms latency (uniform)
 * - Returns a synthetic payload otherwise
 */
export async function simulateFlakyUpstream(): Promise<{ ts: string; nonce: number }> {
  const latency = 50 + Math.floor(Math.random() * 2950);
  await new Promise((r) => setTimeout(r, latency));
  if (Math.random() < 0.3) {
    throw new Error(`upstream_500_after_${latency}ms`);
  }
  return { ts: new Date().toISOString(), nonce: Math.floor(Math.random() * 1e9) };
}
