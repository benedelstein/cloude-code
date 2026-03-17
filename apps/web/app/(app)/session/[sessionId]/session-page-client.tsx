"use client";

import { useEffect } from "react";
import { SessionProvider } from "@/components/providers/session-provider";
import { useSessionTitle } from "@/components/providers/session-list-provider";
import { ChatContainer } from "@/components/chat/chat-container";
import { SessionRightSidebar } from "@/components/sidebar/session-right-sidebar";

interface SessionPageClientProps {
  sessionId: string;
}

function SessionDocumentTitle({ sessionId }: { sessionId: string }) {
  const sessionTitle = useSessionTitle(sessionId);

  useEffect(() => {
    const previous = document.title;
    document.title = sessionTitle
      ? `${sessionTitle} | Cloude Code`
      : "Cloude Code";
    return () => {
      document.title = previous;
    };
  }, [sessionTitle]);

  return null;
}

export function SessionPageClient({
  sessionId,
}: SessionPageClientProps) {
  return (
    <SessionProvider sessionId={sessionId}>
      <SessionDocumentTitle sessionId={sessionId} />
      <SessionRightSidebar />
      <ChatContainer sessionId={sessionId} />
    </SessionProvider>
  );
}
