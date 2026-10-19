import React, { useEffect, useSyncExternalStore } from "react";
import { AuthController } from "./auth";
import { AuthAccessView } from "./AuthView";
import { AcentaApp } from "./App";
import { needsEditorGuard } from "./editor-exit";
export function AuthenticatedApp({ auth }: { auth: AuthController }) {
  const state = useSyncExternalStore(auth.subscribe, auth.snapshot);
  useEffect(() => {
    void auth.start();
    const check = () => {
      if (document.visibilityState === "visible") void auth.revalidate(true);
    };
    const hide = () => auth.suspend();
    const visibility = () => document.visibilityState === "visible" ? check() : hide();
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", check);
    document.addEventListener("freeze", hide);
    document.addEventListener("resume", check);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void auth.revalidate();
    }, 60000);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", check);
      document.removeEventListener("freeze", hide);
      document.removeEventListener("resume", check);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visibility);
      clearInterval(timer);
    };
  }, [auth]);
  useEffect(() => {
    if (state.phase !== "suspended") return;
    // The workspace is hidden during uncertainty, but its unsaved buffer still needs protection.
    const preserve = (event: BeforeUnloadEvent) => {
      const work = state.controller?.snapshot();
      if (!work || !(work.pending || work.sourcePending || needsEditorGuard(work.editor) || state.controller?.analytic.hasUnsavedChanges() || state.controller?.analyticDerivation.hasUnsavedChanges())) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preserve);
    return () => window.removeEventListener("beforeunload", preserve);
  }, [state.phase, state.controller]);
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
