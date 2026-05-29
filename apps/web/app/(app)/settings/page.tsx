import type { Metadata } from "next";
import { verifySession } from "@/lib/auth";
import { SettingsPageClient } from "./settings-page-client";

export const metadata: Metadata = {
  title: "Settings",
  openGraph: {
    title: "Settings",
  },
};

export default async function SettingsPage() {
  await verifySession();

  return <SettingsPageClient />;
}
