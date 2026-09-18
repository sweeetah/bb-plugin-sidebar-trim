// Motion tokens for Sidebar Trim's expand/collapse chevrons and the row
// reveal/hide they drive.
//
// Arrow ownership:
// - Arrow B ("show older threads", data-sidebar-trim-expand / compact Chevron)
//   is fully owned here — CSS max-height / grid accordion + chevron rotate.
// - Arrow A (BB native project/section collapse) unmounts children in
//   TopLevelSidebarSection when collapsed, so a plugin cannot accordion that
//   content without forking BB. Its chevron already uses BB's 150ms rotate;
//   we match that cadence on Arrow B so the two feel related.
//
// Deliberately CSS-only, no GSAP dependency. The sibling bb-plugin-page-transitions
// owns a GSAP "cinema" system (see cinema/tokens.ts there) for full page/sidebar
// choreography, which earns its complexity animating whole routes. This plugin's
// entire motion surface is two chevrons plus row visibility — CSS transitions
// cover that with fewer moving parts and, importantly, without a JS engine
// writing inline styles every frame on the mobile/iOS path this plugin has to
// stay gentle with (see lib/platform.ts). Eases below are chosen to echo the
// same "expo-ish enter, crisp exit" language as cinema/tokens.ts, translated to
// CSS cubic-beziers, so the two plugins read as one voice.
//
// BB's own chevron transition (`transition-transform duration-150`, see BB core
// SidebarChildToggleChevron.tsx / TopLevelSidebarSection.tsx) and its 150ms
// "quick control" convention (@bb/shared-ui/components/ui/motion.ts,
// CONTROL_HOVER_TRANSITION) are the other reference point: our own chevron
// (Arrow B) matches that cadence rather than inventing an unrelated one.

export const motion = {
  duration: {
    /** Arrow B's own chevron rotation — matches BB core's chevron cadence. */
    chevron: 150,
    /** Row max-height growth on expand. */
    revealMax: 240,
    /** Row opacity/transform on expand — finishes at/near the max-height beat. */
    revealFade: 170,
    /** Row max-height shrink on collapse — "Exit" family: faster than enter. */
    collapseMax: 160,
    /** Row opacity fade on collapse. */
    collapseFade: 120,
    /** Mobile-only: one-shot fade for a freshly mounted row or the list itself. */
    mobileEnter: 220,
  },
  ease: {
    /** Tailwind's default transition-timing-function — matches BB's own chevron. */
    chevron: "cubic-bezier(0.4, 0, 0.2, 1)",
    /** Expo-ish "crisp arrival" — matches page-transitions' cinema.ease.enter (expo.out). */
    enter: "cubic-bezier(0.16, 1, 0.3, 1)",
    /** Gentle back-out — the one place this plugin lets motion bounce (~5-6% overshoot). */
    bounce: "cubic-bezier(0.34, 1.4, 0.64, 1)",
    /** Restrained start, fast out, no lingering — matches cinema.ease.exit intent. */
    exit: "cubic-bezier(0.5, 0, 0.85, 0.9)",
    fade: "ease-out",
  },
  distance: {
    /** px — translateY on row enter/exit. */
    rowLift: 6,
  },
} as const;

/** Mirrors bb-plugin-page-transitions/cinema/dom.ts's prefersReducedMotion(). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
