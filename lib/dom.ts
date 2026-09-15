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
