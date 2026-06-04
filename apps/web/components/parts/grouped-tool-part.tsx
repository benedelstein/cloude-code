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
  isActive?: boolean;
}

export function GroupedToolPart({ group, isActive = false }: GroupedToolPartProps) {
  switch (group.kind) {
    case "bash":
      return (
        <BashGroupPart
          actions={group.actions.map((action) => action.payload as BashAction)}
          isActive={isActive}
        />
      );
    case "read":
      return (
        <ReadGroupPart
          actions={group.actions.map((action) => action.payload as ReadAction)}
          isActive={isActive}
        />
      );
    case "search":
      return (
        <SearchGroupPart
          actions={group.actions.map((action) => action.payload as SearchAction)}
          isActive={isActive}
        />
      );
    case "web":
      return (
        <WebGroupPart
          actions={group.actions.map((action) => action.payload as WebAction)}
          isActive={isActive}
        />
      );
    case "other":
      return (
        <GenericGroupPart
          actions={group.actions.map((action) => action.payload as OtherAction)}
          isActive={isActive}
        />
      );
    default: {
      const exhaustive: never = group.kind;
      throw new Error(`Unhandled group kind: ${exhaustive}`);
    }
  }
}
