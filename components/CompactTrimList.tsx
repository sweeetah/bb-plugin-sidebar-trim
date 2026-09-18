import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useSettings,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { motion, prefersReducedMotion } from "../lib/motion";
import { readExpanded, writeExpanded } from "../lib/storage";
import {
  computeTrimDecision,
  DEFAULT_GENERAL_LIMIT,
  DEFAULT_WORKSPACE_LIMIT,
  groupKeyFor,
  type TrimGroupKey,
} from "../lib/trim";

function parseLimit(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(n)));
}

function threadTitle(thread: PluginSidebarThread): string {
  return thread.title?.trim() || thread.titleFallback?.trim() || "Untitled";
}

function sortKey(thread: PluginSidebarThread): number {
  return Math.max(thread.latestAttentionAt, thread.updatedAt, thread.createdAt);
}

function hasAttention(thread: PluginSidebarThread): boolean {
  return (
    thread.isUnread ||
    thread.hasPendingInteraction ||
    thread.indicator !== "none" ||
    thread.activity.workflows > 0 ||
    thread.activity.backgroundAgents > 0 ||
    thread.activity.backgroundCommands > 0 ||
    thread.activity.planMode > 0 ||
    thread.activity.goals > 0
  );
}

/**
 * Split a group into the always-visible head and the accordion tail.
 * Tail stays mounted so expand/collapse can animate height instead of
 * mounting/unmounting (which jumps everything below).
 */
function splitHeadTail(
  members: readonly PluginSidebarThread[],
  limit: number,
  activeThreadId: string | null,
): { head: PluginSidebarThread[]; tail: PluginSidebarThread[] } {
  const ranked = [...members].sort((a, b) => sortKey(b) - sortKey(a));
  const headIds = new Set<string>();
  for (const thread of ranked.slice(0, limit)) headIds.add(thread.id);
  for (const thread of members) {
    if (
      thread.isPinned ||
      thread.id === activeThreadId ||
      hasAttention(thread)
    ) {
      headIds.add(thread.id);
    }
  }
  const head = ranked.filter((thread) => headIds.has(thread.id));
  const tail = ranked.filter((thread) => !headIds.has(thread.id));
  return { head, tail };
}

const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: "0.25rem 0.5rem 1rem",
  gap: "0.75rem",
};

const sectionLabelStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.35rem",
  padding: "0.35rem 0.5rem",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "color-mix(in oklab, var(--sidebar-foreground, CanvasText) 55%, transparent)",
};

const rowStyle = (active: boolean, depth: number): CSSProperties => ({
  position: "relative",
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  minHeight: "2.25rem",
  padding: `0.35rem 0.6rem 0.35rem ${0.6 + depth * 0.75}rem`,
  borderRadius: 8,
  background: active
    ? "var(--sidebar-accent, color-mix(in oklab, CanvasText 10%, transparent))"
    : "transparent",
  color: active
    ? "var(--sidebar-accent-foreground, var(--foreground, CanvasText))"
    : "var(--sidebar-foreground, CanvasText)",
  fontSize: 14,
  lineHeight: 1.25,
});

const chevronButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: "1.75rem",
  height: "1.75rem",
  marginLeft: "auto",
  border: 0,
  borderRadius: 6,
  padding: 0,
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
};

function Chevron({ open }: { open: boolean }) {
  const reduced = prefersReducedMotion();
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        transform: open ? "rotate(90deg)" : "rotate(0deg)",
        transition: reduced
          ? undefined
          : `transform ${motion.duration.chevron}ms ${motion.ease.chevron}`,
      }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ThreadRow({
  thread,
  active,
  depth,
  onNavigate,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  depth: number;
  onNavigate: () => void;
}) {
  const actions = experimental_useSidebarThreadActions();
  const title = threadTitle(thread);
  const showDot =
    thread.isUnread ||
    thread.hasPendingInteraction ||
    thread.indicator !== "none";

  return (
    <div style={rowStyle(active, depth)}>
      <a
        data-sidebar-thread-shortcut-target=""
        data-sidebar-thread-id={thread.id}
        href="#"
        aria-label={title}
        onClick={(event) => {
          event.preventDefault();
          actions.open(thread.id, {
            split: event.metaKey || event.ctrlKey,
          });
          onNavigate();
        }}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 8,
          cursor: "pointer",
        }}
      />
      {showDot ? (
        <span
          aria-hidden="true"
          style={{
            position: "relative",
            width: 7,
            height: 7,
            borderRadius: 99,
            background: "var(--primary, #4078f2)",
            flexShrink: 0,
          }}
        />
      ) : (
        <span style={{ width: 7, flexShrink: 0 }} />
      )}
      <span
        style={{
          position: "relative",
          minWidth: 0,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontWeight: thread.isUnread || active ? 600 : 400,
        }}
      >
        {title}
      </span>
      {thread.isPinned ? (
        <span
          aria-label="Pinned"
          style={{
            position: "relative",
            fontSize: 10,
            opacity: 0.55,
            flexShrink: 0,
          }}
        >
          ★
        </span>
      ) : null}
    </div>
  );
}

function Accordion({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const reduced = prefersReducedMotion();
  const prevOpen = useRef(open);
  // Only tween when the user toggles — never on mount / drawer re-show.
  // iOS WKWebView otherwise replays CSS transitions when the inert panel
  // becomes visible again (the close→open flicker).
  const [tweening, setTweening] = useState(false);

  useEffect(() => {
    if (prevOpen.current === open) return;
    prevOpen.current = open;
    if (reduced) return;
    setTweening(true);
    const ms = open
      ? motion.duration.revealMax
      : motion.duration.collapseMax;
    const timer = window.setTimeout(() => setTweening(false), ms + 32);
    return () => window.clearTimeout(timer);
  }, [open, reduced]);

  if (reduced) {
    return open ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {children}
      </div>
    ) : null;
  }

  const duration = open
    ? motion.duration.revealMax
    : motion.duration.collapseMax;
  const ease = open ? motion.ease.bounce : motion.ease.exit;
  const fadeMs = open
    ? motion.duration.revealFade
    : motion.duration.collapseFade;
  const fadeEase = open ? motion.ease.fade : motion.ease.exit;
  const transformEase = open ? motion.ease.bounce : motion.ease.exit;
  const transformMs = open
    ? motion.duration.revealMax
    : motion.duration.collapseMax;

  return (
    <div
      aria-hidden={!open}
      style={{
        display: "grid",
        gridTemplateRows: open ? "1fr" : "0fr",
        transition: tweening
          ? `grid-template-rows ${duration}ms ${ease}`
          : "none",
      }}
    >
      <div
        style={{
          overflow: "hidden",
          minHeight: 0,
          opacity: open ? 1 : 0,
          transform: open
            ? "translateY(0) scale(1)"
            : `translateY(-${motion.distance.rowLift}px) scale(0.97)`,
          transition: tweening
            ? `opacity ${fadeMs}ms ${fadeEase}, transform ${transformMs}ms ${transformEase}`
            : "none",
          pointerEvents: open ? "auto" : "none",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  groupKey,
  overflow,
  expanded,
  onToggle,
  head,
  tail,
  activeThreadId,
  depthById,
  onNavigate,
}: {
  title: string;
  groupKey: TrimGroupKey;
  overflow: number;
  expanded: boolean;
  onToggle: (key: TrimGroupKey) => void;
  head: PluginSidebarThread[];
  tail: PluginSidebarThread[];
  activeThreadId: string | null;
  depthById: Map<string, number>;
  onNavigate: () => void;
}) {
  const canExpand = overflow > 0 || expanded || tail.length > 0;
  return (
    <section>
      <div style={sectionLabelStyle}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {title}
        </span>
        {canExpand ? (
          <button
            type="button"
            style={chevronButtonStyle}
            aria-expanded={expanded}
            aria-label={
              expanded
                ? "Show fewer threads"
                : `Show ${overflow || tail.length} older threads`
            }
            title={
              expanded
                ? "Show fewer threads"
                : `Show ${overflow || tail.length} older threads`
            }
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggle(groupKey);
            }}
          >
            <Chevron open={expanded} />
          </button>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {head.map((thread) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            active={thread.id === activeThreadId}
            depth={depthById.get(thread.id) ?? 0}
            onNavigate={onNavigate}
          />
        ))}
        {tail.length > 0 ? (
          <Accordion open={expanded}>
            {tail.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                active={thread.id === activeThreadId}
                depth={depthById.get(thread.id) ?? 0}
                onNavigate={onNavigate}
              />
            ))}
          </Accordion>
        ) : null}
      </div>
    </section>
  );
}

/**
 * Survives CompactTrimList remounts (mobile drawer realize / plugin slot
 * remount). Without this, reopen briefly shows "Loading threads…" then the
 * list again — the flicker the user reported.
 */
let lastReadySnapshot: {
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
} | null = null;

/**
 * Phone / coarse viewport list: mount head + accordion tail (no CSS hide).
 * Expand/collapse is height-driven so rows below ride the reflow.
 */
export function CompactTrimList({
  activeThreadId,
  onNavigate,
}: Pick<PluginThreadListProps, "activeThreadId" | "onNavigate">) {
  const live = experimental_useSidebarThreads();
  const settings = useSettings();
  const [expandedGroups, setExpandedGroups] = useState<Set<TrimGroupKey>>(() =>
    readExpanded(),
  );

  if (live.status === "ready") {
    lastReadySnapshot = { threads: live.threads, projects: live.projects };
  }
  const threads =
    live.status === "ready"
      ? live.threads
      : (lastReadySnapshot?.threads ?? live.threads);
  const projects =
    live.status === "ready"
      ? live.projects
      : (lastReadySnapshot?.projects ?? live.projects);
  const status =
    live.status === "loading" && lastReadySnapshot !== null
      ? "ready"
      : live.status;

  const limits = useMemo(
    () => ({
      workspaceLimit: parseLimit(
        settings.values?.workspaceLimit,
        DEFAULT_WORKSPACE_LIMIT,
      ),
      generalLimit: parseLimit(
        settings.values?.generalLimit,
        DEFAULT_GENERAL_LIMIT,
      ),
    }),
    [settings.values?.generalLimit, settings.values?.workspaceLimit],
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

  const projectById = useMemo(() => {
    const map = new Map<string, PluginSidebarProject>();
    for (const project of projects) map.set(project.id, project);
    return map;
  }, [projects]);

  const sections = useMemo(() => {
    const buckets = new Map<
      TrimGroupKey,
      { title: string; members: PluginSidebarThread[] }
    >();

    for (const thread of threads) {
      if (thread.isArchived) continue;
      const key = groupKeyFor(thread, projects);
      const existing = buckets.get(key);
      if (existing) {
        existing.members.push(thread);
      } else {
        const title =
          key === "threads"
            ? "Threads"
            : (projectById.get(thread.projectId)?.name ?? "Project");
        buckets.set(key, { title, members: [thread] });
      }
    }

    return [...buckets.entries()]
      .map(([key, bucket]) => {
        const limit =
          key === "threads" ? limits.generalLimit : limits.workspaceLimit;
        const { head, tail } = splitHeadTail(
          bucket.members,
          limit,
          activeThreadId,
        );
        return {
          key,
          title: bucket.title,
          head,
          tail,
          overflow: decision.expandableGroups.get(key) ?? tail.length,
        };
      })
      .filter((section) => section.head.length > 0 || section.tail.length > 0)
      .sort((a, b) => {
        if (a.key === "threads") return 1;
        if (b.key === "threads") return -1;
        return a.title.localeCompare(b.title);
      });
  }, [
    activeThreadId,
    decision.expandableGroups,
    limits.generalLimit,
    limits.workspaceLimit,
    projectById,
    projects,
    threads,
  ]);

  const depthById = useMemo(() => {
    const map = new Map<string, number>();
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const visible = new Set<string>();
    for (const section of sections) {
      for (const thread of section.head) visible.add(thread.id);
      if (expandedGroups.has(section.key)) {
        for (const thread of section.tail) visible.add(thread.id);
      }
    }
    for (const thread of threads) {
      let depth = 0;
      let current: PluginSidebarThread | undefined = thread;
      const seen = new Set<string>();
      while (current?.parentThreadId && !seen.has(current.id)) {
        seen.add(current.id);
        if (!visible.has(current.parentThreadId)) break;
        depth += 1;
        current = byId.get(current.parentThreadId);
      }
      map.set(thread.id, Math.min(depth, 4));
    }
    return map;
  }, [expandedGroups, sections, threads]);

  const onToggle = (key: TrimGroupKey) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeExpanded(next);
      return next;
    });
  };

  if (status === "loading") {
    return (
      <div style={{ ...listStyle, opacity: 0.6, fontSize: 13, padding: 16 }}>
        Loading threads…
      </div>
    );
  }

  if (status === "error" && lastReadySnapshot === null) {
    return (
      <div style={{ ...listStyle, opacity: 0.7, fontSize: 13, padding: 16 }}>
        Couldn’t load sidebar threads.
      </div>
    );
  }

  return (
    <div style={listStyle} data-sidebar-trim-compact-list="">
      {sections.map((section) => (
        <Section
          key={section.key}
          title={section.title}
          groupKey={section.key}
          overflow={section.overflow}
          expanded={expandedGroups.has(section.key)}
          onToggle={onToggle}
          head={section.head}
          tail={section.tail}
          activeThreadId={activeThreadId}
          depthById={depthById}
          onNavigate={onNavigate}
        />
      ))}
      {sections.length === 0 ? (
        <div style={{ opacity: 0.55, fontSize: 13, padding: "0.75rem 0.5rem" }}>
          No threads yet.
        </div>
      ) : null}
    </div>
  );
}

/**
 * Always use BB’s native thread list so project/workspace grouping stays intact
 * on desktop and mobile. Desktop trim still comes from SidebarTrimOverlay CSS;
 * CompactTrimList is kept for possible future opt-in but is not mounted by default
 * (it previously replaced the native list on phones and wiped grouping).
 */
export function TrimThreadList(props: PluginThreadListProps) {
  return <props.Original />;
}
