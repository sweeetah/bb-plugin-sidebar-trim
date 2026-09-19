// Sidebar Trim — hide older sidebar threads without archiving them.
//
// One mechanism on both surfaces: BB's native list plus a CSS :has stylesheet
// (overlay) that collapses older rows with max-height/opacity and injects the
// "show older" chevron. Keeping the native list means project grouping,
// nested threads, hover actions and drag-reorder are BB's, not ours, on
// phones as well as desktop.
//
// `display:none` is the thing to stay away from on windowed sidebar rows —
// that is what blanked the list in iOS WKWebView — so no code path uses it on
// compact. components/CompactTrimList.tsx holds an unused React
// reimplementation of the list kept for reference.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  definePluginApp,
  experimental_useSidebarThreads,
  useBbContext,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import { TrimThreadList } from "./components/CompactTrimList";
import {
  type AutoCollapseController,
  mountAutoCollapse,
} from "./lib/autoCollapse";
import {
  findSidebarRoot,
  findSidebarScrollTarget,
  paintedThreadIds,
} from "./lib/dom";
import {
  clearExpandButtons,
  expandFingerprint,
  mountExpandDelegation,
  syncExpandButtons,
} from "./lib/expandButtons";
import { createScrollIdleGate } from "./lib/platform";
import { readExpanded, writeExpanded } from "./lib/storage";
import {
  applyHideStylesheet,
  applyRowEntranceStylesheet,
  clearHideStylesheet,
  hiddenIdsFromDecision,
  managedIdsFromDecision,
} from "./lib/stylesheet";
import {
  computeTrimDecision,
  DEFAULT_GENERAL_LIMIT,
  DEFAULT_WORKSPACE_LIMIT,
  type TrimGroupKey,
} from "./lib/trim";
import { useCompactViewport } from "./lib/viewport";

function parseFlag(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

function parseLimit(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

function SidebarTrimOverlay() {
  const compact = useCompactViewport();
  const { status, threads, projects } = experimental_useSidebarThreads();
  const { threadId: activeThreadId } = useBbContext();
  const settings = useSettings();
  const [expandedGroups, setExpandedGroups] = useState<Set<TrimGroupKey>>(() =>
    readExpanded(),
  );
  const expandedRef = useRef(expandedGroups);
  expandedRef.current = expandedGroups;
  const toggleRef = useRef<(key: TrimGroupKey) => void>(() => {});
  const lastButtonFingerprint = useRef("");
  /**
   * Which group a tap just opened, so the rows effect can give that group — and
   * only that group, and only once — a mount entrance.
   *
   * The rows a chevron reveals are, on a phone, mostly rows that do not exist
   * yet: their windowed placeholders are `display:none`, so BB has never built
   * them, and a CSS transition on an element that is about to be *mounted* has
   * no previous value to interpolate from and silently snaps. That is the whole
   * "it only animates the second time" bug. The fix is a CSS animation, which
   * does play on a fresh mount — but an animation that is always armed would
   * also fire on every row the virtualizer realizes during an ordinary scroll,
   * which is the far worse bug. See the long note above `buildRowEntranceRule`.
   *
   * It carries a snapshot of what was drawn AT THE INSTANT OF THE TAP, not at
   * the instant the effect runs, and that is not a nicety. Measured: BB's
   * virtualizer realizes rows of its own accord about 67 ms after an expand, as
   * the layout change moves things through its observation band — comfortably
   * before this overlay's effect gets to look. Asking the DOM "what is drawn?"
   * inside the effect therefore answered "these too", and those rows were
   * excluded from the entrance and popped instead, on screen, in the middle of
   * the block that was animating. The tap is the moment the user's question
   * was asked, so the tap is the moment to answer it.
   *
   * A ref rather than state deliberately: this is bookkeeping about a change
   * between renders, and putting it in state would re-render the overlay to
   * tell it something it already knows. It is consumed exactly once, by the
   * first rows effect that runs after the toggle.
   */
  const pendingExpand = useRef<{
    key: TrimGroupKey;
    painted: ReadonlySet<string>;
  } | null>(null);
  const scrollGateRef = useRef<ReturnType<typeof createScrollIdleGate> | null>(
    null,
  );

  const workspaceLimitValue = settings.values?.workspaceLimit;
  const generalLimitValue = settings.values?.generalLimit;
  const limits = useMemo(
    () => ({
      workspaceLimit: parseLimit(workspaceLimitValue, DEFAULT_WORKSPACE_LIMIT),
      generalLimit: parseLimit(generalLimitValue, DEFAULT_GENERAL_LIMIT),
    }),
    [generalLimitValue, workspaceLimitValue],
  );

  const decision = useMemo(() => {
    if (status !== "ready") {
      return {
        visibleIds: new Set<string>(),
        expandableGroups: new Map<TrimGroupKey, number>(),
        threadGroup: new Map<string, TrimGroupKey>(),
      };
    }
    return computeTrimDecision({
      threads,
      projects,
      activeThreadId,
      expandedGroups,
      limits,
    });
  }, [activeThreadId, expandedGroups, limits, projects, status, threads]);

  const hiddenIds = useMemo(() => {
    if (status !== "ready") return new Set<string>();
    return hiddenIdsFromDecision(threads, decision, activeThreadId);
  }, [activeThreadId, decision, status, threads]);

  const managedIds = useMemo(() => {
    if (status !== "ready") return new Set<string>();
    return managedIdsFromDecision(threads, decision);
  }, [decision, status, threads]);

  const buttonFingerprint = useMemo(
    // `compact` is part of the fingerprint because BB tears down and rebuilds
    // the sidebar subtree when it swaps the desktop panel for the mobile
    // drawer. Our injected buttons go with it, but the group/expanded state
    // that the fingerprint is made of has not changed — so without this the
    // guard below would short-circuit and never put them back.
    () =>
      `${compact ? "compact" : "wide"}|${expandFingerprint(decision.expandableGroups, expandedGroups)}`,
    [compact, decision.expandableGroups, expandedGroups],
  );

  toggleRef.current = (key: TrimGroupKey) => {
    // Runs synchronously from the delegated click listener, which is the point:
    // the snapshot below has to be taken before anything — React, BB's
    // virtualizer — has had a frame to react to the tap. Expanding only. A
    // collapse reveals nothing, and the rows it hides are already in the DOM
    // with a real previous value, so the collapse transition works on the first
    // tap and always did.
    if (!expandedRef.current.has(key)) {
      const root = findSidebarRoot();
      pendingExpand.current = {
        key,
        painted: root ? paintedThreadIds(root) : new Set<string>(),
      };
    }
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeExpanded(next);
      return next;
    });
  };

  // The overlay now runs on the mobile drawer too. It used to switch itself
  // off there, which left phones with no trimming at all once the compact
  // thread-list slot was stubbed out — the sidebar was all-or-nothing. The
  // original hazard was `display:none` on windowed rows blanking the list in
  // iOS WKWebView; the animated path never used it, and the reduced-motion
  // path no longer does on compact either (see lib/stylesheet.ts). Rows are
  // collapsed by max-height/opacity and stay in the layout tree.
  useEffect(() => {
    const gate = createScrollIdleGate({
      getScrollTarget: () => {
        const root = findSidebarRoot();
        return root ? findSidebarScrollTarget(root) : null;
      },
    });
    scrollGateRef.current = gate;

    const root = findSidebarRoot();
    const unbindClick = root
      ? mountExpandDelegation(root, (key) => toggleRef.current(key))
      : () => {};

    return () => {
      gate.dispose();
      scrollGateRef.current = null;
      unbindClick();
      clearHideStylesheet();
      const current = findSidebarRoot();
      if (current) clearExpandButtons(current);
      lastButtonFingerprint.current = "";
    };
  }, []);

  useEffect(() => {
    // Mobile keeps trimming, but on the compact sheet — see buildCompactRowRules.
    // The desktop sheet's per-row `:has()` rules plus zero-height placeholders
    // froze the drawer for ~5 s; the compact shape measures 30 ms.
    const gate = scrollGateRef.current;
    const apply = () => {
      if (status !== "ready") {
        clearHideStylesheet();
        return;
      }
      // "Every row of the group you just opened that is not drawn yet", read
      // from the live DOM rather than diffed from the trim decision.
      //
      // The diff was the obvious formulation and it was subtly short. Measured:
      // one tap drew 9 rows the plugin had been hiding and 3 more that it had
      // not — rows of the same group that BB's virtualizer had simply never
      // built, sitting on screen as blank reserved space. A hidden-id diff
      // animates 9 of those 12 and pops the other 3, in one block, in view.
      // Asking the DOM what is actually drawn catches both kinds of absence,
      // and rows that ARE drawn are excluded, so nothing that was already on
      // screen is collapsed and re-opened under the user.
      //
      // The "drawn" half of that question was answered at the tap (see
      // `pendingExpand`); this is the group half. Consumed inside `apply` and
      // not outside it because the scroll-idle gate may hold this closure until
      // the finger lifts and then run only the latest one.
      const expand = pendingExpand.current;
      pendingExpand.current = null;
      const entering = expand
        ? [...managedIds].filter(
            (id) =>
              decision.threadGroup.get(id) === expand.key &&
              !expand.painted.has(id),
          )
        : [];
      // Entrance tag first, rows sheet second. Un-hiding a placeholder is what
      // lets the virtualizer realize the row, so the rule that greets it has to
      // already be in the document when that happens. It is the same task
      // either way, but the ordering is the intent.
      applyRowEntranceStylesheet(entering, compact);
      applyHideStylesheet(managedIds, hiddenIds, compact);
    };
    if (gate) gate.run("rows", apply);
    else apply();
  }, [compact, decision.threadGroup, hiddenIds, managedIds, status]);

  useEffect(() => {
    // Expand/collapse chevrons run on mobile too — that is how a trimmed group
    // is opened there. It is a handful of buttons in section headers, not
    // per-row DOM, so it does not move the virtualizer's needle.
    if (status !== "ready") {
      const root = findSidebarRoot();
      if (root) clearExpandButtons(root);
      lastButtonFingerprint.current = "";
      return;
    }
    // A matching fingerprint is not proof the buttons survived: closing and
    // reopening the mobile drawer unmounts them while every input to the
    // fingerprint stays identical. Re-sync unless they are really still there.
    const mounted = findSidebarRoot()?.querySelectorAll(
      "button[data-sidebar-trim-expand]",
    ).length;
    if (
      buttonFingerprint === lastButtonFingerprint.current &&
      mounted === decision.expandableGroups.size
    ) {
      return;
    }

    const gate = scrollGateRef.current;
    const apply = () => {
      const root = findSidebarRoot();
      if (!root) return;
      syncExpandButtons({
        root,
        expandableGroups: decision.expandableGroups,
        expandedGroups: expandedRef.current,
      });
      lastButtonFingerprint.current = buttonFingerprint;
    };
    if (gate) gate.run("buttons", apply);
    else apply();
  }, [compact, buttonFingerprint, decision.expandableGroups, status]);

  return null;
}

/**
 * Couples the two panels: the right panel taking the width is the moment the
 * sidebar is least useful. Kept out of the trim overlay because it observes
 * the whole document, not the thread list, and must survive the overlay's
 * thread-driven re-renders.
 */
function SidebarAutoCollapse() {
  const settings = useSettings();
  const enabled = parseFlag(settings.values?.autoCollapseSidebar, true);
  const controllerRef = useRef<AutoCollapseController | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const controller = mountAutoCollapse(enabledRef.current);
    controllerRef.current = controller;
    return () => {
      controllerRef.current = null;
      controller.dispose();
    };
  }, []);

  useEffect(() => {
    controllerRef.current?.setEnabled(enabled);
  }, [enabled]);

  return null;
}

function LimitsHelp() {
  return (
    <p style={{ margin: 0, fontSize: 14, opacity: 0.8 }}>
      Older threads stay available — nothing is archived. Trim keeps BB’s native
      sidebar (with project/workspace grouping) on every surface and only hides
      older rows, on desktop and on phones alike. Leave Settings → Appearance →
      Sidebar thread list on Built-in — Trim does not need to replace the list.
    </p>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "trim",
    title: "Sidebar Trim",
    description:
      "Shows recent threads only. On phones, older threads are omitted from the list for smooth scrolling.",
    component: TrimThreadList,
  });

  app.slots.experimental_appOverlay({
    id: "sidebar-trim",
    component: SidebarTrimOverlay,
  });

  app.slots.experimental_appOverlay({
    id: "sidebar-auto-collapse",
    component: SidebarAutoCollapse,
  });

  app.slots.settingsSection({
    id: "limits-help",
    title: "How it works",
    component: LimitsHelp,
  });
});
