import { expect, test } from "@playwright/test";

test.describe("vercel-armor demo", () => {
  test("landing renders with hero + CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "vercel-armor" })).toBeVisible();
    await expect(page.getByRole("link", { name: /try the live demo/i })).toBeVisible();
  });

  test("demo: firing the load test populates both cards", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: /reset cb/i }).click();
    await page.waitForTimeout(200);
    await page.getByRole("button", { name: /fire 20\+20/i }).click();
    await expect(page.getByRole("button", { name: /running/i })).toBeVisible();

    // Both ResultCards render `avg wall` and `p95 wall` once populated.
    await expect(page.getByText("avg wall")).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByText("p95 wall")).toHaveCount(2, { timeout: 5_000 });

    // At least one ok badge should render in the armored card.
    const okBadges = page.locator(".badge.ok");
    await expect(okBadges.first()).toBeVisible();
  });

  test("demo: telemetry table shows the demo-upstream breaker", async ({ page }) => {
    await page.goto("/demo");
    await page.getByRole("button", { name: /fire 20\+20/i }).click();
    await page.waitForTimeout(4_000); // wait for burst + one poll tick
    await expect(page.getByText("demo-upstream")).toBeVisible();
  });

  test("armored endpoint sets x-armor-* headers", async ({ request }) => {
    const res = await request.get("/api/armored");
    expect(res.status()).toBeLessThan(500);
    expect(res.headers()["x-armor-status"]).toMatch(/ok|stale|error/);
    expect(res.headers()["x-armor-cb-state"]).toMatch(/closed|open|half-open/);
  });

  test("telemetry endpoint returns breakers + events schema", async ({ request }) => {
    // Prime with one request so events exist.
    await request.get("/api/armored");
    const res = await request.get("/api/telemetry");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.breakers)).toBe(true);
    expect(Array.isArray(body.events)).toBe(true);
    expect(typeof body.generatedAt).toBe("number");
  });
});
