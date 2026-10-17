/** Test-only proxy/session. Production Vite does not load this configuration. */
import { defineConfig } from "vite";
import { isUuid } from "../src/acenta/api";

const actorId = process.env.AULALISTA_E2E_ACTOR_ID;
const scopeId = process.env.AULALISTA_E2E_SCOPE_ID;
const target = process.env.AULALISTA_E2E_API_URL ?? "";
if (
  !isUuid(actorId) ||
  !isUuid(scopeId) ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(target)
)
  throw new Error(
    "Run this configuration only through the disposable PostgreSQL integration test.",
  );

export default defineConfig({
  define: { __ACENTA_E2E_SESSION__: JSON.stringify({ actorId, scopeId }) },
  server: { proxy: { "/scopes": target } },
});
