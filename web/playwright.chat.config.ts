import { defineConfig } from "@playwright/test";
import authConfig from "./playwright.auth.config";

// Run only through the disposable PostgreSQL chat runner. Production UI and real
// auth/HTTP are retained; the Python runner replaces only email/model transports.
export default defineConfig(authConfig, {
  testMatch: "chat.connected.ts",
  outputDir: "test-results/integration/chat",
  timeout: 90_000,
  use: { viewport: { width: 1280, height: 900 } },
});
