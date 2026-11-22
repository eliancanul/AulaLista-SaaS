/** Zero-dependency visual viewport capture to PNG for Support debug reports. */

export interface CapturedScreenshot {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: string;
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(Math.max(0, r), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function isTransparent(color: string | null | undefined): boolean {
  if (!color) return true;
  const c = color.trim().toLowerCase();
  return c === "transparent" || c === "rgba(0, 0, 0, 0)" || c === "rgba(0,0,0,0)";
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let currentY = y;
  let linesDrawn = 0;
  for (let i = 0; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, currentY);
      linesDrawn++;
      if (linesDrawn >= maxLines) return;
      line = words[i];
      currentY += lineHeight;
    } else {
      line = candidate;
    }
  }
  if (line && linesDrawn < maxLines) {
    ctx.fillText(line, x, currentY);
  }
}

/**
 * Renders the currently visible viewport DOM into a crisp PNG data URL without
 * requiring OS screen-share permissions or external libraries.
 */
export async function captureViewportScreenshot(): Promise<CapturedScreenshot | null> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }
  const vw = Math.max(320, window.innerWidth || 1280);
  const vh = Math.max(320, window.innerHeight || 720);
  const scale = Math.min(1, 1280 / vw);
  const cw = Math.round(vw * scale);
  const ch = Math.round(vh * scale);

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.save();
  ctx.scale(scale, scale);

  // Paint base page background
  const bodyBg = getComputedStyle(document.body).backgroundColor;
  ctx.fillStyle = isTransparent(bodyBg) ? "#f4f1ea" : bodyBg;
  ctx.fillRect(0, 0, vw, vh);

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  let node: Node | null = walker.currentNode;
  let painted = 0;
  const MAX_ELEMENTS = 1800;

  while (node && painted < MAX_ELEMENTS) {
    const el = node as HTMLElement;
    if (el.dataset?.supportOverlay === "true") {
      node = walker.nextSibling();
      continue;
    }
    const style = getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      parseFloat(style.opacity || "1") <= 0.02
    ) {
      node = walker.nextNode();
      continue;
    }

    const rect = el.getBoundingClientRect();
    if (
      rect.width > 0.5 &&
      rect.height > 0.5 &&
      rect.bottom > 0 &&
      rect.right > 0 &&
      rect.top < vh &&
      rect.left < vw
    ) {
      painted++;
      const radius = parseFloat(style.borderTopLeftRadius || "0") || 0;
      const bg = style.backgroundColor;
      const borderW = parseFloat(style.borderTopWidth || "0") || 0;
      const borderC = style.borderTopColor;

      if (!isTransparent(bg)) {
        ctx.fillStyle = bg;
        drawRoundedRect(ctx, rect.left, rect.top, rect.width, rect.height, radius);
        ctx.fill();
      }
      if (borderW > 0 && !isTransparent(borderC)) {
        ctx.strokeStyle = borderC;
        ctx.lineWidth = Math.min(borderW, 3);
        drawRoundedRect(ctx, rect.left, rect.top, rect.width, rect.height, radius);
        ctx.stroke();
      }

      // Paint input / textarea text values (mask password fields)
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        const isSecret = el instanceof HTMLInputElement && el.type === "password";
        const val = isSecret ? "••••••••" : (el.value || el.placeholder || "");
        if (val.trim()) {
          const fontSize = parseFloat(style.fontSize || "14") || 14;
          const padL = parseFloat(style.paddingLeft || "8") || 8;
          const padT = parseFloat(style.paddingTop || "8") || 8;
          ctx.fillStyle = el.value ? (style.color || "#1c1917") : "#8c8277";
          ctx.font = `${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily || "system-ui, sans-serif"}`;
          ctx.textBaseline = "top";
          wrapText(
            ctx,
            val,
            rect.left + padL,
            rect.top + padT,
            Math.max(40, rect.width - padL * 2),
            fontSize * 1.35,
            Math.max(1, Math.floor((rect.height - padT) / (fontSize * 1.35))),
          );
        }
      } else {
        // Paint direct text nodes inside this element
        let directText = "";
        for (let i = 0; i < el.childNodes.length; i++) {
          const child = el.childNodes[i];
          if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
            directText += (directText ? " " : "") + child.textContent.trim();
          }
        }
        if (directText) {
          const fontSize = Math.min(36, Math.max(9, parseFloat(style.fontSize || "14") || 14));
          const padL = parseFloat(style.paddingLeft || "0") || 0;
          const padT = parseFloat(style.paddingTop || "0") || 0;
          const lh = parseFloat(style.lineHeight) || fontSize * 1.35;
          ctx.fillStyle = style.color || "#1c1917";
          ctx.font = `${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily || "system-ui, sans-serif"}`;
          ctx.textBaseline = "top";
          ctx.save();
          ctx.beginPath();
          ctx.rect(rect.left, rect.top, rect.width + 2, rect.height + 2);
          ctx.clip();
          wrapText(
            ctx,
            directText,
            rect.left + padL,
            rect.top + padT + Math.max(0, (lh - fontSize) / 4),
            Math.max(24, rect.width - padL * 2),
            lh,
            Math.max(1, Math.ceil(rect.height / lh)),
          );
          ctx.restore();
        }
      }
    }
    node = walker.nextNode();
  }

  // Stamp subtle capture metadata strip in bottom-right corner
  const stamp = `Acenta Capture · ${vw}×${vh} · ${new Date().toLocaleTimeString("es-MX")}`;
  ctx.font = "500 11px system-ui, -apple-system, sans-serif";
  const tw = ctx.measureText(stamp).width + 16;
  ctx.fillStyle = "rgba(28, 25, 23, 0.72)";
  drawRoundedRect(ctx, vw - tw - 10, vh - 28, tw, 20, 6);
  ctx.fill();
  ctx.fillStyle = "#faf8f4";
  ctx.textBaseline = "middle";
  ctx.fillText(stamp, vw - tw - 2, vh - 18);

  ctx.restore();

  try {
    const dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png;base64,")) return null;
    return {
      dataUrl,
      width: cw,
      height: ch,
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
