import { defineConfig, devices } from "@playwright/test";

const browserExecutable = process.env.E2E_BROWSER_EXECUTABLE?.trim();
const configuredE2ePort = process.env.E2E_PORT?.trim() || "3000";
if (!/^\d{1,5}$/.test(configuredE2ePort)) {
  throw new Error("E2E_PORT must be an integer between 1 and 65535");
}
const e2ePortNumber = Number(configuredE2ePort);
if (e2ePortNumber < 1 || e2ePortNumber > 65_535) {
  throw new Error("E2E_PORT must be an integer between 1 and 65535");
}
const e2ePort = String(e2ePortNumber);
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;
const runLiveRag = process.env.E2E_LIVE_RAG === "1";
const runLiveMaintenance = process.env.E2E_LIVE_MAINTENANCE === "1";
const runT15Load = process.env.E2E_T15_LOAD === "1";
const runExternalServices =
  process.env.E2E_EXTERNAL_SERVICES === "1" || runLiveRag || runLiveMaintenance || runT15Load;
const testIgnore = [
  ...(!runExternalServices ? ["auth.spec.ts", "shell.spec.ts"] : []),
  ...(!runLiveRag ? ["live-rag.spec.ts"] : []),
  ...(!runLiveMaintenance ? ["live-maintenance.spec.ts"] : []),
  ...(!runT15Load ? ["t15-load.spec.ts"] : []),
];
const chromiumOnlyTests = [
  "auth.spec.ts",
  "shell.spec.ts",
  "live-rag.spec.ts",
  "live-maintenance.spec.ts",
  "t15-load.spec.ts",
];

/**
 * Deterministic E2E runs in Chromium, Firefox, and WebKit. Tests that use real
 * Keycloak, model providers, or maintenance operations remain Chromium-only.
 * Requires Keycloak + API. Use localhost (not 127.0.0.1) so CORS and
 * Keycloak redirect URIs match the backend defaults.
 */
export default defineConfig({
  testDir: "./e2e",
  testIgnore,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: {
    timeout: 20_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: browserExecutable
          ? { executablePath: browserExecutable }
          : undefined,
      },
    },
    {
      name: "firefox",
      testIgnore: [...testIgnore, ...chromiumOnlyTests],
      use: {
        ...devices["Desktop Firefox"],
      },
    },
    {
      name: "webkit",
      testIgnore: [...testIgnore, ...chromiumOnlyTests],
      use: {
        ...devices["Desktop Safari"],
      },
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${e2ePort}`,
    url: e2eBaseUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
