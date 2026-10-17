/** Test-only proxy; no fake actor, session, cookies or frontend identity flags. */
import { defineConfig } from "vite";

const target = process.env.AULALISTA_AUTH_E2E_API_URL ?? "";
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(target))
  throw new Error("Run only through the disposable PostgreSQL auth integration test.");

export default defineConfig({
  server: {
    proxy: { "/auth": target, "/scopes": target, "/__test__": target },
  },
});
