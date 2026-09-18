import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { HOVER_ROW } from "./dom";
import { motion, prefersReducedMotion } from "./motion";
import type { TrimDecision } from "./trim";

const STYLE_ID = "bb-plugin-sidebar-trim-style";
const BUTTON_ATTR = "data-sidebar-trim-expand";

/**
 * BB core sets a fixed row height via this custom property (theme.css:
 * `--bb-sidebar-row-height: 1.75rem`). Reusing it as our max-height cap means
 * the reveal/collapse transition always matches the real row height exactly —
 * no guessing, no clipping, tracks theme changes for free.
 */
const ROW_HEIGHT_VAR = "var(--bb-sidebar-row-height, 1.75rem)";

function staticCss(): string {
  const chevronTransition = prefersReducedMotion()
    ? ""
    : `transition: transform ${motion.duration.chevron}ms ${motion.ease.chevron};`;
  // Arrow A (BB native section chevron): content unmounts so we cannot
  // accordion it from a plugin, but we can match its rotate to our bounce
  // cadence without touching the DOM.
  const nativeChevron = prefersReducedMotion()
    ? ""
    : `
    button[aria-label$=" section"][aria-label^="Expand "] svg,
    button[aria-label$=" section"][aria-label^="Collapse "] svg {
      transition: transform ${motion.duration.chevron}ms ${motion.ease.bounce} !important;
    }`;
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
      ${chevronTransition}
    }
    button[${BUTTON_ATTR}][data-open="true"] svg {
      transform: rotate(90deg);
    }
    ${nativeChevron}
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

/**
 * Every thread id that belongs to a group with overflow — i.e. every row that
 * could plausibly move between hidden and visible as the group's chevron is
 * toggled (or as new threads bump older ones past the limit). Rows outside
 * this set (groups with no overflow) never get transition CSS at all, so the
 * blast radius of "always-on overflow:hidden" stays scoped to rows that
 * actually participate in trimming.
 */
export function managedIdsFromDecision(
  threads: readonly PluginSidebarThread[],
  decision: TrimDecision,
): Set<string> {
  const managed = new Set<string>();
  for (const thread of threads) {
    if (thread.isArchived) continue;
    const group = decision.threadGroup.get(thread.id);
    if (group && decision.expandableGroups.has(group)) managed.add(thread.id);
  }
  return managed;
}

/**
 * One rule per managed row. Reduced motion collapses straight to the old
 * `display:none!important` snap (state changes are preserved, the animation
 * isn't). Otherwise every managed row stays a transition-ready
 * `overflow:hidden` box at all times, and only the max-height/opacity/transform
 * *targets* differ between the hidden and visible variants — that's what lets
 * a later toggle (regenerating this same rule with the other variant) animate:
 * CSS transitions fire on the value change between the row's previous
 * committed style and this new one, not on whether the rule text is "the
 * same rule" from one call to the next.
 */
/**
 * `transition` is one list, not additive: this rule wins the cascade on the row
 * (`.bb-sidebar-hover-actions-row:has(...)` outranks a bare class), so whatever
 * it declares is the row's *complete* transitioned set. Without the interaction
 * properties appended, the iCandy motion plugin's hover lift — which animates
 * `scale` / `translate` / `filter` — applied instantly and every managed row
 * snapped on hover while unmanaged rows rose smoothly.
 *
 * The fallback is load-bearing: with iCandy disabled the custom property is
 * undefined, and a bare `var()` would invalidate this whole declaration at
 * computed-value time, taking the collapse/reveal animation down with it.
 */
const ICANDY_INTERACTION_TRANSITION =
  "var(--icandy-interaction-transition," +
  "scale 380ms ease,translate 300ms ease,filter 300ms ease)";

function buildRowRules(
  managedIds: Iterable<string>,
  hiddenIds: ReadonlySet<string>,
): string {
  const parts: string[] = [];
  const reduced = prefersReducedMotion();
  for (const id of managedIds) {
    const escaped = CSS.escape(id);
    const selector = `${HOVER_ROW}:has([data-sidebar-thread-id="${escaped}"])`;
    const hidden = hiddenIds.has(id);
    if (reduced) {
      if (hidden) parts.push(`${selector}{display:none!important}`);
      continue;
    }
    if (hidden) {
      parts.push(
        `${selector}{overflow:hidden;pointer-events:none;` +
          `transition:max-height ${motion.duration.collapseMax}ms ${motion.ease.exit},` +
          `opacity ${motion.duration.collapseFade}ms ${motion.ease.exit},` +
          `transform ${motion.duration.collapseMax}ms ${motion.ease.exit},` +
          `${ICANDY_INTERACTION_TRANSITION};` +
          `max-height:0;opacity:0;transform:translateY(-${motion.distance.rowLift}px) scale(0.97)}`,
      );
    } else {
      parts.push(
        `${selector}{overflow:hidden;` +
          `transition:max-height ${motion.duration.revealMax}ms ${motion.ease.enter},` +
          `opacity ${motion.duration.revealFade}ms ${motion.ease.fade},` +
          `transform ${motion.duration.revealMax}ms ${motion.ease.bounce},` +
          `${ICANDY_INTERACTION_TRANSITION};` +
          `max-height:${ROW_HEIGHT_VAR};opacity:1;transform:translateY(0) scale(1)}`,
      );
    }
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

export function applyHideStylesheet(
  managedIds: Set<string>,
  hiddenIds: Set<string>,
): void {
  const key = `${[...managedIds].sort().join("\0")}|${[...hiddenIds].sort().join("\0")}|${prefersReducedMotion() ? 1 : 0}`;
  if (key === lastHideKey) return;
  lastHideKey = key;
  const style = ensureStyleTag();
  style.textContent = `${staticCss()}\n${buildRowRules(managedIds, hiddenIds)}`;
}

export function clearHideStylesheet(): void {
  lastHideKey = "";
  document.getElementById(STYLE_ID)?.remove();
}
