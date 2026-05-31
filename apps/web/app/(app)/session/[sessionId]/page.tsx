import type { Metadata } from "next";
import { getSessionToken, verifySession } from "@/lib/auth";
import { getSession, ServerApiError } from "@/lib/server-api";
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

  let sessionTitle: string | null = null;
  try {
    const session = await getSession(sessionId, sessionToken);
    sessionTitle = session.title;
  } catch (error) {
    if (!(error instanceof ServerApiError && error.status === 403)) {
      throw error;
    }
  }

  return {
    title: sessionTitle ? `${sessionTitle} | Cloude Code` : "Cloude Code",
  };
}

export default async function SessionPage({ params }: SessionPageProps) {
  await verifySession();

  const { sessionId } = await params;

  return <SessionPageClient sessionId={sessionId} />;
}
