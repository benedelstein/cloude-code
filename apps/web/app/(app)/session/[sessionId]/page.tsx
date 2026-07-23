import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getSessionToken, getVerifiedSessionToken, verifySession } from "@/lib/auth";
import { getSession, ServerApiError } from "@/lib/server-api";
import { SessionPageClient } from "./session-page-client";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

const getSessionForRoute = cache(async (sessionId: string, sessionToken: string) => {
  try {
    return await getSession(sessionId, sessionToken);
  } catch (error) {
    if (error instanceof ServerApiError) {
      if (error.status === 404) {
        notFound();
      }
      if (error.status === 403) {
        return null;
      }
    }
    throw error;
  }
});

export async function generateMetadata({
  params,
}: SessionPageProps): Promise<Metadata> {
  const { sessionId } = await params;
  await verifySession();

  const sessionToken = await getSessionToken();
  if (!sessionToken) {
    return { title: "My Machines" };
  }

  const session = await getSessionForRoute(sessionId, sessionToken);
  const sessionTitle = session?.title ?? null;

  return {
    title: sessionTitle ? `${sessionTitle} | My Machines` : "My Machines",
  };
}

export default async function SessionPage({ params }: SessionPageProps) {
  await verifySession();

  const { sessionId } = await params;
  const sessionToken = await getVerifiedSessionToken();
  await getSessionForRoute(sessionId, sessionToken);

  return <SessionPageClient sessionId={sessionId} />;
}
