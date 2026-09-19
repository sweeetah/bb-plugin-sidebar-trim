# Sidebar Trim

Keeps the BB sidebar from turning into a thrift store of old chats — without archiving anything.

## Behavior

- Shows the **3 latest** threads under each project (By project sidebar)
- Shows the **24 latest** threads in the general Threads list
- Always keeps pinned threads, the active thread, and threads that need attention
- Expand control shows older threads when a group is over the limit

Limits are configurable in the plugin settings.

## Auto-collapse with the right panel

Opening the right panel collapses the left sidebar, and closing it brings the
sidebar back — the two panels stop fighting over the same width.

- Only the *transition* acts, so launching with both open leaves them alone
- Reopen the sidebar by hand and Trim drops its claim: it will not close it
  again, and will not auto-restore it later
- Desktop only — the mobile drawer overlays rather than reserving width
- Toggle it off with **Collapse sidebar when the right panel opens** in the
  plugin settings

## How it works

Both desktop and phone use the same mechanism: BB's native list plus a CSS
`:has()` stylesheet that collapses older rows (`max-height`/`opacity`, never
`display:none`) and injects the expand chevrons into the section headers.

Keeping the native list means project grouping, nested threads, hover actions
and drag-reorder stay BB's on every surface.

Leave **Settings → Appearance → Sidebar thread list** on **Built-in** — Trim
works as an overlay and does not replace the list.

Auto-collapse watches the DOM rather than BB internals: the right panel's
toggle reports `aria-label="Hide right panel"` when open, and the sidebar's own
`[data-sidebar="trigger"]` carries `aria-expanded`. Trim clicks that real
trigger instead of writing the `bb.sidebar.open` value itself, so BB stays the
single source of truth and its open/close transition still plays. See
`lib/autoCollapse.ts`.

## Mobile: trimming is on, but the sheet has a different shape

Trimming and the expand/collapse chevrons work on mobile exactly as they do on
desktop. What changes below 767px is *how the CSS is written* — see
`buildCompactRowRules` in `lib/stylesheet.ts`.

BB's sidebar thread list is virtualized: off-screen rows are
`[data-sidebar-windowed-item]` placeholders, and an IntersectionObserver over a
240px band swaps in real rows. The desktop sheet emits one or two `:has()` rules
**per managed thread**, each with a full transition shorthand — 206 KB and 662
`:has()` selectors here, while only ~13 thread anchors are ever in the DOM. On a
phone that froze the drawer for about five seconds mid-scroll.

The compact sheet changes three things:

1. **One rule per concern**, with a joined selector list, and only for *hidden*
   ids — visible rows need no rule once there is no reveal transition to declare.
   206 KB / 662 rules becomes ~47 KB / 3 rules.
2. **`:has(> …)`** with a child combinator, so matching is a direct-child check
   rather than a descendant search.
3. **Placeholders are `display:none`, not `height:0`.** This is the load-bearing
   one. Zero-height placeholders still generate boxes, so ~150 of them stack at
   the same y and *all* intersect the observation band at once — the virtualizer
   gives up and realizes the lot. A `display:none` element generates no box, so a
   hidden row is never observed and never realized. Note this is `display:none`
   on the **placeholder**, which has no content — not on a realized row, which is
   what blanked the list on iOS in 0f3edb5.

Measured in iPhone WebKit over an identical scroll:

| placeholder rule | max realized rows | worst frame |
| --- | --- | --- |
| none (gaps left behind) | 56 | 31 ms |
| `height: 0` (desktop shape) | 63 | 65 ms |
| `display: none` (compact shape) | **20** | **30 ms** |

End to end the mobile drawer now scrolls with a worst frame of ~29 ms and no
frame over 100 ms, down from a 5146 ms stall.

### Motion on the compact sheet

Expand/collapse animates on mobile as it does on desktop — same tokens from
`lib/motion.ts` (reveal 230/150/260ms on `ease.enter`, collapse 160/110/150ms on
`ease.exit`, `rowLift` 6px on the way out), with content leading the box open and
the box leading it closed. What mobile does **not** get is desktop's per-row
stagger: a per-row delay needs a per-row rule, which is the 662-rule shape that
froze the phone. A synchronised group toggle is the accepted trade.

Three things make this work that are easy to get wrong:

- **A transition cannot animate a row that did not exist last frame.** This is
  why expanding a group used to pop the first time and animate the second, and
  it is the single most confusing bug this plugin has had. A trimmed row's
  placeholder is `display:none`, so BB has never built the row; expanding
  un-hides the placeholder, the IntersectionObserver picks it up, and BB mounts
  a **brand new** element. A CSS transition needs a before-change style to
  interpolate from, and a newborn element has none, so `max-height` silently
  refuses to tween. Measured per row in iPhone-13 WebKit: `0/14`, `0/32`,
  `0/14` animated on a first expand. Only the group at the very top of the list
  animated, because the virtualizer had already built its rows.

  A CSS **animation** does play on a fresh mount, so the reveal now has two
  mechanisms for one move: the transition for rows already in the DOM, and
  `bb-trim-row-box` / `-ink` / `-lift` for rows being built. They carry the same
  three durations and the same three curves, so the two are the same picture —
  measured frame by frame, a mounted row and a restyled row reach 82% / 96% /
  99% of full height at 40 / 80 / 120 ms alike. The keyframes declare only
  `from`; the implicit `to` resolves to the row's own computed style, so the box
  opens to BB's real row height, the sticky floor to BB's real `min-height` and
  the margin to whatever `space-y-*` that list uses — no value is guessed.

  Worth knowing: on a phone *nearly every* expand is a mount. Collapsing puts
  the placeholder back to `display:none` and BB unmounts the row again, so the
  transition path is only ever reached by the top group. The animation is not a
  patch on the transition; on mobile it is the mechanism.

  It is also the dangerous one. An animation fires whenever a matching element
  is inserted, so an entrance that is always armed animates every row the
  virtualizer realizes **while you are scrolling** — which is exactly the icandy
  per-row mount animation that made this sidebar unusable on a phone to begin
  with. Two scopes keep it to the tap: the rule names only the ids that just
  stopped being hidden (so no other group, and none of the rows that were
  visible all along, can match), and it lives in its own style tag that is
  retired again once the reveal is over. See `motion.revealWindow` for the
  arm / idle / max envelope and `/tmp/bbrepro/scrollsafe.mjs` for the proof that
  a full scroll of the sidebar starts zero row animations, before a chevron has
  ever been tapped and again right after one has.

- **`max-height` cannot interpolate from `none`.** Declaring the transition on
  the bare row class looks cheap and does nothing on reveal, because the row's
  resting `max-height` is the browser default. The reveal rule has to name the
  currently-visible managed ids so both ends of the transition are real lengths.
- **icandy overrides our transition unless it is `!important`.** icandy styles
  the same rows with `transition-property`/`-duration`/`-timing-function`
  **longhands** at specificity (0,4,0); ours is a `transition` shorthand on a
  `:has()` selector at (0,2,0). Longhands resolve per property across rules, so
  icandy's list silently won and `max-height`/`min-height`/`margin-block-end`/
  `transform` never transitioned at all — only `opacity` appeared to move, on
  icandy's timing rather than ours. That failure is invisible in a screenshot and
  nearly invisible by eye. Any future property list added here needs the same
  `!important`, or it will be quietly dropped on rows icandy also styles. The
  mount entrance carries it too. Measured today a managed row computes
  `animation-name: none`, so nothing is actually being overridden — the marker
  is there so a future icandy release cannot take the entrance back the same
  silent way it took the transition, which would look exactly like the pop this
  whole section exists to explain.

Placeholders are never animated — `display:none` is binary, and the
virtualization constraint above outranks the motion.

`compact` is part of `buttonFingerprint`, and the expand-button effect verifies
the buttons are still in the DOM before trusting that fingerprint — BB rebuilds
the sidebar subtree when it swaps the desktop panel for the mobile drawer, and
closing/reopening the drawer unmounts them while every other input stays
identical.
