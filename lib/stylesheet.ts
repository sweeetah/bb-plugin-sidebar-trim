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
/**
 * A third tag, for the same reason there is a second one — and then one more.
 *
 * The mount entrance (see `buildRowEntranceRule`) is a CSS animation, so unlike
 * every other rule this file emits it is *destroyed* by a re-parse: dropping a
 * style element's CSSOM sheet takes the running animation with it, exactly as
 * the chevron's rotate used to be torn out mid-flight. The rows sheet is
 * rewritten whenever the thread list changes, and a thread list that changes
 * while a group is revealing is not hypothetical — it is a reply landing in the
 * 500 ms after the tap. Giving the entrance its own tag means row churn cannot
 * cancel it half-open, and clearing the entrance cannot disturb the rows.
 */
const ENTER_STYLE_ID = "bb-plugin-sidebar-trim-enter";
const BUTTON_ATTR = "data-sidebar-trim-expand";
/**
 * Shared prefix for the three entrance keyframes, so the disarm watcher can
 * recognise our own animations among everything else the app runs without
 * listing them one by one.
 */
const ENTER_ANIM_PREFIX = "bb-trim-row-";

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
  // ---------------------------------------------------------------------------
  // The three clocks a freshly mounted row has to borrow
  // ---------------------------------------------------------------------------
  // These live in the STATIC sheet, which is written once and then left alone,
  // because removing an `@keyframes` rule cancels every animation currently
  // running from it. Keeping them here means the rows sheet and the entrance
  // sheet can both churn underneath a reveal without stopping it.
  //
  // Each keyframe declares only `from`. The missing `100%` is an *implicit*
  // keyframe, which resolves to the element's own computed value — so the box
  // opens to the real `--bb-sidebar-row-height` (28 px measured), the sticky
  // floor to BB's real `min-height`, and the margin to whatever `space-y-*` BB
  // happens to be using for that list (2 px in a project list, 1 px in a nested
  // child list). This is the same "declare the transition, never the value"
  // trick the reveal rules use below, and it is the reason the entrance needs
  // no measurement pass and cannot drift from BB's numbers.
  //
  // Three separate animations rather than one, because the reveal they are
  // standing in for is not one move: the box takes 230 ms on the expo-ish
  // `enter`, the ink is gone in 150 ms so it is finished before the box stops,
  // and the content takes 260 ms on the balanced `shift` so it settles a beat
  // *after* its own slot has come to rest. One animation could not hold three
  // durations and three curves, and flattening them to one is precisely what
  // makes a multi-row reveal read as a single rigid plate.
  //
  // `translateY(-6px)` is not a new value: it is the exact resting transform a
  // collapsed row is left at by the collapse rule, so a row that mounts already
  // open starts where a row that was merely hidden would have started. First
  // expand and second expand are then the same picture, which is the whole
  // point of this file's entrance.
  const rowEnterKeyframes = reduced
    ? ""
    : `
    @keyframes ${ENTER_ANIM_PREFIX}box {
      from { max-height: 0; min-height: 0; margin-block-end: 0; }
    }
    @keyframes ${ENTER_ANIM_PREFIX}ink {
      from { opacity: 0; }
    }
    @keyframes ${ENTER_ANIM_PREFIX}lift {
      from { transform: translateY(-${motion.distance.rowLift}px); }
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
    ${rowEnterKeyframes}
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
/**
 * ---------------------------------------------------------------------------
 * The compact (mobile) sheet — a different shape, for a measured reason
 * ---------------------------------------------------------------------------
 * The desktop sheet below emits one or two rules PER MANAGED ROW, each with a
 * full transition shorthand. Measured on this machine that is 206 KB and 662
 * `:has()` selectors — while BB's virtualizer keeps only ~13 thread anchors in
 * the DOM at a time. On a phone that combination froze the drawer for ~5 s.
 *
 * Two things make this variant cheap, both measured in iPhone WebKit:
 *
 * 1. ONE rule per concern, with a joined selector list, and only for HIDDEN
 *    ids. Visible rows need no rule at all once there is no reveal transition
 *    to declare. 206 KB -> ~20 KB. The `:has()` argument also gets a child
 *    combinator (`> [data-sidebar-thread-id]`), so matching is a direct-child
 *    check instead of a descendant search.
 *
 * 2. Placeholders are `display:none`, NOT `height:0`. This is the important
 *    one. BB windows the list with an IntersectionObserver over a 240px band.
 *    Zero-height placeholders still generate boxes, so ~150 of them stack at
 *    the same y and ALL intersect that band at once — the virtualizer gives up
 *    and realizes the lot. `display:none` generates no box, so a hidden row is
 *    never observed and never realized. Measured over an identical scroll:
 *
 *      placeholder rule   max realized   worst frame
 *      (none)                     56         31 ms
 *      height:0                   63         65 ms
 *      display:none               20         30 ms
 *
 *    Note this is `display:none` on the PLACEHOLDER, which has no content —
 *    not on a realized row, which is what blanked the list on iOS in 0f3edb5.
 *
 * Placeholders still snap rather than animate, on every path. An empty
 * off-screen box has nothing to show while it moves, and animating a box the
 * virtualiser is actively measuring only invites it to re-measure
 * mid-transition.
 *
 * ---------------------------------------------------------------------------
 * Getting motion back without paying for it a second time
 * ---------------------------------------------------------------------------
 * The three constraints above (one rule per concern, hidden-ids-only,
 * `display:none` placeholders) are unchanged and still explain why this
 * cannot look like `buildRowRules` with smaller numbers. An earlier version
 * of this function tried to keep "hidden-ids-only" literally true even for
 * the reveal side, by declaring the reveal transition ONCE, unconditionally,
 * on the bare `${HOVER_ROW}` class with no value overrides — relying on the
 * CSS Transitions spec's after-change-style rule (the same mechanism behind
 * `.btn{transition:200ms} .btn:hover{transition:80ms}`) to make a row pick up
 * that transition the instant it stopped matching the hidden selector.
 *
 * Frame-by-frame measurement (sampling `getComputedStyle().maxHeight` and
 * `getBoundingClientRect().height` on every animation frame, not just before/
 * after) showed that trick only half-worked: opacity and transform genuinely
 * ramped, but max-height did not move at all. The bare-class rule declared a
 * transition but no `max-height` value, so the reveal's after-change value
 * was the browser default, `none` — and `none` is not interpolable with an
 * explicit length like the hidden rule's `0`. The browser has nothing to
 * tween between, so it snaps, silently, with no console warning. Padding the
 * bare class with an explicit `max-height:${ROW_HEIGHT_VAR}` would fix the
 * interpolation but also apply `overflow:hidden` to every row in the
 * sidebar, managed or not — verified separately (measuring real hover-action
 * button boxes) that BB intentionally sizes that cluster a couple of px
 * taller than some rows for a larger touch target, so a global
 * `overflow:hidden` would clip it on rows this plugin never trims.
 *
 * The fix keeps the "one joined-selector rule, not one per row" budget but
 * gives up the "zero ids for reveal" idea: reveal gets its own rule, scoped
 * to the ids it actually applies to. Those ids are the CURRENTLY VISIBLE
 * managed ones (`managedIds` minus `hiddenIds`) — the few rows each
 * expandable group still shows above its trim line — mirroring the shape of
 * `buildRowRules`'s own reveal branch below (same explicit
 * `max-height:${ROW_HEIGHT_VAR}` target, same property list) but joined into
 * one rule instead of one per id. This set is bounded by the expand limits
 * (a handful of rows per expandable group), not by how many threads exist,
 * so it stays cheap regardless of sidebar size — see the byte/rule numbers
 * this function's header comment reports after each change.
 *
 * Stagger is the one desktop behaviour this shape does not attempt. Desktop's
 * `nextStaggerIndex` finds each group's row-0 by resetting its counter at
 * every hidden/visible boundary while walking ALL managed ids in sidebar
 * order — hidden and visible interleaved. This function only ever sees the
 * hidden ids, flattened across every group in the sidebar at once, with no
 * visible ids in between to mark where one group's overflow block ends and
 * the next begins. A bucketed delay computed from position in that flat list
 * would hand a group's first collapsing row whatever index it happens to
 * land on globally, not "0" — a fabricated stagger, not the real one.
 * Bringing the managed-id walk back in to fix that is exactly the shape
 * decided against for the placeholder rule above, for the same reason: it
 * turns a handful of joined-selector rules back into per-row bookkeeping.
 * And the payoff would be thin regardless, because the virtualizer already
 * limits how many rows are realized (and therefore paintable) near the
 * toggle boundary to a handful — most of a big group's rows are
 * `display:none` placeholders that skip animation entirely, per the note
 * above. A stagger is choreography for a crowd; there usually isn't one
 * here. Both directions move together instead — simpler, correct, and
 * consistent with this skill's own instruction to remove decoration that
 * doesn't have room to read as an idea.
 *
 * Reduced motion keeps every property change instant on both directions, as
 * before — see `prefersReducedMotion()`.
 */
function buildCompactRowRules(
  managedIds: Iterable<string>,
  hiddenIds: ReadonlySet<string>,
): string {
  const reduced = prefersReducedMotion();
  const parts: string[] = [];

  if (!reduced) {
    // Reveal, scoped to the ids it actually affects — see the header note
    // above for why the earlier zero-id bare-class version silently failed
    // to animate height. `visible` is bounded by each expandable group's
    // limit (a handful of rows), not by sidebar size, so joining it into one
    // rule stays cheap even when hiddenIds is in the hundreds.
    const visible = [...managedIds].filter((id) => !hiddenIds.has(id));
    if (visible.length > 0) {
      const revealSelector = visible
        .map((id) => `${HOVER_ROW}:has(> [data-sidebar-thread-id="${CSS.escape(id)}"])`)
        .join(",");
      parts.push(
        `${revealSelector}{overflow:hidden;` +
          // `!important` here is load-bearing, not decoration — see the
          // measured note above `collapseTransition` below for why: icandy
          // declares `transition-property`/`-duration`/`-timing-function` as
          // plain (non-important) longhands on `.bb-sidebar-hover-actions-row`
          // at specificity (0,4,0), which otherwise beats this rule's (0,2,0)
          // outright and silently drops max-height/min-height/margin-block-
          // end/transform from the element's transition list.
          `transition:max-height ${motion.duration.revealMax}ms ${motion.ease.enter},` +
          `min-height ${motion.duration.revealMax}ms ${motion.ease.enter},` +
          `margin-block-end ${motion.duration.revealMax}ms ${motion.ease.enter},` +
          `opacity ${motion.duration.revealFade}ms ${motion.ease.fade},` +
          `transform ${motion.duration.revealShift}ms ${motion.ease.shift},` +
          `${ICANDY_INTERACTION_TRANSITION}!important;` +
          `max-height:${ROW_HEIGHT_VAR};opacity:1;transform:translateY(0)}`,
      );
    }
  }

  const hidden = [...hiddenIds];
  if (hidden.length === 0) return parts.join("\n");

  const rowSelector = hidden
    .map((id) => `${HOVER_ROW}:has(> [data-sidebar-thread-id="${CSS.escape(id)}"])`)
    .join(",");
  // The wrapper carries BB's `space-y-*` rhythm; without this a collapsed row
  // still leaves its margin behind. Same `:not([class*="space-y"])` guard as
  // the desktop path — see wrapperSelectors. Deliberately no transition here
  // even though the rest of this function now animates: the value in play is
  // BB's 1-2px row-rhythm margin, which reads identically snapped or eased,
  // and giving it a reveal-side rule would need the same managed-id walk
  // this function avoids above, to save a difference nobody can see.
  const wrapperSelector = hidden
    .map(
      (id) =>
        `div:not([class*="space-y"]):has(> * > ${HOVER_ROW} > [data-sidebar-thread-id="${CSS.escape(id)}"])`,
    )
    .join(",");
  const placeholderSelector = hidden
    .map((id) => `[${WINDOWED_NAV_ATTR}^="${cssString(id)}:"]`)
    .join(",");
  // `!important` on both branches below for the same reason as the reveal
  // rule above: measured live in this workspace, icandy ships
  // `:root.icandy-active .bb-sidebar-hover-actions-row(.icandy-control)`
  // rules that set `transition-property`/`-duration`/`-timing-function` as
  // plain longhands at specificity (0,4,0) — higher than this rule's
  // `:has()` selector at (0,2,0) — and win the cascade for those properties
  // outright (longhands don't merge across rules; highest specificity takes
  // the whole list). Confirmed via `getComputedStyle(row).transitionProperty`
  // reporting icandy's own list (background-color, color, scale, translate,
  // opacity, filter) instead of this rule's, with max-height absent from it
  // — so max-height/min-height/margin-block-end/transform silently never
  // transitioned even though every value and selector here was correct.
  // opacity happened to appear on both lists, which is why it alone still
  // animated (on icandy's timing, not this rule's) and made the bug easy to
  // miss from opacity-only frame sampling. icandy's own reduced-motion
  // override uses the same `!important` pattern already, so this matches an
  // existing convention rather than introducing a new one.
  const collapseTransition = reduced
    ? "transition:none!important;"
    : `transition:max-height ${motion.duration.collapseMax}ms ${motion.ease.exit},` +
      `min-height ${motion.duration.collapseMax}ms ${motion.ease.exit},` +
      `margin-block-end ${motion.duration.collapseMax}ms ${motion.ease.exit},` +
      `opacity ${motion.duration.collapseFade}ms ${motion.ease.exit},` +
      `transform ${motion.duration.collapseShift}ms ${motion.ease.exit},` +
      `${ICANDY_INTERACTION_TRANSITION}!important;`;
  // Matches desktop's collapse: content leads (lifts) while the box
  // (max-height) follows, nothing overshoots on the way out. Skipped under
  // reduced motion — there is no settle to be honest about when the row is
  // about to vanish in one frame.
  const collapseLift = reduced
    ? ""
    : `;transform:translateY(-${motion.distance.rowLift}px)`;
  parts.push(
    `${rowSelector}{overflow:hidden;pointer-events:none;${collapseTransition}` +
      `max-height:0;min-height:0;margin-block-end:0;opacity:0${collapseLift}}`,
    `${wrapperSelector}{margin-block-end:0}`,
    `${placeholderSelector}{display:none!important}`,
  );
  return parts.join("\n");
}

/**
 * ---------------------------------------------------------------------------
 * Why the first expand of a group popped and the second one animated
 * ---------------------------------------------------------------------------
 * Reported as "the animation doesn't always play, only the second time I expand
 * a thread group". Measured, per revealed row, on an iPhone-13 WebKit build
 * (/tmp/bbrepro/perrow.mjs), counting for every newly-revealed row whether a
 * `max-height` transition was ever `running` on it:
 *
 *     chevron#0 pass1: 11/11 animated      chevron#0 pass2: 11/11 animated
 *     chevron#1 pass1:  0/14 animated      chevron#1 pass2:  3/14 animated
 *     chevron#2 pass1:  0/32 animated      chevron#2 pass2:  9/12 animated
 *     chevron#3 pass1:  0/14 animated      chevron#3 pass2:  2/14 animated
 *
 * The compact sheet was not at fault and neither were its tokens. The rows were
 * never there to transition. `buildCompactRowRules` hides a trimmed row's
 * windowed placeholder with `display:none`, which is the whole reason the
 * virtualizer stays healthy (see its header note) — and a `display:none`
 * placeholder is one BB has never realized. Expanding un-hides it, the
 * IntersectionObserver picks it up, and BB mounts a *brand new* row element. A
 * CSS transition needs a before-change style to interpolate from; an element
 * that did not exist one frame ago has none, so `max-height` cannot tween and
 * the row simply appears. Second expand animates because by then the rows are
 * in the DOM. Group #0 always animated because it sits at the top of the list
 * and the virtualizer had realized it before the first tap.
 *
 * Measured on the same expand (MutationObserver on the sidebar subtree): 18
 * rows mounted, every one of them inside a `[data-sidebar-windowed-item]`,
 * spread from 20 ms to 299 ms after the tap. Nothing about that is fixable from
 * the transition side.
 *
 * A CSS *animation*, unlike a transition, does play on a newly inserted
 * element — it needs no previous value, only keyframes. So the entrance is an
 * animation, `bb-trim-row-box` / `-ink` / `-lift` (declared in `staticCss`),
 * carrying the reveal transition's own three durations and three curves so a
 * mounted row and a merely-hidden row arrive identically.
 *
 * ---------------------------------------------------------------------------
 * The part that is easy to get catastrophically wrong
 * ---------------------------------------------------------------------------
 * An animation fires whenever a matching element is inserted. Left armed, this
 * rule would animate every row the virtualizer realizes while the user is
 * merely *scrolling* — which is not a hypothetical regression, it is icandy's
 * per-row mount animation, the exact thing that made this sidebar unusable on a
 * phone before the compact sheet existed. Two independent scopes keep it to the
 * event it belongs to:
 *
 *  1. WHICH ROWS. The selector lists only the ids that just stopped being
 *     hidden — the diff of `hiddenIds` across one expand, computed in app.tsx.
 *     That is the group whose chevron was tapped and nothing else: rows in
 *     other groups, and the handful in this group that were visible all along,
 *     match no selector and cannot animate. Scoping by an ancestor flag instead
 *     would have re-animated those already-visible rows, collapsing them to 0
 *     and re-opening them — a flash, for rows nothing happened to.
 *
 *  2. FOR HOW LONG. This rule lives in its own style tag, which is emptied
 *     again once the reveal is over (`disarmRowEntrance`), so scrolling back
 *     through the same group later finds no rule at all. See
 *     `motion.revealWindow` for the arm/idle/max envelope and the measurement
 *     behind it.
 *
 * Cost: one rule, one selector per revealed row, bounded by the expanded
 * group's overflow (11-32 in the measurements above) and present only during
 * the window — and it is money the hidden-row rule gives back at the same
 * moment, since those ids leave `hiddenIds` as they enter this list. The rows
 * sheet the perf gate measures is untouched at 4 rules.
 *
 * `!important` for the same reason as every other property this file animates
 * on these rows: icandy declares its motion as longhands at a specificity this
 * `:has()` selector cannot reach, and a dropped `animation-name` would fail the
 * way the dropped `transition-property` did — silently, and looking exactly
 * like the bug this function exists to fix. Measured today a managed row
 * computes `animation-name: none`, so nothing is being overridden; the marker
 * is there so a future icandy release cannot quietly take the entrance back.
 */
function buildRowEntranceRule(enteringIds: readonly string[]): string {
  const selector = enteringIds
    .map(
      (id) => `${HOVER_ROW}:has(> [data-sidebar-thread-id="${CSS.escape(id)}"])`,
    )
    .join(",");
  // `backwards` fill only. `forwards` would hold the implicit end value after
  // the run, and an implicit end value is a snapshot of the row's computed
  // style — so a collapse arriving inside the window would have been pinned
  // open by a finished animation until this tag was cleared. Backwards costs
  // nothing and removes any chance of the row being painted at its full height
  // for one frame before the first sample lands.
  return (
    `${selector}{animation:` +
    `${ENTER_ANIM_PREFIX}box ${motion.duration.revealMax}ms ${motion.ease.enter} backwards,` +
    `${ENTER_ANIM_PREFIX}ink ${motion.duration.revealFade}ms ${motion.ease.fade} backwards,` +
    `${ENTER_ANIM_PREFIX}lift ${motion.duration.revealShift}ms ${motion.ease.shift} backwards` +
    `!important}`
  );
}

let enterIdleTimer = 0;
let enterHardTimer = 0;
let enterWatching = false;

/**
 * Re-arms the idle timer on any entrance animation starting or ending.
 *
 * Both events, not just `animationend`: a row that mounts 299 ms after the tap
 * (measured, see above) would otherwise have its 260 ms lift torn out by an
 * idle timer set before it existed. `animationstart` pushes the window forward
 * the moment a late row appears, and its `animationend` pushes it once more, so
 * no row is ever cancelled part-open. The hard cap is deliberately not
 * refreshed here — that is what stops a scroll through a still-mounting group
 * from keeping the entrance armed forever.
 */
function onEnterActivity(event: AnimationEvent): void {
  if (!event.animationName.startsWith(ENTER_ANIM_PREFIX)) return;
  window.clearTimeout(enterIdleTimer);
  enterIdleTimer = window.setTimeout(
    disarmRowEntrance,
    motion.revealWindow.idle,
  );
}

/**
 * Ends the reveal window: no rule, no listener, no timers. Emptying the tag
 * cancels anything still running from it, which is why every path into here is
 * either "nothing has run for `idle` ms" or the hard cap.
 */
function disarmRowEntrance(): void {
  window.clearTimeout(enterIdleTimer);
  enterIdleTimer = 0;
  window.clearTimeout(enterHardTimer);
  enterHardTimer = 0;
  if (enterWatching) {
    document.removeEventListener("animationstart", onEnterActivity, true);
    document.removeEventListener("animationend", onEnterActivity, true);
    enterWatching = false;
  }
  const tag = document.getElementById(ENTER_STYLE_ID);
  if (tag && tag.textContent) tag.textContent = "";
}

/**
 * Arms the mount entrance for one expand.
 *
 * Call it with the ids that just left `hiddenIds`. An empty list is a no-op,
 * NOT a disarm, and the difference is load-bearing: the rows effect re-runs for
 * every reason the thread list changes, and a thread list that changes 200 ms
 * into a reveal is an ordinary Tuesday. Treating "nothing is entering" as
 * "stop" made a reply landing mid-expand cancel the expand's animations
 * half-open. The window only ever ends on its own timers, which is also what
 * keeps it honest — nothing can extend it either.
 *
 * The one case that does cut a reveal short is a second chevron tapped inside
 * the window: rewriting this tag re-parses it and takes the first group's
 * running animations with it, wherever they had got to. Left as is on purpose.
 * A union of both id sets would not help — the re-parse cancels everything in
 * the tag regardless of which selectors still match — and by then the first
 * group is most of the way open, while the second tap is itself the thing the
 * eye has moved to.
 *
 * Compact only, and never under reduced motion: the whole point is a CSS
 * animation, and someone who asked for no motion must get none created at all,
 * not a fast one. Desktop keeps `buildRowRules` byte-for-byte as it was.
 */
export function applyRowEntranceStylesheet(
  enteringIds: readonly string[],
  compact: boolean,
): void {
  if (enteringIds.length === 0) return;
  if (!compact || prefersReducedMotion()) {
    disarmRowEntrance();
    return;
  }
  ensureStyleTag(ENTER_STYLE_ID).textContent =
    buildRowEntranceRule(enteringIds);
  if (!enterWatching) {
    document.addEventListener("animationstart", onEnterActivity, true);
    document.addEventListener("animationend", onEnterActivity, true);
    enterWatching = true;
  }
  // `arm` rather than `idle` for the opening timer: nothing has animated yet,
  // and a group expanded entirely below the fold may never animate at all —
  // its rows stay unrealized placeholders until a later scroll, which must not
  // find this rule still in place.
  window.clearTimeout(enterIdleTimer);
  enterIdleTimer = window.setTimeout(disarmRowEntrance, motion.revealWindow.arm);
  window.clearTimeout(enterHardTimer);
  enterHardTimer = window.setTimeout(disarmRowEntrance, motion.revealWindow.max);
}

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
  ensureStyleTag(ROWS_STYLE_ID).textContent = compact
    ? buildCompactRowRules(managedIds, hiddenIds)
    : buildRowRules(managedIds, hiddenIds, compact);
}

export function clearHideStylesheet(): void {
  lastHideKey = "";
  lastStaticKey = "";
  // Before the tags go: `disarmRowEntrance` also drops the document-level
  // animation listeners and the two timers, which would otherwise outlive the
  // overlay and fire `document.getElementById` against a tag that no longer
  // exists on every unmount.
  disarmRowEntrance();
  document.getElementById(ENTER_STYLE_ID)?.remove();
  document.getElementById(ROWS_STYLE_ID)?.remove();
  document.getElementById(STATIC_STYLE_ID)?.remove();
}
