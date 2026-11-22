import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { toolsMenuPosition, toolsMenuScroll } from "./tools-menu";
const asset = (name: string) => `/acenta/${name}`;
export function Icon({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <img
      className={small ? "icon small" : "icon"}
      src={asset(`${name}.svg`)}
      alt=""
    />
  );
}
export function Logo({ large = false }: { large?: boolean }) {
  return (
    <img
      className={large ? "logo large" : "logo"}
      src={asset("acenta-logo-reconstruido-tinta.svg")}
      alt="Acenta"
    />
  );
}
export function LogoMark() {
  return (
    <svg
      className="logo-mark"
      viewBox="0 0 84 70"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Acenta"
    >
      <path
        d="M73.5 1.25V5.5C60.5 -2.25 33 6.25 21 22.25C6 42.25 17.25 66 37 68.25C7.5 69.75 -6 54.75 2.5 33C13 11.25 41 -3.25 73.5 1.25Z"
        fill="currentColor"
      />
      <path
        d="M69.75 68C76.65 68 82.25 62.4 82.25 55.5C82.25 48.6 76.65 43 69.75 43C62.85 43 57.25 48.6 57.25 55.5C57.25 62.4 62.85 68 69.75 68Z"
        fill="var(--ac-action)"
      />
    </svg>
  );
}
export type UiIconName =
  | "worksheet"
  | "printer"
  | "logout"
  | "sparkles"
  | "eye"
  | "edit"
  | "check"
  | "clock"
  | "trash"
  | "refresh"
  | "plus"
  | "minus"
  | "download"
  | "send"
  | "arrow-up"
  | "alert"
  | "search"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "more-horizontal"
  | "close"
  | "home"
  | "folder"
  | "document"
  | "chat"
  | "users";

export function UiIcon({
  name,
  size = 20,
  className = "",
}: {
  name: UiIconName;
  size?: number;
  className?: string;
}) {
  const cls = className ? `ui-icon ${className}` : "ui-icon";
  const shared = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.65,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
    className: cls,
  };
  switch (name) {
    case "worksheet":
      return (
        <svg {...shared}>
          <path d="M6 3h9l4 4v14H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
          <path d="M15 3v4h4" />
          <path d="M8.5 11h7" />
          <path d="M8.5 14.5h7" />
          <path d="M8.5 18h4.5" />
        </svg>
      );
    case "printer":
      return (
        <svg {...shared}>
          <path d="M7 8V4h10v4" />
          <path d="M6 17H4.5A1.5 1.5 0 0 1 3 15.5v-5A2.5 2.5 0 0 1 5.5 8h13A2.5 2.5 0 0 1 21 10.5v5a1.5 1.5 0 0 1-1.5 1.5H18" />
          <rect x="7" y="14" width="10" height="6" rx="1" />
          <circle cx="17.5" cy="11.25" r="0.75" fill="currentColor" stroke="none" />
        </svg>
      );
    case "logout":
      return (
        <svg {...shared}>
          <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
          <path d="M15 16l4-4-4-4" />
          <path d="M19 12H9" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...shared}>
          <path d="M12 3l1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z" />
          <path d="M19 3.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9Z" />
        </svg>
      );
    case "eye":
      return (
        <svg {...shared}>
          <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
          <circle cx="12" cy="12" r="2.75" />
        </svg>
      );
    case "edit":
      return (
        <svg {...shared}>
          <path d="M16.5 4.5a2.12 2.12 0 0 1 3 3L8 19l-4 1 1-4L16.5 4.5Z" />
          <path d="M14.5 6.5l3 3" />
        </svg>
      );
    case "check":
      return (
        <svg {...shared}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      );
    case "clock":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "trash":
      return (
        <svg {...shared}>
          <path d="M4.5 7h15" />
          <path d="M9.5 4h5" />
          <path d="M6.5 7l.8 11.5A1.5 1.5 0 0 0 8.8 20h6.4a1.5 1.5 0 0 0 1.5-1.5L17.5 7" />
          <path d="M10 11v5.5" />
          <path d="M14 11v5.5" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...shared}>
          <path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5" />
          <path d="M20 4v4.5h-4.5" />
        </svg>
      );
    case "plus":
      return (
        <svg {...shared}>
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      );
    case "minus":
      return (
        <svg {...shared}>
          <path d="M5 12h14" />
        </svg>
      );
    case "download":
      return (
        <svg {...shared}>
          <path d="M12 4v11" />
          <path d="M7.5 10.5L12 15l4.5-4.5" />
          <path d="M5 19h14" />
        </svg>
      );
    case "send":
      return (
        <svg {...shared}>
          <path d="M20.5 3.5L10 14" />
          <path d="M20.5 3.5l-6.5 17-3.5-7-7-3.5 17-6.5Z" />
        </svg>
      );
    case "alert":
      return (
        <svg {...shared}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 8v4.5" />
          <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "search":
      return (
        <svg {...shared}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5L20 20" />
        </svg>
      );
    case "chevron-down":
      return (
        <svg {...shared}>
          <path d="M6.5 9.5L12 15l5.5-5.5" />
        </svg>
      );
    case "more-horizontal":
      return (
        <svg {...shared}>
          <circle cx="5.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
          <circle cx="18.5" cy="12" r="1.25" fill="currentColor" stroke="none" />
        </svg>
      );
    case "close":
      return (
        <svg {...shared}>
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      );
    case "arrow-up":
      return (
        <svg {...shared} strokeWidth={2}>
          <path d="M12 19V5" />
          <path d="m5 12 7-7 7 7" />
        </svg>
      );
    case "chevron-left":
      return (
        <svg {...shared} strokeWidth={1.8}>
          <path d="m15 18-6-6 6-6" />
        </svg>
      );
    case "chevron-right":
      return (
        <svg {...shared} strokeWidth={1.8}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      );
    case "home":
      return (
        <svg {...shared}>
          <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5Z" />
          <path d="M9.5 20.5v-6h5v6" />
        </svg>
      );
    case "folder":
      return (
        <svg {...shared}>
          <path d="M3.5 7.5a2 2 0 0 1 2-2h4.2l2 2H18.5a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-10Z" />
        </svg>
      );
    case "document":
      return (
        <svg {...shared}>
          <path d="M7 3.5h7l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
          <path d="M14 3.5V8h4.5" />
          <path d="M9 12.5h6" />
          <path d="M9 16h4" />
        </svg>
      );
    case "chat":
      return (
        <svg {...shared}>
          <path d="M5 18.5 3.5 20V6.5A2.5 2.5 0 0 1 6 4h12a2.5 2.5 0 0 1 2.5 2.5v8A2.5 2.5 0 0 1 18 17H7.5L5 18.5Z" />
        </svg>
      );
    case "users":
      return (
        <svg {...shared}>
          <path d="M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20" />
          <circle cx="10" cy="8.5" r="3.5" />
          <path d="M20 20v-1.5a3 3 0 0 0-2.2-2.9" />
          <path d="M15.2 5.2a3.5 3.5 0 0 1 0 6.6" />
        </svg>
      );
  }
}
export function Dialog({
  children,
  title,
  onClose,
  className = "",
  anchor,
}: {
  children: ReactNode;
  title: string;
  onClose: () => void;
  className?: string;
  anchor?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousDialog = previous?.closest("dialog");
    const dialog = ref.current!;
    dialog.showModal();
    let space: HTMLDivElement | null = null;
    const position = () => {
      if (anchor?.current) {
        const scroll = toolsMenuScroll(
          anchor.current.getBoundingClientRect(),
          window.innerHeight,
        );
        if (scroll > 0 && !space) {
          // Give the page enough scroll range without moving the menu above its trigger.
          space = document.createElement("div");
          space.className = "tools-menu-space";
          space.setAttribute("aria-hidden", "true");
          document.body.append(space);
        }
        if (scroll) window.scrollBy({ top: scroll, behavior: "instant" });
        Object.assign(
          dialog.style,
          toolsMenuPosition(anchor.current.getBoundingClientRect(), {
            width: window.innerWidth,
            height: window.innerHeight,
          }),
        );
      }
    };
    position();
    const observer = anchor ? new ResizeObserver(position) : null;
    if (anchor) {
      window.addEventListener("resize", position);
      window.addEventListener("scroll", position, true);
      if (anchor.current) {
        observer!.observe(anchor.current);
        if (anchor.current.parentElement)
          observer!.observe(anchor.current.parentElement);
        const composer = anchor.current
          .closest(".composer-stack")
          ?.querySelector(".composer");
        if (composer) observer!.observe(composer);
        // The centered composer can move without resizing while the rail animates.
        const panel = anchor.current.closest(".home-panel");
        if (panel) observer!.observe(panel);
      }
    }
    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      observer?.disconnect();
      dialog.close();
      space?.remove();
      if (previous?.isConnected) previous.focus();
      // A responsive layout can remove a nested modal's original trigger.
      else if (
        previousDialog?.matches(":modal") &&
        (!previousDialog.contains(document.activeElement) ||
          dialog.contains(document.activeElement))
      ) previousDialog.focus();
    };
  }, [anchor]);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        // React propagates cancel from a nested modal to its reader.
        e.stopPropagation();
        onClose();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          !anchor ||
          e.clientX < bounds.left ||
          e.clientX > bounds.right ||
          e.clientY < bounds.top ||
          e.clientY > bounds.bottom
        )
          onClose();
      }}
    >
      {children}
    </dialog>
  );
}
