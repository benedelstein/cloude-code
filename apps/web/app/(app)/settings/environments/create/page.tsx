import { verifySession } from "@/lib/auth";
import { CreateEnvironmentPageClient } from "./page-client";

export default async function CreateEnvironmentPage() {
  await verifySession();

  return <CreateEnvironmentPageClient />;
}
