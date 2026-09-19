# Sidebar Trim

Keeps the BB sidebar from turning into a thrift store of old chats — without archiving anything.

## Behavior

- Shows the **3 latest** threads under each project (By project sidebar)
- Shows the **24 latest** threads in the general Threads list
- Always keeps pinned threads, the active thread, and threads that need attention
- Expand control shows older threads when a group is over the limit

Limits are configurable in the plugin settings.

## How it works

Both desktop and phone use the same mechanism: BB's native list plus a CSS
`:has()` stylesheet that collapses older rows (`max-height`/`opacity`, never
`display:none`) and injects the expand chevrons into the section headers.

Keeping the native list means project grouping, nested threads, hover actions
and drag-reorder stay BB's on every surface.

Leave **Settings → Appearance → Sidebar thread list** on **Built-in** — Trim
works as an overlay and does not replace the list.
