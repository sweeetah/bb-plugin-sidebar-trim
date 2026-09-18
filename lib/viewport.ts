import { useEffect, useState } from "react";

/** Matches BB `useIsCompactViewport` — mobile drawer, not pointer/heuristics. */
export const COMPACT_VIEWPORT_QUERY = "(max-width: 767px)";

/**
 * True when BB uses the compact/mobile sidebar drawer. Overlay CSS trim must
 * stay off here — BB already windowed-lists in the drawer and `display:none`
 * / max-height hides can blank the whole list (especially without coarse
 * pointer, e.g. some WKWebView builds).
 */
export function readCompactViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia(COMPACT_VIEWPORT_QUERY).matches;
}

/** True when the overlay must not inject desktop-only hide CSS. */
export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(readCompactViewport);
  useEffect(() => {
    const width = window.matchMedia(COMPACT_VIEWPORT_QUERY);
    const sync = () => {
      setCompact(width.matches);
    };
    sync();
    width.addEventListener("change", sync);
    return () => {
      width.removeEventListener("change", sync);
    };
  }, []);
  return compact;
}
