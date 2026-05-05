import { verifySession } from "@/lib/auth";
import { HomePageClient } from "../home-page-client";

export default async function DashboardPage() {
  await verifySession();

  return <HomePageClient />;
}
