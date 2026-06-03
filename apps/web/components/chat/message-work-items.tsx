"use client";

import clsx from "clsx";
import type { ActionItem } from "@/components/parts/group-actions";
import { BashPart } from "@/components/parts/bash-part";
import { EditPart } from "@/components/parts/edit-part";
import { ExitPlanModePart } from "@/components/parts/exit-plan-mode-part";
import { GenericToolPart } from "@/components/parts/generic-tool-part";
import { GroupedToolPart } from "@/components/parts/grouped-tool-part";
import { ReadPart } from "@/components/parts/read-part";
import { ReasoningPart } from "@/components/parts/reasoning-part";
import { SearchPart } from "@/components/parts/search-part";
import { TextPart } from "@/components/parts/text-part";
import { TodoToolPart } from "@/components/parts/todo-write-part";
import { WebPart } from "@/components/parts/web-part";
import { WritePart } from "@/components/parts/write-part";

export type RenderItem =
  | { kind: "text"; key: string; text: string }
  | { kind: "reasoning"; key: string; part: { text?: string; startedAt?: number; endedAt?: number } }
  | { kind: "action-item"; key: string; item: ActionItem };

export function WorkItems({
  items,
  isStreaming,
  isUser,
}: {
  items: RenderItem[];
  isStreaming: boolean;
  isUser: boolean;
}) {
  return (
    <>
      {items.map((item, index) => {
        const previous = items[index - 1];
        const isToolItem = item.kind === "action-item";
        const previousIsToolItem = previous?.kind === "action-item";
        const needsBoundarySpacing = (item.kind === "text" && previousIsToolItem)
          || (isToolItem && previous?.kind === "text");

        return (
          <div key={item.key} className={clsx(needsBoundarySpacing && "mt-2")}>
            <WorkItemRenderer item={item} isStreaming={isStreaming} isUser={isUser} />
          </div>
        );
      })}
    </>
  );
}

function WorkItemRenderer({
  item,
  isStreaming,
  isUser,
}: {
  item: RenderItem;
  isStreaming: boolean;
  isUser: boolean;
}) {
  switch (item.kind) {
    case "text":
      return <TextPart text={item.text} isUser={isUser} />;
    case "reasoning":
      return <ReasoningPart part={item.part} isStreaming={isStreaming} />;
    case "action-item":
      return <ActionItemRenderer item={item.item} />;
    default: {
      const exhaustive: never = item;
      throw new Error(`Unhandled work item: ${(exhaustive as { kind: string }).kind}`);
    }
  }
}

function ActionItemRenderer({ item }: { item: ActionItem }) {
  if (item.type === "group") {
    return <GroupedToolPart group={item} />;
  }
  const { action } = item;
  switch (action.kind) {
    case "read":
      return <ReadPart action={action.payload} />;
    case "edit":
      return <EditPart action={action.payload} />;
    case "write":
      return <WritePart action={action.payload} />;
    case "bash":
      return <BashPart action={action.payload} />;
    case "search":
      return <SearchPart action={action.payload} />;
    case "web":
      return <WebPart action={action.payload} />;
    case "other":
      return <GenericToolPart action={action.payload} />;
    case "todo":
      return <TodoToolPart action={action.payload} />;
    case "plan":
      return <ExitPlanModePart action={action.payload} />;
    default: {
      const exhaustive: never = action;
      throw new Error(`Unhandled action kind: ${(exhaustive as { kind: string }).kind}`);
    }
  }
}
