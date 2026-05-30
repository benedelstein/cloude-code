import type { Metadata } from "next";
import { verifySession } from "@/lib/auth";
import { EnvironmentsPageClient } from "./page-client";

export const metadata: Metadata = {
  title: "Environments",
  openGraph: {
    title: "Environments",
  },
};

export default async function EnvironmentsPage() {
  await verifySession();

  return <EnvironmentsPageClient />;
}
