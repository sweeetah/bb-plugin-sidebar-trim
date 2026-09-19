// Auto-collapse the left sidebar while the right panel is open.
//
// BB keeps the two panels completely independent: the left sidebar's open flag
// is a persisted atom (localStorage `bb.sidebar.open`) toggled by the
// `sidebar.toggle` command, and the right panel's open flag lives per-tab in
// the nav-panel state. Nothing in the host couples them, and the plugin SDK
// exposes no way to invoke a host command, so this watches the DOM and clicks
// BB's own sidebar trigger.
//
// Clicking the real trigger (rather than writing `bb.sidebar.open` ourselves)
// keeps the host as the single source of truth — no desynced atom, no layout
// left half-applied, and BB's own open/close transition still plays.

// Right panel toggle. BB flips this label from the panel's `isOpen`, then
// appends the keybinding — the live label is "Hide right panel (⌘ J)", not
// "Hide right panel" — so these must stay prefix matches. Both buttons exist in
// the DOM at once and only one is laid out, hence the visibility filter below.
const RIGHT_PANEL_OPEN = '[aria-label^="Hide right panel"]';
const RIGHT_PANEL_CLOSED = '[aria-label^="Show right panel"]';

/**
 * Left sidebar trigger (shadcn `SidebarTrigger`). BB renders one in the
 * desktop shelf (`app-desktop-sidebar-trigger`) and one for compact chrome, so
 * take whichever is actually laid out. `aria-expanded` mirrors the atom.
 */
const SIDEBAR_TRIGGER = '[data-sidebar="trigger"]';

/** Mirrors BB `useIsCompactViewport` — the mobile drawer is hands-off. */
const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

function isLaidOut(element: HTMLElement): boolean {
  if (element.closest('[inert], [aria-hidden="true"]')) return false;
  return element.offsetParent !== null || element.getClientRects().length > 0;
}

function hasVisible(selector: string): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).some(
    isLaidOut,
  );
}

function findSidebarTrigger(): HTMLElement | null {
  const triggers = Array.from(
    document.querySelectorAll<HTMLElement>(SIDEBAR_TRIGGER),
  );
  return triggers.find(isLaidOut) ?? triggers[0] ?? null;
}

/**
 * `null` when no right panel toggle is on screen (mid-remount, no thread, or a
 * route with no panel host). Open wins when a split shows both, since any open
 * panel is already competing with the sidebar for width.
 */
function readRightPanelOpen(): boolean | null {
  if (hasVisible(RIGHT_PANEL_OPEN)) return true;
  if (hasVisible(RIGHT_PANEL_CLOSED)) return false;
  return null;
}

/** `null` when the trigger has not mounted or carries no `aria-expanded`. */
function readSidebarOpen(trigger: HTMLElement | null): boolean | null {
  const expanded = trigger?.getAttribute("aria-expanded");
  if (expanded === "true") return true;
  if (expanded === "false") return false;
  return null;
}

export interface AutoCollapseController {
  /** Settings can flip this at runtime without remounting the observer. */
  setEnabled(enabled: boolean): void;
  dispose(): void;
}

/**
 * Wires the coupling and returns a controller. Behavior:
 *
 * - right panel opens while the sidebar is open → collapse it, and remember
 *   that the collapse was ours;
 * - right panel closes → restore the sidebar only if the collapse was ours;
 * - sidebar toggled by hand in between → forget the claim and stay out of the
 *   way, so a manual re-open is never undone later.
 *
 * Startup is deliberately passive: only *transitions* act, so launching with
 * both panels open does not yank the sidebar away.
 */
export function mountAutoCollapse(
  initialEnabled: boolean,
): AutoCollapseController {
  let enabled = initialEnabled;
  let disposed = false;

  // `null` until the first observation — the first pass only records state.
  let prevRightOpen: boolean | null = null;
  let prevSidebarOpen: boolean | null = null;
  // True while the current collapse is one we performed.
  let collapsedByUs = false;

  let frame = 0;
  const compact = window.matchMedia(COMPACT_VIEWPORT_QUERY);

  const forget = () => {
    prevRightOpen = null;
    prevSidebarOpen = null;
    collapsedByUs = false;
  };

  const sync = () => {
    if (disposed) return;
    // Mobile drawer: BB overlays the sidebar instead of reserving width, so
    // there is nothing to win by collapsing it. Drop any pending claim too,
    // otherwise resizing back to desktop would restore a sidebar the user
    // closed themselves.
    if (!enabled || compact.matches) {
      forget();
      return;
    }

    const rightOpen = readRightPanelOpen();
    if (rightOpen === null) return;
    const trigger = findSidebarTrigger();
    const sidebarOpen = readSidebarOpen(trigger);
    if (sidebarOpen === null || trigger === null) return;

    if (prevRightOpen === null || prevSidebarOpen === null) {
      prevRightOpen = rightOpen;
      prevSidebarOpen = sidebarOpen;
      return;
    }

    if (rightOpen !== prevRightOpen) {
      if (rightOpen && sidebarOpen) {
        trigger.click();
        collapsedByUs = true;
        // Record the intent, not the DOM: the click lands asynchronously and
        // the resulting mutation must not read back as a manual toggle.
        prevSidebarOpen = false;
      } else if (!rightOpen && collapsedByUs && !sidebarOpen) {
        trigger.click();
        collapsedByUs = false;
        prevSidebarOpen = true;
      } else {
        collapsedByUs = false;
        prevSidebarOpen = sidebarOpen;
      }
      prevRightOpen = rightOpen;
      return;
    }

    // The sidebar moved with the right panel standing still — that was the
    // user (or another plugin). Release the claim so we never fight them.
    if (sidebarOpen !== prevSidebarOpen) {
      collapsedByUs = false;
      prevSidebarOpen = sidebarOpen;
    }
  };

  const schedule = () => {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["aria-label", "aria-expanded"],
  });
  compact.addEventListener("change", schedule);
  schedule();

  return {
    setEnabled(next: boolean) {
      if (next === enabled) return;
      enabled = next;
      // Re-arming starts from a clean slate rather than acting on a
      // transition that happened while we were switched off.
      forget();
      schedule();
    },
    dispose() {
      disposed = true;
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      compact.removeEventListener("change", schedule);
    },
  };
}
