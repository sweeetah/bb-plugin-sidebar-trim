export const THREAD_ANCHOR =
  "[data-sidebar-thread-shortcut-target][data-sidebar-thread-id]";
export const PROJECT_ITEM = "[data-sidebar-project-id]";
export const THREADS_SECTION = '[data-sidebar-section-id="threads"]';
export const TRAILING = "[data-sidebar-trailing-controls]";
export const HOVER_ROW = ".bb-sidebar-hover-actions-row";
export const SECTION_GROUP = ".group\\/sidebar-section";
export const HOVER_ACTIONS = ".bb-sidebar-hover-actions";
export const BUTTON_ATTR = "data-sidebar-trim-expand";

export function findSidebarRoot(): HTMLElement | null {
  const sample =
    document.querySelector(PROJECT_ITEM) ??
    document.querySelector(THREADS_SECTION) ??
    document.querySelector(THREAD_ANCHOR);
  if (sample instanceof HTMLElement) {
    return (
      sample.closest<HTMLElement>('[data-sidebar="sidebar"]') ??
      sample.closest("aside") ??
      document.body
    );
  }
  return (
    (document.querySelector('[data-sidebar="sidebar"]') as HTMLElement | null) ??
    document.body
  );
}

/**
 * Thread ids whose row is on screen right now — in the DOM *and* taller than
 * zero.
 *
 * Both halves matter, and they are two different absences. A trimmed row that
 * BB has realized sits in the DOM at `max-height: 0`; a trimmed row it has not
 * realized is a `display:none` placeholder with no row at all. Neither is
 * drawn, and the caller (the mount entrance in lib/stylesheet.ts) has to treat
 * them alike: "not drawn yet" is the whole question it is asking.
 *
 * Measured with the fix in place: tapping one project chevron drew 9 rows the
 * plugin had been hiding *and* 3 rows of the same group that the plugin was not
 * hiding at all — rows BB's virtualizer had simply never built, sitting on
 * screen as blank reserved space. Asking "which rows of this group were
 * hidden" would have animated 9 and popped 3, in one block, in view. Asking
 * "which rows of this group are not drawn" gets all 12.
 *
 * One forced layout per expand, on the ~25 anchors the virtualizer keeps in the
 * DOM. It runs on a deliberate tap, in the same task that is already rewriting
 * two stylesheets.
 */
export function paintedThreadIds(root: ParentNode): Set<string> {
  const painted = new Set<string>();
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>("[data-sidebar-thread-id]"),
  )) {
    const id = el.getAttribute("data-sidebar-thread-id");
    if (!id) continue;
    const row = el.closest<HTMLElement>(HOVER_ROW) ?? el;
    if (row.getBoundingClientRect().height > 0.5) painted.add(id);
  }
  return painted;
}

export function findSidebarScrollTarget(root: HTMLElement): HTMLElement {
  return (
    root.querySelector<HTMLElement>('[data-sidebar="content"]') ?? root
  );
}

/**
 * Prefer BB's own `.bb-sidebar-hover-actions` cluster (Display options) so the
 * button fades in/out on row hover — including project rows where the outer
 * trailing wrapper stays always-visible.
 */
export function findActionsHost(scope: HTMLElement): HTMLElement | null {
  const trailing = scope.querySelector<HTMLElement>(TRAILING);
  const searchRoot = trailing ?? scope;

  const displayHover = Array.from(
    searchRoot.querySelectorAll<HTMLElement>(HOVER_ACTIONS),
  ).find((el) => el.querySelector('[aria-label="Sidebar display options"]'));
  if (displayHover) return displayHover;

  const anyHover = Array.from(
    searchRoot.querySelectorAll<HTMLElement>(HOVER_ACTIONS),
  ).find((el) =>
    el.querySelector(
      '[aria-label^="New thread"], [aria-label="Worktree actions"]',
    ),
  );
  if (anyHover) return anyHover;

  if (!trailing) return null;

  for (const child of Array.from(trailing.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (
      child.querySelector(
        '[aria-label="Sidebar display options"], [aria-label^="New thread"]',
      )
    ) {
      return child;
    }
  }

  return trailing.lastElementChild instanceof HTMLElement
    ? trailing.lastElementChild
    : trailing;
}

/**
 * Threads / Pinned sections often omit data-sidebar-section-id (BB strips `id`
 * before f4). Fall back to the Expand/Collapse "Threads section" control.
 */
export function findThreadsScopes(root: HTMLElement): HTMLElement[] {
  const found: HTMLElement[] = [];
  const seen = new Set<HTMLElement>();

  const add = (scope: HTMLElement | null) => {
    if (!scope || seen.has(scope)) return;
    if (scope.closest(PROJECT_ITEM)) return;
    seen.add(scope);
    found.push(scope);
  };

  for (const el of Array.from(root.querySelectorAll(THREADS_SECTION))) {
    if (el instanceof HTMLElement) add(el);
  }

  for (const el of Array.from(
    root.querySelectorAll(
      '[aria-label="Expand Threads section"], [aria-label="Collapse Threads section"]',
    ),
  )) {
    if (!(el instanceof Element)) continue;
    const scope =
      el.closest<HTMLElement>(THREADS_SECTION) ??
      el.closest<HTMLElement>(SECTION_GROUP) ??
      el.closest<HTMLElement>(HOVER_ROW)?.parentElement ??
      null;
    add(scope);
  }

  for (const label of Array.from(
    root.querySelectorAll('span[title="Threads"]'),
  )) {
    if (!(label instanceof HTMLElement)) continue;
    const header = label.closest<HTMLElement>(HOVER_ROW);
    if (!header?.querySelector('[aria-label="Sidebar display options"]')) {
      continue;
    }
    add(header.parentElement);
  }

  return found;
}
