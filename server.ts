// Sidebar Trim — UI lives in app.tsx; BB requires a backend entry.
import type { BbPluginApi } from "@get-bb/plugin-sdk";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    workspaceLimit: {
      type: "number",
      label: "Threads per project",
      default: 3,
      description:
        "How many latest threads to show under each project before expand.",
    },
    generalLimit: {
      type: "number",
      label: "Threads in general list",
      default: 24,
      description:
        "How many latest threads to show in the general Threads section before expand.",
    },
    autoCollapseSidebar: {
      type: "boolean",
      label: "Collapse sidebar when the right panel opens",
      default: true,
      description:
        "Frees the width for the right panel. Reopens the sidebar when the right panel closes, unless you reopened it yourself first.",
    },
  });
  bb.log.info("Sidebar Trim loaded");
}
