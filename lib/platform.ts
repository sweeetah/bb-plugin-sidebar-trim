/** Coarse phones / iOS WKWebView — never animate or thrash the sidebar DOM. */
export function isIosLike(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

/**
 * Call `fn` after the sidebar scroll container is idle.
 * While scrolling, updates are deferred so iOS doesn't flicker.
 */
export function createScrollIdleGate(options: {
  getScrollTarget: () => HTMLElement | null;
  idleMs?: number;
}): {
  run: (fn: () => void) => void;
  dispose: () => void;
  get scrolling(): boolean;
} {
  const idleMs = options.idleMs ?? 180;
  let scrolling = false;
  let idleTimer = 0;
  let pending: (() => void) | null = null;
  let scrollTarget: HTMLElement | null = null;

  const flush = () => {
    scrolling = false;
    const fn = pending;
    pending = null;
    fn?.();
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
    run(fn) {
      bind();
      if (scrolling) {
        pending = fn;
        return;
      }
      pending = null;
      fn();
    },
    dispose() {
      window.clearTimeout(idleTimer);
      pending = null;
      if (scrollTarget) {
        scrollTarget.removeEventListener("scroll", onScroll);
        scrollTarget = null;
      }
    },
  };
}
