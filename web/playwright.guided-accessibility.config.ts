import { defineConfig } from "@playwright/test";
import authConfig from "./playwright.auth.config";

// Keep the real-auth proxy and disabled auth traces/screenshots/video.
// A distinct suffix prevents discovery by the actor-override integration suite.
export default defineConfig(authConfig, {
  testMatch: "guided-accessibility.connected.ts",
  outputDir: "test-results/guided-accessibility",
  timeout: 60_000,
  // Optional local filter to reproduce one failing width without rerunning all.
  grep: process.env.ACENTA_GUIDED_A11Y_GREP
    ? new RegExp(process.env.ACENTA_GUIDED_A11Y_GREP)
    : undefined,
});
