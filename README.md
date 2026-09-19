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
