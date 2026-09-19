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
  findSidebarRoot,
  findSidebarScrollTarget,
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
    () => expandFingerprint(decision.expandableGroups, expandedGroups),
    [decision.expandableGroups, expandedGroups],
  );

  toggleRef.current = (key: TrimGroupKey) => {
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
    const gate = scrollGateRef.current;
    const apply = () => {
      if (status !== "ready") {
        clearHideStylesheet();
        return;
      }
      applyHideStylesheet(managedIds, hiddenIds, compact);
    };
    if (gate) gate.run("rows", apply);
    else apply();
  }, [compact, hiddenIds, managedIds, status]);

  useEffect(() => {
    if (status !== "ready") {
      const root = findSidebarRoot();
      if (root) clearExpandButtons(root);
      lastButtonFingerprint.current = "";
      return;
    }
    if (buttonFingerprint === lastButtonFingerprint.current) return;

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
  }, [buttonFingerprint, decision.expandableGroups, status]);

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

  app.slots.settingsSection({
    id: "limits-help",
    title: "How it works",
    component: LimitsHelp,
  });
});
