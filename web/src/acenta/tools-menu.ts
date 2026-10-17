/** Scroll the trigger only when the catalog would otherwise be unreachable. */
export function toolsMenuScroll(
  anchor: { top: number; bottom: number },
  viewportHeight: number,
) {
  const margin = 16;
  const triggerHeight = anchor.bottom - anchor.top;
  const minimumMenuHeight = Math.min(
    192,
    Math.max(0, viewportHeight - margin * 2 - triggerHeight - 8),
  );
  const maximumBottom = viewportHeight - margin - 8 - minimumMenuHeight;
  // Ignore subpixel remainders so integer page scrolling cannot oscillate.
  if (anchor.bottom > maximumBottom)
    return Math.trunc(anchor.bottom - maximumBottom);
  if (anchor.top < margin) return Math.trunc(anchor.top - margin) || 0;
  return 0;
}

/** Position after toolsMenuScroll; short viewports scroll the catalog internally. */
export function toolsMenuPosition(
  anchor: { right: number; bottom: number },
  viewport: { width: number; height: number },
) {
  const margin = 16;
  const width = Math.min(560, Math.max(0, viewport.width - margin * 2));
  const top = anchor.bottom + 8;
  return {
    width: `${width}px`,
    left: `${Math.max(margin, Math.min(anchor.right - width, viewport.width - width - margin))}px`,
    top: `${top}px`,
    maxHeight: `${Math.max(0, viewport.height - top - margin)}px`,
  };
}
