import type { Metadata } from "next";
import { IntegrationLinkPageClient } from "./page-client";

export const metadata: Metadata = {
  title: "Link integration",
  openGraph: { title: "Link integration" },
};

export default async function IntegrationLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <IntegrationLinkPageClient token={token ?? null} />;
}
