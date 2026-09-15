import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { TrimDecision } from "./trim";

const STYLE_ID = "bb-plugin-sidebar-trim-style";
const BUTTON_ATTR = "data-sidebar-trim-expand";

function staticCss(): string {
  return `
    button[${BUTTON_ATTR}] {
      position: relative;
      z-index: 30;
      display: inline-flex;
      height: 1.75rem;
      width: 1.75rem;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      border-radius: 0.375rem;
      border: 0;
      padding: 0;
      margin: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    button[${BUTTON_ATTR}]:hover {
      background: color-mix(in oklab, CanvasText 12%, transparent);
    }
    button[${BUTTON_ATTR}] svg {
      width: 1rem;
      height: 1rem;
      transform: rotate(0deg);
    }
    button[${BUTTON_ATTR}][data-open="true"] svg {
      transform: rotate(90deg);
    }
  `;
}

/** Thread ids that should be CSS-hidden (never touch their DOM nodes). */
export function hiddenIdsFromDecision(
  threads: readonly PluginSidebarThread[],
  decision: TrimDecision,
  activeThreadId: string | null,
): Set<string> {
  const hidden = new Set<string>();
  for (const thread of threads) {
    if (thread.isArchived) continue;
    if (thread.id === activeThreadId) continue;
    if (decision.visibleIds.has(thread.id)) continue;
    hidden.add(thread.id);
  }
  return hidden;
}

function buildHideRules(hiddenIds: Iterable<string>): string {
  const parts: string[] = [];
  for (const id of hiddenIds) {
    const escaped = CSS.escape(id);
    parts.push(
      `.bb-sidebar-hover-actions-row:has([data-sidebar-thread-id="${escaped}"]){display:none!important}`,
    );
  }
  return parts.join("\n");
}

let lastHideKey = "";

export function ensureStyleTag(): HTMLStyleElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  return style;
}

export function applyHideStylesheet(hiddenIds: Set<string>): void {
  const key = [...hiddenIds].sort().join("\0");
  if (key === lastHideKey) return;
  lastHideKey = key;
  const style = ensureStyleTag();
  style.textContent = `${staticCss()}\n${buildHideRules(hiddenIds)}`;
}

export function clearHideStylesheet(): void {
  lastHideKey = "";
  document.getElementById(STYLE_ID)?.remove();
}
