import type { Metadata } from "next";
import { verifySession } from "@/lib/auth";
import { CreateEnvironmentPageClient } from "./page-client";

export const metadata: Metadata = {
  title: "Create Environment",
  openGraph: {
    title: "Create Environment",
  },
};

export default async function CreateEnvironmentPage() {
  await verifySession();

  return <CreateEnvironmentPageClient />;
}
