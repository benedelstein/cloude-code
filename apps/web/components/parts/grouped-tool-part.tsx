"use client";

import type {
  BashAction,
  OtherAction,
  ReadAction,
  SearchAction,
  WebAction,
} from "@repo/shared";
import type { ActionGroup } from "./group-actions";
import { BashGroupPart } from "./bash-part";
import { ReadGroupPart } from "./read-part";
import { SearchGroupPart } from "./search-part";
import { WebGroupPart } from "./web-part";
import { GenericGroupPart } from "./generic-tool-part";

interface GroupedToolPartProps {
  group: ActionGroup;
}

export function GroupedToolPart({ group }: GroupedToolPartProps) {
  switch (group.kind) {
    case "bash":
      return <BashGroupPart actions={group.actions.map((action) => action.payload as BashAction)} />;
    case "read":
      return <ReadGroupPart actions={group.actions.map((action) => action.payload as ReadAction)} />;
    case "search":
      return <SearchGroupPart actions={group.actions.map((action) => action.payload as SearchAction)} />;
    case "web":
      return <WebGroupPart actions={group.actions.map((action) => action.payload as WebAction)} />;
    case "other":
      return <GenericGroupPart actions={group.actions.map((action) => action.payload as OtherAction)} />;
    default: {
      const exhaustive: never = group.kind;
      throw new Error(`Unhandled group kind: ${exhaustive}`);
    }
  }
}
