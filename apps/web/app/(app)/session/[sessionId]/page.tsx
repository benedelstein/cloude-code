import { verifySession } from "@/lib/auth";
import { SessionPageClient } from "./session-page-client";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default async function SessionPage({ params }: SessionPageProps) {
  await verifySession();

  const { sessionId } = await params;

  return <SessionPageClient sessionId={sessionId} />;
}
