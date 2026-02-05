"use client";

import { use } from "react";
import { SessionProvider } from "@/components/providers/session-provider";
import { ChatContainer } from "@/components/chat/chat-container";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

export default function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = use(params);

  return (
    <SessionProvider sessionId={sessionId}>
      <ChatContainer sessionId={sessionId} />
    </SessionProvider>
  );
}
