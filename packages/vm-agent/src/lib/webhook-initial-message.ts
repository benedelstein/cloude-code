import { readFileSync, unlinkSync } from "fs";
import {
  AgentInputMessage,
  type AgentInputMessage as AgentInputMessageType,
} from "@repo/shared";

export function loadInitialMessageFromFile(path: string): AgentInputMessageType {
  const messageJson = readFileSync(path, "utf-8");
  const message = AgentInputMessage.parse(JSON.parse(messageJson));
  unlinkSync(path);
  return message;
}
