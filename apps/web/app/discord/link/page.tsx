import type { Metadata } from "next";
import { DiscordLinkPageClient } from "./page-client";

export const metadata: Metadata = {
  title: "Link Discord",
  openGraph: { title: "Link Discord" },
};

export default async function DiscordLinkPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <DiscordLinkPageClient token={token ?? null} />;
}
