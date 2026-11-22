/** Client-side telemetry ring buffer for Support debug bundles (never stores secrets). */

export interface ConsoleLogEntry {
  at: string;
  level: "error" | "warn";
  message: string;
  stack?: string;
}

export interface NetworkLogEntry {
  at: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  ok: boolean;
  error?: string;
}

export interface BreadcrumbEntry {
  at: string;
  category: string;
  message: string;
  meta?: Record<string, string | number | boolean | null>;
}

export interface DebugBundle {
  capturedAt: string;
  route: string;
  viewport: { width: number; height: number; dpr: number };
  screen: { width: number; height: number };
  userAgent: string;
  language: string;
  online: boolean;
  appState: Record<string, unknown>;
  consoleErrors: ConsoleLogEntry[];
  consoleWarnings: ConsoleLogEntry[];
  networkLog: NetworkLogEntry[];
  breadcrumbs: BreadcrumbEntry[];
  performance: {
    uptimeMs: number;
    memoryUsedMB?: number;
  };
}

const MAX_CONSOLE = 60;
const MAX_NETWORK = 80;
const MAX_BREADCRUMBS = 80;

const consoleErrors: ConsoleLogEntry[] = [];
const consoleWarnings: ConsoleLogEntry[] = [];
const networkLog: NetworkLogEntry[] = [];
const breadcrumbs: BreadcrumbEntry[] = [];
const bootTime = Date.now();
let installed = false;

function pushCapped<T>(arr: T[], item: T, max: number) {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function sanitizePath(rawUrl: string): string {
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = new URL(rawUrl, base);
    return parsed.pathname.slice(0, 240);
  } catch {
    return rawUrl.split("?", 1)[0].slice(0, 240);
  }
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
      if (typeof arg === "string") return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ")
    .slice(0, 800);
}

export function recordBreadcrumb(
  category: string,
  message: string,
  meta?: Record<string, string | number | boolean | null>,
) {
  pushCapped(
    breadcrumbs,
    {
      at: new Date().toISOString(),
      category: category.slice(0, 32),
      message: message.slice(0, 240),
      meta,
    },
    MAX_BREADCRUMBS,
  );
}

export function recordConsoleError(message: string, stack?: string) {
  pushCapped(
    consoleErrors,
    {
      at: new Date().toISOString(),
      level: "error",
      message: message.slice(0, 800),
      stack: stack ? stack.slice(0, 1200) : undefined,
    },
    MAX_CONSOLE,
  );
}

export function recordNetworkEvent(entry: Omit<NetworkLogEntry, "at">) {
  pushCapped(
    networkLog,
    {
      at: new Date().toISOString(),
      ...entry,
      path: sanitizePath(entry.path),
    },
    MAX_NETWORK,
  );
}

export function installDebugTelemetry(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    recordConsoleError(formatArgs(args));
    origError(...args);
  };

  const origWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    pushCapped(
      consoleWarnings,
      {
        at: new Date().toISOString(),
        level: "warn",
        message: formatArgs(args),
      },
      MAX_CONSOLE,
    );
    origWarn(...args);
  };

  window.addEventListener("error", (event) => {
    recordConsoleError(
      event.message || "Unhandled window error",
      event.error instanceof Error ? event.error.stack : `${event.filename}:${event.lineno}:${event.colno}`,
    );
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    recordConsoleError(
      reason instanceof Error ? `UnhandledRejection: ${reason.message}` : `UnhandledRejection: ${formatArgs([reason])}`,
      reason instanceof Error ? reason.stack : undefined,
    );
  });

  const origFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const started = performance.now();
    const urlStr =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method || (typeof input !== "string" && !(input instanceof URL) ? input.method : "GET") || "GET").toUpperCase();
    try {
      const res = await origFetch(input, init);
      recordNetworkEvent({
        method,
        path: urlStr,
        status: res.status,
        durationMs: Math.round(performance.now() - started),
        ok: res.ok,
      });
      return res;
    } catch (err) {
      recordNetworkEvent({
        method,
        path: urlStr,
        status: 0,
        durationMs: Math.round(performance.now() - started),
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 200) : "network_error",
      });
      throw err;
    }
  };

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest("button, a, [role='tab'], [role='menuitem']") as HTMLElement | null;
      if (!btn) return;
      const label = (
        btn.getAttribute("aria-label") ||
        btn.textContent?.trim() ||
        btn.tagName
      )
        .replace(/\s+/g, " ")
        .slice(0, 80);
      recordBreadcrumb("ui.click", label);
    },
    { capture: true, passive: true },
  );
}

export function collectDebugBundle(appState: Record<string, unknown> = {}): DebugBundle {
  const win = typeof window !== "undefined" ? window : null;
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const perfMem = (
    typeof performance !== "undefined"
      ? (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
      : undefined
  );
  return {
    capturedAt: new Date().toISOString(),
    route: win ? `${win.location.origin}${win.location.pathname}` : "",
    viewport: {
      width: win?.innerWidth ?? 0,
      height: win?.innerHeight ?? 0,
      dpr: win?.devicePixelRatio ?? 1,
    },
    screen: {
      width: win?.screen?.width ?? 0,
      height: win?.screen?.height ?? 0,
    },
    userAgent: nav?.userAgent ?? "",
    language: nav?.language ?? "es-MX",
    online: nav?.onLine ?? true,
    appState,
    consoleErrors: [...consoleErrors],
    consoleWarnings: [...consoleWarnings],
    networkLog: [...networkLog],
    breadcrumbs: [...breadcrumbs],
    performance: {
      uptimeMs: Date.now() - bootTime,
      memoryUsedMB: perfMem?.usedJSHeapSize
        ? Math.round((perfMem.usedJSHeapSize / (1024 * 1024)) * 10) / 10
        : undefined,
    },
  };
}

export function resetDebugTelemetryForTests(): void {
  consoleErrors.length = 0;
  consoleWarnings.length = 0;
  networkLog.length = 0;
  breadcrumbs.length = 0;
}
