import { redirect } from "next/navigation";
import { GithubInstallCompletePageClient } from "./page-client";

export default async function GithubInstallCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;

  if (state) {
    redirect(`/api/auth/github/install/callback?state=${encodeURIComponent(state)}`);
  }

  return <GithubInstallCompletePageClient />;
}
