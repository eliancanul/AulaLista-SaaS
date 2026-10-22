import { defineConfig } from "@playwright/test";
import authConfig from "./playwright.auth.config";

// Reuse the real-auth proxy. No screenshots, traces or videos of login data.
export default defineConfig(authConfig, {
  testMatch: "pilot-generation.connected.ts",
  outputDir: "test-results/integration/pilot-generation",
  timeout: 90_000,
  use: { viewport: { width: 1440, height: 924 } },
});
