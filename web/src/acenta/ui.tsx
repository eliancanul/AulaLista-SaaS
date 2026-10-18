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
