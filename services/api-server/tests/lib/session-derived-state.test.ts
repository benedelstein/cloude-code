import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import { extractDerivedStateFromPart } from "../../src/shared/utils/session-derived-state";

type MessagePart = UIMessage["parts"][number];

describe("extractDerivedStateFromPart", () => {
  it("extracts Claude TodoWrite todos", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "TodoWrite",
      input: {
        todos: [
          { content: "Inspect bug", status: "in_progress", activeForm: "Inspecting bug" },
          { content: "Add test", status: "pending" },
        ],
      },
    } as MessagePart;

    expect(extractDerivedStateFromPart(part)).toEqual({
      todos: [
        { content: "Inspect bug", status: "in_progress", activeForm: "Inspecting bug" },
        { content: "Add test", status: "pending" },
      ],
    });
  });

  it("extracts Claude TaskCreate as a pending todo", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "TaskCreate",
      input: {
        subject: "Inspect bug",
        description: "Find the broken path",
        activeForm: "Inspecting bug",
      },
      output: "Task #3 created successfully: Inspect bug",
    } as MessagePart;

    expect(extractDerivedStateFromPart(part)).toEqual({
      todos: [
        { id: "3", content: "Inspect bug", status: "pending", activeForm: "Inspecting bug" },
      ],
    });
  });

  it("applies Claude TaskUpdate to the current todo snapshot", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "TaskUpdate",
      input: {
        taskId: "2",
        status: "in_progress",
      },
    } as MessagePart;

    expect(extractDerivedStateFromPart(part, [
      { id: "1", content: "Inspect bug", status: "completed" },
      { id: "2", content: "Add test", status: "pending" },
    ])).toEqual({
      todos: [
        { id: "1", content: "Inspect bug", status: "completed" },
        { id: "2", content: "Add test", status: "in_progress" },
      ],
    });
  });

  it("applies Claude TaskUpdate deletion to the current todo snapshot", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "TaskUpdate",
      input: {
        taskId: "1",
        status: "deleted",
      },
    } as MessagePart;

    expect(extractDerivedStateFromPart(part, [
      { id: "1", content: "Inspect bug", status: "pending" },
      { id: "2", content: "Add test", status: "pending" },
    ])).toEqual({
      todos: [
        { id: "2", content: "Add test", status: "pending" },
      ],
    });
  });

  it("extracts Codex update_plan todos from args", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "update_plan",
      args: {
        threadId: "thread-1",
        turnId: "turn-1",
        explanation: "Working through the checklist.",
        plan: [
          { step: "Inspect bug", status: "inProgress" },
          { step: "Add test", status: "pending" },
          { step: "Ship fix", status: "completed" },
        ],
      },
    } as MessagePart;

    expect(extractDerivedStateFromPart(part)).toEqual({
      todos: [
        { content: "Inspect bug", status: "in_progress" },
        { content: "Add test", status: "pending" },
        { content: "Ship fix", status: "completed" },
      ],
    });
  });

  it("extracts ExitPlanMode persisted plan text", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "ExitPlanMode",
      input: {
        plan: "1. Inspect the current implementation\n2. Patch the parser",
      },
    } as MessagePart;

    expect(extractDerivedStateFromPart(part)).toEqual({
      plan: "1. Inspect the current implementation\n2. Patch the parser",
    });
  });

  it("returns null for unknown tools", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "unknown_tool",
      input: { anything: true },
    } as MessagePart;

    expect(extractDerivedStateFromPart(part)).toBeNull();
  });

  it("returns null for invalid adapter payloads", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "update_plan",
      input: {
        plan: [{ step: "Inspect bug", status: "in_progress" }],
      },
    } as MessagePart;

    expect(extractDerivedStateFromPart(part)).toBeNull();
  });
});
