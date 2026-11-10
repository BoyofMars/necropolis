import { expect, test } from "@playwright/test";

test("mobile gets a bottom tab bar with Bury in the centre", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary" }).last();
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Bury a bag" })).toBeVisible();
  // no horizontal scroll
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
