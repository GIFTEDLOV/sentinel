import { expect, test } from "@playwright/test";

const APP_ROUTES = [
  "/app",
  "/app/protocols",
  "/app/protocols/sentinel-demo",
  "/app/incidents",
  "/app/incidents/new",
  "/app/incidents/incident-e5115f160d64",
  "/app/activity",
  "/transparency",
  "/developer",
] as const;

const NAVIGATION = [
  ["Home", "/app"],
  ["Protocols", "/app/protocols"],
  ["Incidents", "/app/incidents"],
  ["Activity", "/app/activity"],
  ["Proof & Security", "/transparency"],
  ["Integrate / Docs", "/developer"],
] as const;

const RECOVERY_INCIDENT_ID = "incident-playwright-recovery";
const RECOVERY_HASH = `0x${"1".repeat(64)}`;

test.describe("Sentinel Studio Next application shell", () => {
  test("landing page renders the current branding and ENTER APP CTA", async ({ page }) => {
    await page.goto("/");
    const landingNav = page.locator(".landing-nav");
    await expect(landingNav.getByRole("link", { name: "Sentinel home" })).toBeVisible();
    await expect(landingNav.getByRole("img", { name: "Sentinel. Always Ahead" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /ONE INCIDENT\.\s*ONE VERIFIED\s*RESPONSE\./i })).toBeVisible();
    await expect(page.getByRole("link", { name: /ENTER APP/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /THE RESPONSE HAS A TRAIL\./i })).toBeVisible();
  });

  test("required routes render without a blank page", async ({ page }) => {
    for (const route of ["/", ...APP_ROUTES]) {
      await page.goto(route);
      await expect(page.locator("body")).not.toBeEmpty();
      if (route !== "/") {
        await expect(page.locator(".app-header")).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Application navigation" })).toBeVisible();
      }
    }
  });

  test("app shell uses the top header for navigation and wallet access", async ({ page }) => {
    await page.goto("/app");
    const header = page.locator(".app-header");
    const navigation = header.getByRole("navigation", { name: "Application navigation" });

    await expect(header).toBeVisible();
    await expect(header.getByRole("link", { name: "Sentinel command center" })).toBeVisible();
    for (const [label, href] of NAVIGATION) {
      await expect(navigation.getByRole("link", { name: label, exact: true })).toHaveAttribute("href", href);
    }
    await expect(header.locator(".app-header-tools").getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await expect(page.locator(".console-shell .sidebar")).toHaveCount(0);
    await expect(page.locator(".sidebar .wallet-button")).toHaveCount(0);
  });

  test("Studio Next network and final deployment addresses are visible", async ({ page }) => {
    await page.goto("/transparency");
    await expect(page.locator(".app-network-chip")).toContainText("Studio Next");
    await expect(page.getByText("0xd83b20EcCF5c1Ddd70aD57EF0E25a5200079c4de")).toBeVisible();
    await expect(page.getByText("0xDf9635A1E13379b2F7c25166aAE1C29729b3bFDA")).toBeVisible();
  });

  test("transparency exposes the canonical Studio Next RPC", async ({ page }) => {
    await page.goto("/transparency");
    await expect(page.getByText("https://studio-next.genlayer.com/api")).toBeVisible();
    await expect(page.locator(".app-network-chip").getByText("61997", { exact: true })).toBeVisible();
  });

  test("new-incident recovery resumes a browser-persisted transaction hash", async ({ page }) => {
    const operationId = `studio-next:61997:0xd83b20eccf5c1ddd70ad57ef0e25a5200079c4de|open_incident|${RECOVERY_INCIDENT_ID}|sentinel-demo`;
    await page.addInitScript(({ incidentId, operation, hash }) => {
      window.localStorage.setItem("sentinel.new-incident.draft-id", incidentId);
      window.localStorage.setItem(
        `sentinel.pending.${operation}`,
        JSON.stringify({ operationId: operation, hash }),
      );
    }, { incidentId: RECOVERY_INCIDENT_ID, operation: operationId, hash: RECOVERY_HASH });
    await page.goto("/app/incidents/new");
    await expect(page.getByText("Transaction found")).toBeVisible();
    await expect(page.getByRole("button", { name: /Resume transaction|Check transaction/ })).toBeVisible();
    await expect(page.getByText(`Same hash: ${RECOVERY_HASH}`)).toBeVisible();
  });

  test("wallet network mismatch is explicit", async ({ page }) => {
    await page.addInitScript(() => {
      window.ethereum = {
        request: async ({ method }: { method: string }) => method === "eth_accounts" ? ["0x1111111111111111111111111111111111111111"] : method === "eth_chainId" ? "0xf00d" : ["0x1111111111111111111111111111111111111111"],
      };
    });
    await page.goto("/app");
    const wallet = page.locator(".app-header-tools .wallet-button");
    await wallet.click();
    await expect(wallet).toContainText(/Switch to Studio Next/i);
  });

  test("passive read failures stay silent without interrupting the shell", async ({ page }) => {
    await page.route("**/api**", (route) => route.abort());
    await page.goto("/app");
    await expect(page.locator(".app-header")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Application navigation" })).toBeVisible();
    await expect(page.locator(".app-header-tools").getByRole("button", { name: "Connect wallet" })).toBeVisible();
    await expect(page.locator(".read-toast")).toHaveCount(0);
    await expect(page.locator(".read-unavailable")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    await expect(page.getByText("Details", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Live state delayed|Live data delayed|Studio Next is taking longer than usual|could not refresh/i)).toHaveCount(0);
  });
});
