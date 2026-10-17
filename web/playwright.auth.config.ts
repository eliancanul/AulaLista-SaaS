import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "auth.integration.ts",
  outputDir: "test-results/auth-integration",
  workers: 1,
  use: {
    baseURL: "http://localhost:4175",
    browserName: "chromium",
    // Login artifacts could contain synthetic credentials; do not capture them.
    screenshot: "off",
    trace: "off",
    video: "off",
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: "npm run dev -- --host localhost --config tests/vite-auth.config.ts --port 4175 --strictPort",
    url: "http://localhost:4175",
    reuseExistingServer: false,
  },
});
