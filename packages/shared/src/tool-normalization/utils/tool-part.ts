import { getToolName } from "ai";
import type { NormalizableToolUIPart } from "../types";

export function toolPartName(part: NormalizableToolUIPart): string {
  return getToolName(part);
}
