import { ChatContainerLoading } from "@/components/chat/chat-container";
import { SessionRightSidebarLoading } from "@/components/sidebar/session-right-sidebar";

export default function Loading() {
  return (
    <>
      <SessionRightSidebarLoading />
      <ChatContainerLoading />
    </>
  );
}
