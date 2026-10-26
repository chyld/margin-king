import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT || 5793);

export default defineConfig({
  testDir: "test/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "off",
  },
  webServer: {
    command: `node test/e2e/serve.ts`,
    url: `http://127.0.0.1:${port}/favicon.svg`,
    env: { E2E_PORT: String(port) },
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 820 } }, testIgnore: /phone\.spec\.ts/ },
    { name: "phone", use: { ...devices["iPhone 12 Pro"], browserName: "chromium", defaultBrowserType: "chromium" }, testMatch: /phone\.spec\.ts/ },
  ],
});
