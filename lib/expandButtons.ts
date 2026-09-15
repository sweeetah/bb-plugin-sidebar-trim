import type { TrimGroupKey } from "./trim";
import {
  BUTTON_ATTR,
  PROJECT_ITEM,
  findActionsHost,
  findThreadsScopes,
} from "./dom";

function chevronSvg(): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>`;
}

export function expandFingerprint(
  expandableGroups: Map<TrimGroupKey, number>,
  expandedGroups: ReadonlySet<TrimGroupKey>,
): string {
  const expandParts = [...expandableGroups.entries()]
    .map(([key, count]) => `${key}:${count}`)
    .sort();
  const openParts = [...expandedGroups].sort();
  return `${expandParts.join("|")}#${openParts.join("|")}`;
}

function upsertExpandButton(options: {
  scope: HTMLElement;
  key: TrimGroupKey;
  overflow: number;
  isExpanded: boolean;
  seen: Set<HTMLButtonElement>;
}): void {
  const { scope, key, overflow, isExpanded, seen } = options;
  const actions = findActionsHost(scope);

  if (overflow === 0 && !isExpanded) {
    for (const node of Array.from(
      scope.querySelectorAll(`button[${BUTTON_ATTR}]`),
    )) {
      node.remove();
    }
    return;
  }

  if (!actions) return;

  let button = actions.querySelector<HTMLButtonElement>(
    `button[${BUTTON_ATTR}]`,
  );
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.setAttribute(BUTTON_ATTR, "true");
    button.dataset.open = isExpanded ? "true" : "false";
    button.innerHTML = chevronSvg();
    actions.insertBefore(button, actions.firstChild);
  }

  const label = isExpanded
    ? key === "threads"
      ? "Show fewer threads"
      : "Show fewer project threads"
    : key === "threads"
      ? `Show ${overflow} older threads`
      : `Show ${overflow} older project threads`;

  if (button.dataset.groupKey !== key) button.dataset.groupKey = key;
  const openValue = isExpanded ? "true" : "false";
  if (button.dataset.open !== openValue) button.dataset.open = openValue;
  if (button.getAttribute("aria-label") !== label) {
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  if (!button.querySelector("svg")) button.innerHTML = chevronSvg();
  seen.add(button);
}

export function syncExpandButtons(options: {
  root: HTMLElement;
  expandableGroups: Map<TrimGroupKey, number>;
  expandedGroups: ReadonlySet<TrimGroupKey>;
}): void {
  const { root, expandableGroups, expandedGroups } = options;
  const seen = new Set<HTMLButtonElement>();

  for (const project of Array.from(root.querySelectorAll(PROJECT_ITEM))) {
    if (!(project instanceof HTMLElement)) continue;
    const projectId = project.getAttribute("data-sidebar-project-id");
    if (!projectId || projectId === "proj_personal") continue;
    const key = `project:${projectId}` as TrimGroupKey;
    upsertExpandButton({
      scope: project,
      key,
      overflow: expandableGroups.get(key) ?? 0,
      isExpanded: expandedGroups.has(key),
      seen,
    });
  }

  for (const section of findThreadsScopes(root)) {
    upsertExpandButton({
      scope: section,
      key: "threads",
      overflow: expandableGroups.get("threads") ?? 0,
      isExpanded: expandedGroups.has("threads"),
      seen,
    });
  }

  for (const stale of Array.from(
    root.querySelectorAll(`button[${BUTTON_ATTR}]`),
  )) {
    if (stale instanceof HTMLButtonElement && !seen.has(stale)) stale.remove();
  }
}

export function clearExpandButtons(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll(`button[${BUTTON_ATTR}]`))) {
    el.remove();
  }
}

/** One delegated click listener — avoids rebinding on every sync. */
export function mountExpandDelegation(
  root: HTMLElement,
  onToggle: (key: TrimGroupKey) => void,
): () => void {
  const onClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(`button[${BUTTON_ATTR}]`);
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    event.stopPropagation();
    const group = button.dataset.groupKey as TrimGroupKey | undefined;
    if (!group) return;
    const nextOpen = button.dataset.open !== "true";
    button.dataset.open = nextOpen ? "true" : "false";
    onToggle(group);
  };
  root.addEventListener("click", onClick);
  return () => root.removeEventListener("click", onClick);
}
