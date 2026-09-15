# Sidebar Trim

Keeps the BB sidebar from turning into a thrift store of old chats — without archiving anything.

## Behavior

- Shows the **3 latest** threads under each project (By project sidebar)
- Shows the **24 latest** threads in the general Threads list
- Always keeps pinned threads, the active thread, and threads that need attention
- Expand control shows older threads when a group is over the limit

Limits are configurable in the plugin settings.

## How it works

| Surface | Mechanism |
|---------|-----------|
| **iPhone / compact** | `experimental_threadList` renders a **filtered** list — older threads are never mounted. This avoids iOS WKWebView flicker from `display:none` / sticky stacks. |
| **Desktop** | Native BB list + a CSS `:has()` stylesheet (and header expand chevrons). |

If the phone sidebar still looks like the full BB list, set **Settings → Appearance → Sidebar thread list** to **Sidebar Trim**.
