// Sidebar Trim — hide older sidebar threads without archiving them.
//
// Desktop: native BB list + CSS :has stylesheet (overlay).
// Compact/iOS: experimental_threadList renders only visible rows — no
// display:none. That is the path that stays smooth on TestFlight.
// Expand/collapse is instant (no row motion).
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
import { createScrollIdleGate, isIosLike } from "./lib/platform";
import { readExpanded, writeExpanded } from "./lib/storage";
import {
  applyHideStylesheet,
  clearHideStylesheet,
  hiddenIdsFromDecision,
} from "./lib/stylesheet";
import {
  computeTrimDecision,
  DEFAULT_GENERAL_LIMIT,
  DEFAULT_WORKSPACE_LIMIT,
  type TrimGroupKey,
} from "./lib/trim";

function parseLimit(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

/** True when the phone threadList path owns trimming — overlay must stay idle. */
function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return (
      window.matchMedia("(max-width: 767px)").matches &&
      (window.matchMedia("(pointer: coarse)").matches || isIosLike())
    );
  });
  useEffect(() => {
    const width = window.matchMedia("(max-width: 767px)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const sync = () => {
      setCompact(width.matches && (coarse.matches || isIosLike()));
    };
    sync();
    width.addEventListener("change", sync);
    coarse.addEventListener("change", sync);
    return () => {
      width.removeEventListener("change", sync);
      coarse.removeEventListener("change", sync);
    };
  }, []);
  return compact;
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

  useEffect(() => {
    if (compact) {
      clearHideStylesheet();
      const root = findSidebarRoot();
      if (root) clearExpandButtons(root);
      return;
    }

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
  }, [compact]);

  useEffect(() => {
    if (compact) return;
    const gate = scrollGateRef.current;
    const apply = () => {
      if (status !== "ready") {
        clearHideStylesheet();
        return;
      }
      applyHideStylesheet(hiddenIds);
    };
    if (gate) gate.run(apply);
    else apply();
  }, [compact, hiddenIds, status]);

  useEffect(() => {
    if (compact) return;
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
    if (gate) gate.run(apply);
    else apply();
  }, [buttonFingerprint, compact, decision.expandableGroups, status]);

  return null;
}

function LimitsHelp() {
  return (
    <p style={{ margin: 0, fontSize: 14, opacity: 0.8 }}>
      Older threads stay available — nothing is archived. On iPhone, Trim
      replaces the sidebar list with a filtered list (no hidden rows). On
      desktop it keeps BB’s native list. If the phone list looks untrimmed, open
      Settings → Appearance and set the sidebar thread list to “Sidebar Trim”.
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
