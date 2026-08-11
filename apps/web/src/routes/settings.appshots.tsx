import { createFileRoute } from "@tanstack/react-router";

import { AppshotsSettingsPanel } from "../components/settings/AppshotsSettings";

export const Route = createFileRoute("/settings/appshots")({
  component: AppshotsSettingsPanel,
});
