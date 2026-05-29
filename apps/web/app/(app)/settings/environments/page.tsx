import { verifySession } from "@/lib/auth";
import { EnvironmentsPageClient } from "./page-client";

export default async function EnvironmentsPage() {
  await verifySession();

  return <EnvironmentsPageClient />;
}
