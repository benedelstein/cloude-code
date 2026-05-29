import { verifySession } from "@/lib/auth";
import { EditEnvironmentPageClient } from "./page-client";

interface EditEnvironmentPageProps {
  params: Promise<{ environmentId: string }>;
}

export default async function EditEnvironmentPage({
  params,
}: EditEnvironmentPageProps) {
  await verifySession();

  const { environmentId } = await params;

  return <EditEnvironmentPageClient environmentId={environmentId} />;
}
