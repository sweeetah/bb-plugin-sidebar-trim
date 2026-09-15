import type {
  PluginSidebarProject,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";

export const DEFAULT_WORKSPACE_LIMIT = 3;
export const DEFAULT_GENERAL_LIMIT = 24;

/** Matches BB's `data-sidebar-section-id` values we care about. */
export type TrimGroupKey = `project:${string}` | "threads";

export interface TrimLimits {
  workspaceLimit: number;
  generalLimit: number;
}

export interface TrimDecision {
  /** Thread ids that should stay visible while their group is collapsed. */
  visibleIds: Set<string>;
  /** Groups that currently have more threads than the limit. */
  expandableGroups: Map<TrimGroupKey, number>;
  /** Map thread id → group key for DOM association. */
  threadGroup: Map<string, TrimGroupKey>;
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

function sortKey(thread: PluginSidebarThread): number {
  return Math.max(thread.latestAttentionAt, thread.updatedAt, thread.createdAt);
}

export function groupKeyFor(
  thread: PluginSidebarThread,
  projects: readonly PluginSidebarProject[],
): TrimGroupKey {
  // Personal / projectless threads live under the sidebar "Threads" section.
  if (thread.projectId === "proj_personal") return "threads";
  const project = projects.find((item) => item.id === thread.projectId);
  if (!project || project.isPersonal) return "threads";
  return `project:${thread.projectId}`;
}

/**
 * Decide which threads stay visible when groups are collapsed.
 * Always keeps pinned threads, the active thread, attention threads, and
 * ancestors/descendants needed to keep nesting coherent.
 */
export function computeTrimDecision(options: {
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  activeThreadId: string | null;
  expandedGroups: ReadonlySet<TrimGroupKey>;
  limits: TrimLimits;
}): TrimDecision {
  const { threads, projects, activeThreadId, expandedGroups, limits } = options;
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const threadGroup = new Map<string, TrimGroupKey>();
  const groups = new Map<TrimGroupKey, PluginSidebarThread[]>();

  for (const thread of threads) {
    if (thread.isArchived) continue;
    const key = groupKeyFor(thread, projects);
    threadGroup.set(thread.id, key);
    const list = groups.get(key);
    if (list) list.push(thread);
    else groups.set(key, [thread]);
  }

  const visibleIds = new Set<string>();
  const expandableGroups = new Map<TrimGroupKey, number>();

  for (const [key, members] of groups) {
    const limit =
      key === "threads" ? limits.generalLimit : limits.workspaceLimit;
    const ranked = [...members].sort((a, b) => sortKey(b) - sortKey(a));
    const overflow = Math.max(0, ranked.length - limit);
    if (overflow > 0) expandableGroups.set(key, overflow);

    if (expandedGroups.has(key)) {
      for (const thread of members) visibleIds.add(thread.id);
      continue;
    }

    for (const thread of ranked.slice(0, limit)) visibleIds.add(thread.id);
    for (const thread of members) {
      if (
        thread.isPinned ||
        thread.id === activeThreadId ||
        hasAttention(thread)
      ) {
        visibleIds.add(thread.id);
      }
    }
  }

  for (const id of [...visibleIds]) {
    let current = byId.get(id);
    while (current?.parentThreadId) {
      visibleIds.add(current.parentThreadId);
      current = byId.get(current.parentThreadId);
    }
  }

  let grew = true;
  while (grew) {
    grew = false;
    for (const thread of threads) {
      if (visibleIds.has(thread.id) || !thread.parentThreadId) continue;
      if (
        visibleIds.has(thread.parentThreadId) &&
        threadGroup.get(thread.id) === threadGroup.get(thread.parentThreadId)
      ) {
        visibleIds.add(thread.id);
        grew = true;
      }
    }
  }

  return { visibleIds, expandableGroups, threadGroup };
}
