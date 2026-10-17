import React, { useEffect, useSyncExternalStore } from "react";
import { AuthController } from "./auth";
import { AuthAccessView } from "./AuthView";
import { AcentaApp } from "./App";
export function AuthenticatedApp({ auth }: { auth: AuthController }) {
  const state = useSyncExternalStore(auth.subscribe, auth.snapshot);
  useEffect(() => {
    void auth.start();
    const check = () => {
      if (document.visibilityState === "visible") void auth.revalidate();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = window.setInterval(check, 60000);
    return () => {
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
      clearInterval(timer);
    };
  }, [auth]);
  useEffect(() => {
    if (state.phase !== "suspended") return;
    // The workspace is hidden during uncertainty, but its unsaved buffer still needs protection.
    const preserve = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preserve);
    return () => window.removeEventListener("beforeunload", preserve);
  }, [state.phase]);
  return state.controller && state.phase === "ready" ? (
    <AcentaApp
      key={state.workspaceVersion}
      controller={state.controller}
      onLogout={() => void auth.logout()}
    />
  ) : (
    <AuthAccessView auth={auth} />
  );
}
