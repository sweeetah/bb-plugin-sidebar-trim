import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useSettings,
  type PluginSidebarProject,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
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
      style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
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

function Section({
  title,
  groupKey,
  overflow,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  groupKey: TrimGroupKey;
  overflow: number;
  expanded: boolean;
  onToggle: (key: TrimGroupKey) => void;
  children: ReactNode;
}) {
  const canExpand = overflow > 0 || expanded;
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
            aria-label={
              expanded
                ? "Show fewer threads"
                : `Show ${overflow} older threads`
            }
            title={
              expanded
                ? "Show fewer threads"
                : `Show ${overflow} older threads`
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
        {children}
      </div>
    </section>
  );
}

/**
 * Phone / coarse viewport list: only mount visible threads — no CSS hiding.
 * Expand/collapse is instant (no enter/exit motion).
 */
export function CompactTrimList({
  activeThreadId,
  onNavigate,
}: Pick<PluginThreadListProps, "activeThreadId" | "onNavigate">) {
  const { status, threads, projects } = experimental_useSidebarThreads();
  const settings = useSettings();
  const [expandedGroups, setExpandedGroups] = useState<Set<TrimGroupKey>>(() =>
    readExpanded(),
  );

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
      { title: string; threads: PluginSidebarThread[] }
    >();

    for (const thread of threads) {
      if (thread.isArchived) continue;
      if (!decision.visibleIds.has(thread.id)) continue;
      const key = groupKeyFor(thread, projects);
      const existing = buckets.get(key);
      if (existing) {
        existing.threads.push(thread);
      } else {
        const title =
          key === "threads"
            ? "Threads"
            : (projectById.get(thread.projectId)?.name ?? "Project");
        buckets.set(key, { title, threads: [thread] });
      }
    }

    for (const bucket of buckets.values()) {
      bucket.threads.sort((a, b) => sortKey(b) - sortKey(a));
    }

    return [...buckets.entries()].sort(([a], [b]) => {
      if (a === "threads") return 1;
      if (b === "threads") return -1;
      const an = buckets.get(a)?.title ?? a;
      const bn = buckets.get(b)?.title ?? b;
      return an.localeCompare(bn);
    });
  }, [decision.visibleIds, projectById, projects, threads]);

  const depthById = useMemo(() => {
    const map = new Map<string, number>();
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    for (const thread of threads) {
      let depth = 0;
      let current: PluginSidebarThread | undefined = thread;
      const seen = new Set<string>();
      while (current?.parentThreadId && !seen.has(current.id)) {
        seen.add(current.id);
        if (!decision.visibleIds.has(current.parentThreadId)) break;
        depth += 1;
        current = byId.get(current.parentThreadId);
      }
      map.set(thread.id, Math.min(depth, 4));
    }
    return map;
  }, [decision.visibleIds, threads]);

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

  if (status === "error") {
    return (
      <div style={{ ...listStyle, opacity: 0.7, fontSize: 13, padding: 16 }}>
        Couldn’t load sidebar threads.
      </div>
    );
  }

  return (
    <div style={listStyle} data-sidebar-trim-compact-list="">
      {sections.map(([key, bucket]) => (
        <Section
          key={key}
          title={bucket.title}
          groupKey={key}
          overflow={decision.expandableGroups.get(key) ?? 0}
          expanded={expandedGroups.has(key)}
          onToggle={onToggle}
        >
          {bucket.threads.map((thread) => (
            <ThreadRow
              key={thread.id}
              thread={thread}
              active={thread.id === activeThreadId}
              depth={depthById.get(thread.id) ?? 0}
              onNavigate={onNavigate}
            />
          ))}
        </Section>
      ))}
      {sections.length === 0 ? (
        <div style={{ opacity: 0.55, fontSize: 13, padding: "0.75rem 0.5rem" }}>
          No threads yet.
        </div>
      ) : null}
    </div>
  );
}

/** Desktop → native BB list. Compact/iOS → filtered React list (no CSS hide). */
export function TrimThreadList(props: PluginThreadListProps) {
  const { Original, isCompactViewport, activeThreadId, onNavigate } = props;

  if (!isCompactViewport) {
    return <Original />;
  }

  return (
    <CompactTrimList
      activeThreadId={activeThreadId}
      onNavigate={onNavigate}
    />
  );
}
