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

/**
 * ---------------------------------------------------------------------------
 * What the limit counts (measured in BB 0.43.3, not assumed)
 * ---------------------------------------------------------------------------
 * A sidebar group is a forest, not a list. BB renders one row per *top-level*
 * thread and tucks that thread's replies underneath it as an indented subtree,
 * so "show 24" can only sensibly mean 24 top-level rows with their children
 * along for the ride. Ranking every node flat and slicing 24 off the top means
 * a single chatty parent with seven replies can spend eight of the user's
 * twenty-four slots on one visual row — the number in Settings then describes
 * nothing the user can count on screen.
 *
 * Measured on the live sidebar before this change: the personal "Threads"
 * group had 182 members (159 top-level + 23 replies), the limit was 24, and
 * the collapsed group rendered **40** rows. The flat slice happened to pick 24
 * top-level threads here, and then the force-include pass (below) added 12
 * more and the descendant pass added 4 replies on top of that.
 *
 * So: rank ROOTS, slice ROOTS, and let each kept root bring its own subtree.
 * `limit` is now a promise about the row count, which is what the setting
 * claims to be.
 */

/**
 * ---------------------------------------------------------------------------
 * What still gets force-shown past the limit
 * ---------------------------------------------------------------------------
 * The guarantee is worth keeping: a thread that is *blocked on the user* or
 * *actively running work* must not be hidden just because it fell out of the
 * recency window, and neither must a pinned one or the thread the user is
 * currently reading. Losing those would be a real bug.
 *
 * What was NOT worth keeping is `isUnread || indicator !== "none"`. Measured
 * against the live sidebar, those two were the *entire* force-include
 * population — 12 of 12 threads, every one of them carrying nothing more
 * urgent than an `unread-success` dot. "Unread" in a 182-thread personal
 * section does not mean "important", it means "not reopened since it last
 * changed", and it grows without bound as the section grows. It is the reason
 * a group configured for 24 rendered 40.
 *
 * `indicator` is derived state, and each of its values is already covered:
 * `runtime` by the activity counters below, `unread-success` / `unread-error`
 * by `isUnread`. So dropping both is one decision, not two.
 *
 * Trade-off, stated out loud: an unread thread that has slipped past the limit
 * is now hidden until the group is expanded. It is not archived and the
 * chevron still reaches it. If that turns out to be the wrong call, widening
 * this predicate again is a one-line change — and it is the only place the
 * rule lives, because CompactTrimList now imports it instead of keeping its
 * own copy (they had drifted apart already).
 */
export function hasLiveAttention(thread: PluginSidebarThread): boolean {
  return (
    thread.hasPendingInteraction ||
    thread.activity.workflows > 0 ||
    thread.activity.backgroundAgents > 0 ||
    thread.activity.backgroundCommands > 0 ||
    thread.activity.planMode > 0 ||
    thread.activity.goals > 0
  );
}

export function sortKey(thread: PluginSidebarThread): number {
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

export interface GroupSelection {
  /** Every thread id that stays visible while the group is collapsed. */
  visibleIds: Set<string>;
  /** Top-level threads of this group, newest subtree first. */
  rankedRoots: PluginSidebarThread[];
  /** Top-level threads currently hidden — the number the chevron announces. */
  overflow: number;
}

/**
 * The one place a group's collapsed visibility is decided.
 *
 * Shared by the CSS overlay (`computeTrimDecision`) and by the React list in
 * components/CompactTrimList.tsx. They each used to carry their own copy of
 * the ranking, the attention predicate and the slice, which is exactly the
 * kind of duplication that lets two surfaces disagree about what "24" means.
 */
export function selectGroupVisibility(options: {
  members: readonly PluginSidebarThread[];
  limit: number;
  activeThreadId: string | null;
}): GroupSelection {
  const { members, limit, activeThreadId } = options;
  const byId = new Map(members.map((thread) => [thread.id, thread]));
  const childrenOf = new Map<string, PluginSidebarThread[]>();

  // A thread is a ROOT of this group when it has no parent, or when its parent
  // lives in some other group. The second case matters: BB renders such a
  // thread at the left edge of *this* section, so for layout purposes it is a
  // top-level row even though the data says it has a parent somewhere.
  const roots: PluginSidebarThread[] = [];
  for (const thread of members) {
    const parentId = thread.parentThreadId;
    if (parentId && byId.has(parentId)) {
      const list = childrenOf.get(parentId);
      if (list) list.push(thread);
      else childrenOf.set(parentId, [thread]);
    } else {
      roots.push(thread);
    }
  }

  /**
   * Walk a root's subtree once, iteratively. Recursion is avoided on purpose:
   * `parentThreadId` is server data and a cycle in it would be a stack
   * overflow that takes the whole sidebar down, so the `seen` set is a
   * guardrail, not decoration.
   */
  const subtreeOf = (root: PluginSidebarThread): PluginSidebarThread[] => {
    const out: PluginSidebarThread[] = [];
    const seen = new Set<string>();
    const stack = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (!node || seen.has(node.id)) continue;
      seen.add(node.id);
      out.push(node);
      const kids = childrenOf.get(node.id);
      if (kids) for (const kid of kids) stack.push(kid);
    }
    return out;
  };

  // Rank a root by the freshest thing anywhere in its subtree. A parent whose
  // own record is a month old but whose newest reply landed a minute ago is,
  // to the user, a thread from a minute ago — that is the row they are looking
  // for, and sorting it by the parent's own timestamp buries it.
  const subtrees = new Map<string, PluginSidebarThread[]>();
  const rankKey = new Map<string, number>();
  for (const root of roots) {
    const subtree = subtreeOf(root);
    subtrees.set(root.id, subtree);
    let best = Number.NEGATIVE_INFINITY;
    for (const node of subtree) best = Math.max(best, sortKey(node));
    rankKey.set(root.id, best);
  }

  const rankedRoots = [...roots].sort(
    (a, b) => (rankKey.get(b.id) ?? 0) - (rankKey.get(a.id) ?? 0),
  );

  const keptRoots = new Set<string>();
  for (const root of rankedRoots.slice(0, limit)) keptRoots.add(root.id);

  // Force-include works on the ROOT of the thread that earned it, never on the
  // thread alone. Showing a reply whose parent is hidden is how you get an
  // indented row floating under nothing, with a stray guide hairline beside it
  // — one of the glitches this pass is fixing, so re-creating it here would be
  // a poor trade.
  const rootOf = new Map<string, string>();
  for (const root of roots) {
    for (const node of subtrees.get(root.id) ?? []) rootOf.set(node.id, root.id);
  }
  for (const thread of members) {
    if (
      thread.isPinned ||
      thread.id === activeThreadId ||
      hasLiveAttention(thread)
    ) {
      const root = rootOf.get(thread.id);
      if (root) keptRoots.add(root);
    }
  }

  // A kept root brings its whole subtree; that is the "with their nested
  // children shown beneath them" half of the promise, and it is also what
  // keeps indentation coherent without a separate ancestor/descendant repair
  // pass (the old code needed two, and they were what inflated the count).
  const visibleIds = new Set<string>();
  for (const rootId of keptRoots) {
    for (const node of subtrees.get(rootId) ?? []) visibleIds.add(node.id);
  }

  // Overflow is counted in the same unit as the limit — hidden *top-level*
  // rows — so the chevron's "Show N older threads" and the "show 24" setting
  // finally describe the same thing.
  return {
    visibleIds,
    rankedRoots,
    overflow: Math.max(0, roots.length - keptRoots.size),
  };
}

/**
 * Decide which threads stay visible when groups are collapsed.
 * Keeps `limit` top-level threads per group with their replies, plus pinned
 * threads, the active thread and anything live (see `hasLiveAttention`).
 */
export function computeTrimDecision(options: {
  threads: readonly PluginSidebarThread[];
  projects: readonly PluginSidebarProject[];
  activeThreadId: string | null;
  expandedGroups: ReadonlySet<TrimGroupKey>;
  limits: TrimLimits;
}): TrimDecision {
  const { threads, projects, activeThreadId, expandedGroups, limits } = options;
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
    const selection = selectGroupVisibility({
      members,
      limit,
      activeThreadId,
    });

    // The chevron's presence is decided by the collapsed overflow even while
    // the group is expanded — otherwise expanding a group would delete the
    // control that collapses it again.
    if (selection.overflow > 0) expandableGroups.set(key, selection.overflow);

    if (expandedGroups.has(key)) {
      for (const thread of members) visibleIds.add(thread.id);
      continue;
    }
    for (const id of selection.visibleIds) visibleIds.add(id);
  }

  return { visibleIds, expandableGroups, threadGroup };
}
