import { getVerifiedSessionToken, verifySession } from "@/lib/auth";
import {
  getServerUserRepoEnvironment,
  ServerApiError,
} from "@/lib/server-api";
import { EditEnvironmentPageClient } from "./page-client";

interface EditEnvironmentPageProps {
  params: Promise<{ environmentId: string }>;
}

export default async function EditEnvironmentPage({
  params,
}: EditEnvironmentPageProps) {
  await verifySession();
  const sessionToken = await getVerifiedSessionToken();

  const { environmentId } = await params;
  let initialEnvironment = null;

  try {
    const response = await getServerUserRepoEnvironment(
      environmentId,
      sessionToken,
    );
    initialEnvironment = response.environment;
  } catch (error) {
    if (!(error instanceof ServerApiError && error.status === 404)) {
      throw error;
    }
  }

  return (
    <EditEnvironmentPageClient
      initialEnvironment={initialEnvironment}
    />
  );
}
