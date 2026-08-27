/**
 * Intentionally problematic file to test armor-bot's ruleset.
 * DO NOT COPY THIS PATTERN — every one of these is a real production landmine.
 */

// ❌ vercel-armor/no-timeout — outbound fetch to a third-party URL with no timeout
export async function fetchStripeCustomer(customerId: string) {
  const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`);
  return res.json();
}

// ❌ vercel-armor/unbounded-promise-all — fan-out over N external calls without limit
export async function fetchAllWarehouseStock(warehouseIds: string[]) {
  const results = await Promise.all(
    warehouseIds.map((id) =>
      fetch(`http://legacy-erp.example.internal/stock/${id}`).then((r) => r.json()),
    ),
  );
  return results;
}

// ❌ vercel-armor/retry-without-backoff — tight retry loop against upstream 5xx
export async function fetchWithNaiveRetry(url: string, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
    } catch {
      /* retry immediately — will hammer the upstream */
    }
  }
  throw new Error("all attempts failed");
}

// ❌ vercel-armor/cache-no-store-on-getable — kills request collapsing
export async function fetchProductCatalog() {
  return fetch("https://api.example.com/products", { cache: "no-store" });
}

// ❌ vercel-armor/timestamp-cachebuster — busts edge cache with unique URL per call
export async function fetchInventoryFresh() {
  return fetch(`https://api.example.com/inventory?_=${Date.now()}`);
}
