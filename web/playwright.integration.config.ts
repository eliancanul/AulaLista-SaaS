import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.integration.ts",
  testIgnore: "**/auth.integration.ts",
  outputDir: "test-results/integration",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    browserName: "chromium",
    screenshot: "on",
    trace: "retain-on-failure",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox"],
    },
    viewport: { width: 1440, height: 924 },
  },
  webServer: {
    command:
      "npm run dev -- --config tests/vite-api.config.ts --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
  },
});
