/** Coarse phones / iOS WKWebView — never animate or thrash the sidebar DOM. */
export function isIosLike(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

/**
 * Call `fn` after the sidebar scroll container is idle.
 * While scrolling, updates are deferred so iOS doesn't flicker.
 *
 * Deferred work is keyed, and every key gets its own slot. A single shared
 * slot loses work: this gate has two independent callers (the row stylesheet
 * and the expand-button sync), so whichever deferred second used to overwrite
 * the first and that first update simply never ran — rows moved without their
 * chevron, or the chevron flipped without its rows. Keying by caller means a
 * repeat from the *same* caller still collapses to its latest state (which is
 * the point of deferring) while different callers no longer evict each other.
 */
export function createScrollIdleGate(options: {
  getScrollTarget: () => HTMLElement | null;
  idleMs?: number;
}): {
  run: (key: string, fn: () => void) => void;
  dispose: () => void;
  get scrolling(): boolean;
} {
  const idleMs = options.idleMs ?? 180;
  let scrolling = false;
  let idleTimer = 0;
  /** Insertion-ordered: callers flush in the order they first deferred. */
  const pending = new Map<string, () => void>();
  let scrollTarget: HTMLElement | null = null;

  const flush = () => {
    scrolling = false;
    const queued = [...pending.values()];
    pending.clear();
    for (const fn of queued) fn();
  };

  const onScroll = () => {
    scrolling = true;
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(flush, idleMs);
  };

  const bind = () => {
    const next = options.getScrollTarget();
    if (next === scrollTarget) return;
    if (scrollTarget) {
      scrollTarget.removeEventListener("scroll", onScroll);
    }
    scrollTarget = next;
    scrollTarget?.addEventListener("scroll", onScroll, { passive: true });
  };

  return {
    get scrolling() {
      return scrolling;
    },
    run(key, fn) {
      bind();
      if (scrolling) {
        pending.set(key, fn);
        return;
      }
      pending.delete(key);
      fn();
    },
    dispose() {
      window.clearTimeout(idleTimer);
      pending.clear();
      if (scrollTarget) {
        scrollTarget.removeEventListener("scroll", onScroll);
        scrollTarget = null;
      }
    },
  };
}
