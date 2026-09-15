import type { TrimGroupKey } from "./trim";

const EXPANDED_STORAGE_KEY = "bb-plugin-sidebar-trim:expanded";

type ExpandedMap = Record<string, true>;

export function readExpanded(): Set<TrimGroupKey> {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as ExpandedMap;
    return new Set(
      Object.keys(parsed).filter((key): key is TrimGroupKey => {
        return key === "threads" || key.startsWith("project:");
      }),
    );
  } catch {
    return new Set();
  }
}

export function writeExpanded(expanded: Set<TrimGroupKey>): void {
  const payload: ExpandedMap = {};
  for (const key of expanded) payload[key] = true;
  localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(payload));
}
