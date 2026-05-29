import type { Metadata } from "next";
import { getSessionToken, verifySession } from "@/lib/auth";
import { getSession } from "@/lib/server-api";
import { SessionPageClient } from "./session-page-client";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export async function generateMetadata({
  params,
}: SessionPageProps): Promise<Metadata> {
  const { sessionId } = await params;
  await verifySession();

  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    return { title: "Cloude Code" };
  }

  const session = await getSession(sessionId, sessionToken);

  return {
    title: session.title ? `${session.title} | Cloude Code` : "Cloude Code",
  };
}

export default async function SessionPage({ params }: SessionPageProps) {
  await verifySession();

  const { sessionId } = await params;

  return <SessionPageClient sessionId={sessionId} />;
}
