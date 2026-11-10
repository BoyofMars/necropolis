import { expect, test } from "@playwright/test";

test("landing explains the mechanic and reads live stats from NEAR", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Bury the bag.");
  await expect(page.getByText("Read live from the NEAR testnet contract.")).toBeVisible();
  await expect(page.getByText("Graves").first()).toBeVisible();
});

test("scanner rejects an invalid address and a chain mismatch", async ({ page, request }) => {
  await page.goto("/scan");
  await page.getByLabel("Wallet address").fill("not-a-wallet");
  await expect(page.getByText("That isn’t a Solana or Base address.")).toBeVisible();
  const res = await request.get("/api/scan?chain=sol&address=0x8887B645A0F15CE7AC5DCd01b0385c0740131C43");
  expect(res.status()).toBe(400);
  expect((await res.json()).code).toBe("CHAIN_MISMATCH");
});

test("proof page verifies MPC root keys and ossuaries live", async ({ page }) => {
  await page.goto("/proof");
  await expect(page.getByRole("heading", { name: /Check it/ })).toBeVisible();
  // four ✓ marks: two root keys, two ossuaries
  await expect(page.locator("li span", { hasText: "✓" })).toHaveCount(4, { timeout: 20_000 });
});

test("how-it-works simulator switches scenarios", async ({ page }) => {
  await page.goto("/how#simulation");
  await page.getByRole("radio", { name: "Graveyard" }).click();
  await expect(page.getByText("Nothing rose. Nothing was paid.")).toBeVisible();
  await page.getByRole("radio", { name: "Wash-trading attack" }).click();
  await expect(page.getByText("False dawns caught")).toBeVisible();
});

test("a grave page shows on-chain state and proof", async ({ page }) => {
  await page.goto("/grave/0");
  await expect(page.getByRole("heading", { name: "Nº 000000" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("MPC attestation")).toBeVisible();
});

test("unknown graves say so instead of erroring", async ({ page }) => {
  await page.goto("/grave/999999");
  await expect(page.getByText("No grave with this number exists yet.")).toBeVisible({ timeout: 20_000 });
});
