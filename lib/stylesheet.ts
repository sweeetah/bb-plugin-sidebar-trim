import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { HOVER_ROW } from "./dom";
import { motion, prefersReducedMotion, staggerMs } from "./motion";
import type { TrimDecision } from "./trim";

/**
 * Two stylesheets, deliberately.
 *
 * The chevron's own `transition: transform` used to live in the same <style>
 * tag as the per-row rules, whose `textContent` is rewritten on every toggle.
 * Replacing a style element's text drops its CSSOM sheet and reparses it, so
 * the rule the arrow was mid-rotation on was torn out from under it and the
 * rotation snapped — intermittently, depending on whether the rewrite landed
 * in the same frame as the click. Splitting them means row churn can never
 * disturb the chevron: the static sheet is written once and then left alone.
 */
const STATIC_STYLE_ID = "bb-plugin-sidebar-trim-style";
const ROWS_STYLE_ID = "bb-plugin-sidebar-trim-rows";
const BUTTON_ATTR = "data-sidebar-trim-expand";

/**
 * BB core sets a fixed row height via this custom property (theme.css:
 * `--bb-sidebar-row-height: 1.75rem`). Reusing it as our max-height cap means
 * the reveal/collapse transition always matches the real row height exactly —
 * no guessing, no clipping, tracks theme changes for free.
 */
const ROW_HEIGHT_VAR = "var(--bb-sidebar-row-height, 1.75rem)";

function staticCss(): string {
  const reduced = prefersReducedMotion();
  // Trim's own chevron is the one arrow in the column that opens something
  // which actually animates, so it is the one that gets the overshoot. See the
  // family note in lib/motion.ts.
  const chevronTransition = reduced
    ? "transition: none;"
    : `transition: transform ${motion.duration.chevronTrim}ms ${motion.ease.bounce};`;
  // BB's two native chevrons. Their content unmounts, so we cannot accordion
  // it from a plugin — we only own the rotate, and we give it a crisp arrival
  // with no overshoot because there is nothing underneath it to settle.
  //
  // BB labels the two differently: top-level sections read "Expand <name>
  // section", while a project's own thread toggle reads "Expand <n> threads".
  // Matching only the former left the project arrows on a different cadence
  // from their section siblings — two cadences in one column, which reads as
  // "sometimes it animates properly".
  //
  // Under reduced motion this must emit `transition:none!important` rather
  // than nothing at all: dropping the rule leaves BB's own
  // `transition-transform duration-150` class in force, so the arrows would
  // keep animating for exactly the users who asked them not to.
  const nativeChevron = `
    button[aria-label$=" section"][aria-label^="Expand "] svg,
    button[aria-label$=" section"][aria-label^="Collapse "] svg,
    button[aria-label$=" threads"][aria-label^="Expand "] svg,
    button[aria-label$=" threads"][aria-label^="Collapse "] svg {
      transition: ${
        reduced
          ? "none"
          : `transform ${motion.duration.chevronNative}ms ${motion.ease.chevron}`
      } !important;
    }`;
  return `
    button[${BUTTON_ATTR}] {
      position: relative;
      z-index: 30;
      display: inline-flex;
      height: 1.75rem;
      width: 1.75rem;
      flex-shrink: 0;
      align-items: center;
      justify-content: center;
      border-radius: 0.375rem;
      border: 0;
      padding: 0;
      margin: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
    }
    button[${BUTTON_ATTR}]:hover {
      background: color-mix(in oklab, CanvasText 12%, transparent);
    }
    button[${BUTTON_ATTR}] svg {
      width: 1rem;
      height: 1rem;
      transform: rotate(0deg);
      ${chevronTransition}
    }
    button[${BUTTON_ATTR}][data-open="true"] svg {
      transform: rotate(90deg);
    }
    ${nativeChevron}
  `;
}

/** Thread ids that should be CSS-hidden (never touch their DOM nodes). */
export function hiddenIdsFromDecision(
  threads: readonly PluginSidebarThread[],
  decision: TrimDecision,
  activeThreadId: string | null,
): Set<string> {
  const hidden = new Set<string>();
  for (const thread of threads) {
    if (thread.isArchived) continue;
    if (thread.id === activeThreadId) continue;
    if (decision.visibleIds.has(thread.id)) continue;
    hidden.add(thread.id);
  }
  return hidden;
}

/**
 * Every thread id that belongs to a group with overflow — i.e. every row that
 * could plausibly move between hidden and visible as the group's chevron is
 * toggled (or as new threads bump older ones past the limit). Rows outside
 * this set (groups with no overflow) never get transition CSS at all, so the
 * blast radius of "always-on overflow:hidden" stays scoped to rows that
 * actually participate in trimming.
 */
export function managedIdsFromDecision(
  threads: readonly PluginSidebarThread[],
  decision: TrimDecision,
): Set<string> {
  const managed = new Set<string>();
  for (const thread of threads) {
    if (thread.isArchived) continue;
    const group = decision.threadGroup.get(thread.id);
    if (group && decision.expandableGroups.has(group)) managed.add(thread.id);
  }
  return managed;
}

/**
 * One rule per managed row. Reduced motion snaps instead of animating (state
 * changes are preserved, the animation isn't) — `display:none` on desktop,
 * zero height on compact. Otherwise every managed row stays a transition-ready
 * `overflow:hidden` box at all times, and only the max-height/opacity/transform
 * *targets* differ between the hidden and visible variants — that's what lets
 * a later toggle (regenerating this same rule with the other variant) animate:
 * CSS transitions fire on the value change between the row's previous
 * committed style and this new one, not on whether the rule text is "the
 * same rule" from one call to the next.
 */
/**
 * `transition` is one list, not additive: this rule wins the cascade on the row
 * (`.bb-sidebar-hover-actions-row:has(...)` outranks a bare class), so whatever
 * it declares is the row's *complete* transitioned set. Without the interaction
 * properties appended, the iCandy motion plugin's hover lift — which animates
 * `scale` / `translate` / `filter` — applied instantly and every managed row
 * snapped on hover while unmanaged rows rose smoothly.
 *
 * The fallback is load-bearing: with iCandy disabled the custom property is
 * undefined, and a bare `var()` would invalidate this whole declaration at
 * computed-value time, taking the collapse/reveal animation down with it.
 */
const ICANDY_INTERACTION_TRANSITION =
  "var(--icandy-interaction-transition," +
  "scale 380ms ease,translate 300ms ease,filter 300ms ease)";

/**
 * Stagger index without any extra plumbing.
 *
 * The cascade has to be per *group* — a global index would hand the fifth
 * project's rows a delay earned by the first four. But these rules are
 * generated from a flat id list, one rule per thread, with no group key in
 * hand, and the constraint is that a stagger stays cheap and expressible as a
 * per-rule `transition-delay`.
 *
 * `managedIdsFromDecision` walks threads in sidebar order, and a group's rows
 * are contiguous there, with its hidden (older) rows contiguous at the end of
 * it. So resetting the counter every time the hidden/visible flag flips lands
 * the boundaries exactly on the overflow blocks, for free. Two adjacent
 * fully-collapsed groups can merge into one run; the cap makes that a
 * non-event (their delays differ by single-digit ms out at that index).
 */
function nextStaggerIndex(
  hidden: boolean,
  state: { lastHidden: boolean | null; index: number },
): number {
  if (state.lastHidden !== hidden) {
    state.lastHidden = hidden;
    state.index = 0;
  } else {
    state.index += 1;
  }
  return state.index;
}

/**
 * ---------------------------------------------------------------------------
 * Where the blank space actually lives (measured in BB 0.43.3, not assumed)
 * ---------------------------------------------------------------------------
 * An earlier attempt put `margin-block-end:0` on the row itself, reasoning
 * that BB's `space-y-*` row rhythm survives on a `max-height:0` row. Measured
 * against the running app, that was a pure no-op: EVERY
 * `.bb-sidebar-hover-actions-row` computes to `margin-block-end: 0px`, managed
 * or not, so the rule set 0 to 0 — and the helper that measured "BB's row
 * rhythm" off a row always returned 0 for the same reason. The collapsed rows
 * were already measuring 0px tall. The space was never theirs.
 *
 * BB 0.43.3 renders a thread node like this (verified in the live DOM and in
 * the compiled bundle):
 *
 *   div.relative.space-y-0.5              <- the list. `space-y-*` compiles to
 *     div                                    a margin on every child but the
 *       div.space-y-0.5                      last, so the rhythm lands HERE,
 *         div.bb-sidebar-hover-actions-row   on the unclassed node wrapper —
 *           a[data-sidebar-thread-id]        two levels above the row.
 *         div.relative.space-y-px         <- nested child rows live here
 *           span.w-px.bg-border-hairline  <- the indent guide: `absolute` with
 *           div  ...child node...            inset-block:0, so its height IS
 *                                            its container's height
 *
 * So a hidden row collapses to 0px exactly as designed, and then its wrapper
 * hands the layout 2px of row rhythm anyway. Ten hidden threads is 20px of
 * blank space before the next project header, and the amount changes with how
 * many threads each project happens to be hiding — which is precisely the
 * "large, inconsistent, varies per project" gap that was reported.
 *
 * The same 2px is the stray hairline, too. A nested container whose children
 * are all hidden is still (hidden children x 1px) tall, and the guide span
 * stretches to its container, so a 4-5px fragment of indent line floats in
 * what looks like empty space. Zero the wrappers and the container measures
 * 0px, which takes the guide with it. One mechanism, both symptoms.
 *
 * Two elements per hidden row have to give up their margin, not one:
 *
 *  1. the hidden row's own node wrapper, and
 *  2. the sibling immediately before it — because that trailing margin is only
 *     "space between rows" while something still follows. In an untrimmed list
 *     the last row is `:last-child` and gets no margin at all, so without (2) a
 *     trimmed group stays exactly one row-rhythm taller than an untrimmed one.
 *
 * One addendum, measured after the windowed-placeholder fix landed: a row that
 * has replies is NOT the only child of its `space-y-0.5` wrapper — the nested
 * child list is its sibling — so `space-y-*` puts 2px on the ROW itself, which
 * the two wrapper selectors below cannot reach. A collapsed parent therefore
 * measured 2px instead of 0. The row's own `margin-block-end` now rides the
 * same clock as its `max-height`, and the reveal declares the transition
 * without a value so BB's number returns by itself.
 *
 * Note on the selector shape: `:has()` may not be nested inside `:has()` — it
 * is a parse error, not a silent miss — so these reach for the anchor directly
 * instead of wrapping the row selector. BB renders `a[data-sidebar-thread-id]`
 * as a direct child of the row (checked: 161/161 anchors on screen), which is
 * what makes the flat form possible.
 */
/**
 * ---------------------------------------------------------------------------
 * The "Threads" section is windowed; the projects are not (measured, 0.43.3)
 * ---------------------------------------------------------------------------
 * Every project list renders its rows outright. The personal "Threads" section
 * does not: BB wraps each top-level thread — and each reply under an expanded
 * parent — in a placeholder
 *
 *   <div data-sidebar-windowed-item
 *        data-sidebar-windowed-nav="thr_xxxxxxxxxx:proj_personal">
 *
 * and only fills it with a real row when it comes near the viewport. Measured
 * in the live sidebar: 159 placeholders at the top level, of which 37 held a
 * real row and 122 were empty boxes carrying an explicit height (28px at the
 * top level, 30px for a reply) so the scrollbar stays honest.
 *
 * That explicit height is the entire bug at the tail of a collapsed Threads
 * list. The plugin hides a *row*, but before materialisation there is no row —
 * only the placeholder, still reserving its 28px. 87 hidden-but-unmaterialised
 * placeholders were measured below the visible block: ~2.6k px of blank
 * sidebar that shrinks, a few rows at a time, as you scroll into it, which is
 * what makes the end of the list jump around under the cursor. The same
 * reservation kept a 184px indent hairline hanging beside six collapsed
 * replies whose rows had never been built.
 *
 * The placeholder is reachable *without* materialisation, which is the whole
 * point: `data-sidebar-windowed-nav` is `"<threadId>:<projectId>"`, so a
 * prefix match on `"<threadId>:"` is exact (a thread id cannot contain a
 * colon) and needs no `:has()`. Note the attribute is dropped once BB swaps a
 * real row in, so these rules and the row rules above never fight over the
 * same element — they are two halves of one hidden thread's footprint.
 *
 * These snap rather than animate, on every path. An empty off-screen box has
 * nothing to show while it moves, and animating a box the virtualiser is
 * actively measuring only invites it to re-measure mid-transition.
 */
const WINDOWED_NAV_ATTR = "data-sidebar-windowed-nav";

/** Escape for use inside a double-quoted CSS attribute-selector string. */
function cssString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function windowedPlaceholderRule(hiddenIds: readonly string[]): string {
  if (hiddenIds.length === 0) return "";
  const selector = hiddenIds
    .map((id) => `[${WINDOWED_NAV_ATTR}^="${cssString(id)}:"]`)
    .join(",");
  // One rule, many selectors — deliberately not one rule per id. The sheet is
  // rewritten on every toggle and already carries two rules per managed row;
  // adding a third would have taken it from 452 lines to 622 for no benefit,
  // since every placeholder wants the identical declaration block.
  return (
    `${selector}{height:0;min-height:0;max-height:0;` +
    `margin-block-end:0;overflow:hidden;opacity:0;pointer-events:none}`
  );
}

function wrapperSelectors(escapedId: string): {
  own: string;
  ownAndPrevious: string;
} {
  const path = `* > ${HOVER_ROW} > [data-sidebar-thread-id="${escapedId}"]`;
  // `:not([class*="space-y"])` is a guard, not decoration: if BB ever drops the
  // intermediate wrapper this selector would otherwise land on the list
  // container itself, and zeroing a *spacing* container's own margin would
  // collapse the 16px BB puts between sidebar sections.
  const own = `div:not([class*="space-y"]):has(> ${path})`;
  return { own, ownAndPrevious: `${own},div:has(+ div > ${path})` };
}

/**
 * ---------------------------------------------------------------------------
 * Why `min-height` is in the transition list (measured, not assumed)
 * ---------------------------------------------------------------------------
 * `max-height:0` does not win against a `min-height`. The cascade is not what
 * decides it — CSS resolves the used height by clamping to `max-height` and
 * *then* clamping to `min-height`, so min-height is simply last and wins, at
 * any specificity, with or without `!important`.
 *
 * BB gives the sticky tiers of the sidebar a floor: a row carrying
 * `data-sidebar-sticky-tier="parent"` computes to `min-height: 28px` so it
 * keeps its size while it is stuck under the section header. Measured on the
 * live sidebar, a hidden parent row reported `max-height: 0px`, `opacity: 0`,
 * `overflow: hidden` — and a bounding height of 28px. Its windowed item then
 * measured 30px (28 + the 2px of row rhythm on the wrapper). Four of those
 * were sitting in the collapsed Threads list: invisible, unclickable,
 * full-height holes in the middle of the trimmed run, which is exactly what a
 * gap that "shouldn't be there" looks like.
 *
 * Leaf rows never had the problem — they compute to `min-height: 0px` — which
 * is why this only ever showed up on threads that have replies.
 *
 * On the way back in, the collapse rule stops matching and BB's own 28px floor
 * returns. Declaring the transition on the reveal side without declaring a
 * value is the same trick the wrapper margin uses below: the property is
 * animatable in the after-change style, so 0 -> BB's number eases instead of
 * snapping, and the plugin never has to know what that number is.
 */
function buildRowRules(
  managedIds: Iterable<string>,
  hiddenIds: ReadonlySet<string>,
  compact: boolean,
): string {
  const parts: string[] = [];
  /** Ids whose windowed placeholder must give up its reserved height too. */
  const hiddenPlaceholders: string[] = [];
  const reduced = prefersReducedMotion();
  const managed = new Set(managedIds);
  const run: { lastHidden: boolean | null; index: number } = {
    lastHidden: null,
    index: 0,
  };
  for (const id of managed) {
    const escaped = CSS.escape(id);
    const selector = `${HOVER_ROW}:has([data-sidebar-thread-id="${escaped}"])`;
    const wrapper = wrapperSelectors(escaped);
    const hidden = hiddenIds.has(id);
    if (hidden) hiddenPlaceholders.push(id);
    const stagger = reduced
      ? 0
      : staggerMs(
          nextStaggerIndex(hidden, run),
          hidden ? motion.stagger.collapseCap : motion.stagger.revealCap,
          hidden
            ? motion.stagger.collapseFalloff
            : motion.stagger.revealFalloff,
        );
    if (reduced) {
      // Reduced motion snaps rather than animates. On desktop that is a plain
      // `display:none`. In the mobile drawer it is not: `display:none` on
      // windowed sidebar rows is exactly what blanked the list on iOS
      // WKWebView (see commit 0f3edb5), so compact collapses the row to zero
      // height instead and leaves it in the layout tree.
      if (!hidden) continue;
      parts.push(
        compact
          ? `${selector}{overflow:hidden;pointer-events:none;transition:none;` +
              `max-height:0;min-height:0;margin-block-end:0;opacity:0}`
          : `${selector}{display:none!important}`,
      );
      // The wrapper's rhythm has to go on this path too. `display:none` on the
      // row removes the row from layout, but the margin lives two levels above
      // it and is untouched — so without this, reduced motion keeps the exact
      // blank gaps (and the floating indent hairline) this fix is about.
      parts.push(`${wrapper.ownAndPrevious}{margin-block-end:0}`);
      continue;
    }
    // Delays ride inside each shorthand entry rather than in a separate
    // `transition-delay` list: ICANDY_INTERACTION_TRANSITION is a custom
    // property that expands to an unknown number of comma-separated entries,
    // so a positional delay list could not be kept aligned with it.
    const d = stagger > 0 ? ` ${stagger}ms` : "";
    if (hidden) {
      // Collapse: content leads, box follows (transform shorter than
      // max-height), opacity is gone first. Nothing overshoots on the way out
      // — an exit that bounces is an exit that argues.
      parts.push(
        `${selector}{overflow:hidden;pointer-events:none;` +
          `transition:max-height ${motion.duration.collapseMax}ms ${motion.ease.exit}${d},` +
          `min-height ${motion.duration.collapseMax}ms ${motion.ease.exit}${d},` +
          `margin-block-end ${motion.duration.collapseMax}ms ${motion.ease.exit}${d},` +
          `opacity ${motion.duration.collapseFade}ms ${motion.ease.exit}${d},` +
          `transform ${motion.duration.collapseShift}ms ${motion.ease.exit}${d},` +
          `${ICANDY_INTERACTION_TRANSITION};` +
          `max-height:0;min-height:0;margin-block-end:0;opacity:0;` +
          `transform:translateY(-${motion.distance.rowLift}px)}`,
      );
      // The wrapper margin rides the *box's* clock — same duration, ease and
      // stagger as the row's max-height, because the margin is the row's own
      // footprint just as much as its height is. Collapsing them together is
      // what lets the next project header ease up in one continuous move
      // instead of taking a 2px step the instant the rule lands.
      parts.push(
        `${wrapper.ownAndPrevious}{` +
          `transition:margin-block-end ${motion.duration.collapseMax}ms ${motion.ease.exit}${d};` +
          `margin-block-end:0}`,
      );
    } else {
      // Reveal: box leads, content settles a beat later (revealShift >
      // revealMax), opacity finishes earliest of the three. The 0.97 scale
      // that used to ride along is gone — on a 28px text row it was 0.8px of
      // vertical change nobody could see and 3% of horizontal type squeeze
      // everybody could, which read as a shimmer rather than as weight.
      parts.push(
        `${selector}{overflow:hidden;` +
          `transition:max-height ${motion.duration.revealMax}ms ${motion.ease.enter}${d},` +
          `min-height ${motion.duration.revealMax}ms ${motion.ease.enter}${d},` +
          `margin-block-end ${motion.duration.revealMax}ms ${motion.ease.enter}${d},` +
          `opacity ${motion.duration.revealFade}ms ${motion.ease.fade}${d},` +
          `transform ${motion.duration.revealShift}ms ${motion.ease.shift}${d},` +
          `${ICANDY_INTERACTION_TRANSITION};` +
          `max-height:${ROW_HEIGHT_VAR};opacity:1;` +
          `transform:translateY(0)}`,
      );
      // Deliberately declares a transition and NO margin value. That is the
      // whole trick: with no declaration the wrapper falls back to whatever
      // `space-y-*` BB is using for it — 2px in a project list, 1px in a
      // nested child list — so the plugin never has to know, hardcode or
      // measure that number, and a transition present in the after-change
      // style is enough for 0 -> BB's value to animate rather than snap.
      // (Only the wrapper's *own* selector is needed here: on the way back in
      // there are no hidden rows left in the group, so nothing is relying on a
      // previous sibling's margin being suppressed.)
      parts.push(
        `${wrapper.own}{` +
          `transition:margin-block-end ${motion.duration.revealMax}ms ${motion.ease.enter}${d}}`,
      );
    }
  }
  const placeholders = windowedPlaceholderRule(hiddenPlaceholders);
  if (placeholders) parts.push(placeholders);
  return parts.join("\n");
}

let lastHideKey = "";
let lastStaticKey = "";

export function ensureStyleTag(id: string): HTMLStyleElement {
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }
  return style;
}

/**
 * Written once and then left untouched while rows churn. Only a change in the
 * reduced-motion preference rewrites it, because that is the one input its
 * text depends on.
 */
export function applyStaticStylesheet(): void {
  const key = prefersReducedMotion() ? "reduced" : "full";
  if (key === lastStaticKey) return;
  lastStaticKey = key;
  ensureStyleTag(STATIC_STYLE_ID).textContent = staticCss();
}

export function applyHideStylesheet(
  managedIds: Set<string>,
  hiddenIds: Set<string>,
  compact: boolean,
): void {
  applyStaticStylesheet();
  const key = `${[...managedIds].sort().join("\0")}|${[...hiddenIds].sort().join("\0")}|${prefersReducedMotion() ? 1 : 0}|${compact ? 1 : 0}`;
  if (key === lastHideKey) return;
  lastHideKey = key;
  ensureStyleTag(ROWS_STYLE_ID).textContent = buildRowRules(
    managedIds,
    hiddenIds,
    compact,
  );
}

export function clearHideStylesheet(): void {
  lastHideKey = "";
  lastStaticKey = "";
  document.getElementById(ROWS_STYLE_ID)?.remove();
  document.getElementById(STATIC_STYLE_ID)?.remove();
}
