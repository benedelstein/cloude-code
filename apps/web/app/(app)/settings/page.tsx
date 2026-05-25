import { verifySession } from "@/lib/auth";
import { SettingsPageClient } from "./settings-page-client";

export default async function SettingsPage() {
  await verifySession();

  return <SettingsPageClient />;
}
