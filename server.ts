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
  });
  bb.log.info("Sidebar Trim loaded");
}
