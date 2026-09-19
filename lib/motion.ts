// Motion tokens for Sidebar Trim's expand/collapse chevrons and the row
// reveal/hide they drive.
//
// Arrow ownership:
// - Arrow B ("show older threads", data-sidebar-trim-expand / compact Chevron)
//   is fully owned here — CSS max-height / opacity accordion + chevron rotate.
// - Arrow A (BB native section chevron, "Expand <name> section") and the
//   native per-project chevron ("Expand <n> threads") unmount their children
//   in TopLevelSidebarSection when collapsed, so a plugin cannot accordion
//   that content without forking BB. We only own their rotate.
//
// Deliberately CSS-only, no GSAP dependency. The sibling bb-plugin-page-transitions
// owns a GSAP "cinema" system (see cinema/tokens.ts there) for full page/sidebar
// choreography, which earns its complexity animating whole routes. This plugin's
// entire motion surface is three chevrons plus row visibility — CSS transitions
// cover that with fewer moving parts and, importantly, without a JS engine
// writing inline styles every frame on the mobile/iOS path this plugin has to
// stay gentle with (see lib/platform.ts). Eases below are chosen to echo the
// same "expo-ish enter, crisp exit" language as cinema/tokens.ts, translated to
// CSS cubic-beziers, so the two plugins read as one voice.
//
// BB's own chevron transition (`transition-transform duration-150`, see BB core
// SidebarChildToggleChevron.tsx / TopLevelSidebarSection.tsx) and its 150ms
// "quick control" convention (@bb/shared-ui/components/ui/motion.ts,
// CONTROL_HOVER_TRANSITION) are the reference point all three chevrons orbit.
//
// ---------------------------------------------------------------------------
// The one rule that makes the three chevrons a family instead of a pile
// ---------------------------------------------------------------------------
// Earlier this file gave the *native* chevrons the bouncy ease and left our own
// on Tailwind's default. That is backwards, and it is why the column read as
// "sometimes it animates properly": the arrow that overshot and settled was the
// one whose content vanishes instantly (BB unmounts the children — there is no
// settle for the arrow to be reacting to), while the arrow that actually drives
// a 230ms accordion arrived flat.
//
// So the family is defined by a shared cadence and split by what the arrow is
// telling the truth about:
//
//   overshoot == "something underneath me is going to settle"
//
// - Native chevrons: crisp arrival, no overshoot. Their payload pops into
//   existence, so the arrow lands and stops. Honest, and it is the quicker of
//   the two cadences because there is nothing to wait for.
// - Trim's own chevron: one small back-out overshoot (~4% of the 90° travel,
//   i.e. ~3.5° — small enough to be a settle, large enough to be seen on a 16px
//   glyph). It is the only overshoot anywhere in this plugin; per the "only one
//   property may use a visible spring" constraint, everything the arrow opens
//   is pure deceleration. The arrow is the character; the rows are the system.
//
// The two durations differ (140 vs 190) and that is deliberate, not drift: a
// back-out curve spends its last ~30% on the correction, so 190ms with the
// overshoot and 140ms without reach the 90° read at roughly the same moment.
// Matching the *numbers* would have made our arrow feel late.

/**
 * How many milliseconds of the reveal/collapse to withhold from the row at
 * `index` within its group's overflow block.
 *
 * Why a curve and not `index * step`: a general "Threads" section can reveal 20
 * rows at once. A linear stagger turns that into a half-second tail (and the
 * skill's own note: for large groups, compress the later delays rather than
 * extending the animation indefinitely). A clamped linear stagger is worse
 * still — every row past the clamp shares one delay and the group reads as a
 * slab again, which is the exact defect being fixed.
 *
 * The exponential keeps the first three rows clearly separated (0 / 27 / 47ms
 * on reveal) where the eye is actually looking, then asymptotes so row 20 is
 * only a few ms behind row 12 and the whole cascade is bounded by `cap`.
 * Deterministic, ~one Math.exp per generated rule.
 */
export function staggerMs(
  index: number,
  cap: number,
  falloff: number,
): number {
  if (index <= 0) return 0;
  return Math.round(cap * (1 - Math.exp(-index / falloff)));
}

export const motion = {
  duration: {
    /**
     * BB's native section + per-project chevrons. Crisp and slightly quicker
     * than ours because their content unmounts — nothing follows the arrow, so
     * it has no reason to linger. Kept near BB's own `duration-150` so the
     * override reads as a correction, not a takeover.
     */
    chevronNative: 140,
    /**
     * Trim's own chevron. Longer than the natives only to pay for the
     * overshoot tail (see the header note); the perceived arrival at 90° is
     * the same beat. Also lands *before* the rows finish (230ms + stagger), so
     * the arrow is the cause and the rows are the response, not a race.
     */
    chevronTrim: 190,
    /** Row slot opening (max-height). The "cause" the row content responds to. */
    revealMax: 230,
    /**
     * Row opacity on expand. Finishes well before the slot stops growing —
     * opacity is a support property, and a row that is still fading while it
     * has already stopped moving reads as lag rather than arrival.
     */
    revealFade: 150,
    /**
     * Row content translate on expand. Deliberately *longer* than revealMax:
     * the slot is the parent and the content is the child, so the content
     * settles a beat after the box has stopped. That ~30ms of overlap is the
     * only follow-through in the plugin and it is what stops a multi-row
     * reveal from looking like one rigid slab sliding out.
     */
    revealShift: 260,
    /** Row slot closing. Exit family: decisively faster than the enter. */
    collapseMax: 160,
    /** Row opacity on collapse — gone before the slot is, so nothing is
     *  caught visible at 2px of height. */
    collapseFade: 110,
    /**
     * Row content translate on collapse. Shorter than collapseMax (the inverse
     * of the reveal relationship): on the way out the content leads and the box
     * follows, which is what makes a collapse feel dismissed rather than
     * dragged.
     */
    collapseShift: 150,
    /** Mobile-only: one-shot fade for a freshly mounted row or the list itself. */
    mobileEnter: 220,
  },
  ease: {
    /**
     * Tailwind's default timing function, i.e. BB's own. Used for the native
     * chevrons: crisp arrival, zero overshoot, because their content pops.
     */
    chevron: "cubic-bezier(0.4, 0, 0.2, 1)",
    /** Expo-ish "crisp arrival" — matches page-transitions' cinema.ease.enter (expo.out). */
    enter: "cubic-bezier(0.16, 1, 0.3, 1)",
    /**
     * Gentle back-out, ~4% overshoot. The single bouncing thing in this
     * plugin, reserved for Trim's own chevron rotation. It was previously also
     * used on the row translate, where a 4% overshoot of a 6px travel is 0.24px
     * — theatre nobody can see, paid for in curve complexity. Removed there.
     */
    bounce: "cubic-bezier(0.34, 1.36, 0.64, 1)",
    /**
     * Balanced transform: short acceleration, clear travel, smooth arrival.
     * The row's translate uses this while its box uses `enter` (expo.out) —
     * the box is appearing, the content is merely repositioning inside a slot
     * it already occupies, and those are different actions. Reusing one curve
     * for both is what made a multi-row reveal move like a single rigid plate.
     */
    shift: "cubic-bezier(0.38, 0.06, 0.24, 1)",
    /** Restrained start, fast out, no lingering — matches cinema.ease.exit intent. */
    exit: "cubic-bezier(0.5, 0, 0.85, 0.9)",
    fade: "ease-out",
  },
  distance: {
    /** px — translateY on row enter/exit. */
    rowLift: 6,
    // There is deliberately no row-gap token here. A collapsed row's share of
    // BB's `space-y-*` rhythm lives on a wrapper two levels above the row (see
    // the long note in lib/stylesheet.ts), and the reveal restores it by
    // declaring a transition and *no* margin value — so BB's own number, which
    // differs between project lists (2px) and nested child lists (1px), is
    // never guessed, hardcoded or measured here. A short-lived
    // `rowGapFallback: 2` used to live here for a fix that measured the row
    // instead of the wrapper and therefore always read back 0px.
  },
  stagger: {
    /**
     * Reveal: the whole cascade is bounded at 96ms (~40% of one row's reveal),
     * so even a 20-row "Threads" expansion resolves by ~330ms. Falloff 3 puts
     * the perceptible separation in the first three or four rows.
     */
    revealCap: 96,
    revealFalloff: 3,
    /**
     * Collapse: a stagger on the way out is the one that turns sticky, so this
     * is a quarter of the reveal's. Worst case the last row is done at 200ms,
     * which is still inside the "instant" band — the cascade is there to keep
     * the group from snapping shut as one plate, not to be admired.
     */
    collapseCap: 40,
    collapseFalloff: 2.5,
  },
} as const;

/** Mirrors bb-plugin-page-transitions/cinema/dom.ts's prefersReducedMotion(). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
