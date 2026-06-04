import { describe, expect, it } from "vitest";
import type { AttachmentRecord } from "../../src/shared/types/attachments";
import { buildUserUiMessage } from "../../src/shared/utils/build-user-message";

const attachmentRecord: AttachmentRecord = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  uploaderUserId: "user-1",
  sessionId: "session-1",
  filename: "screenshot.png",
  mediaType: "image/png",
  sizeBytes: 123,
  objectKey: "attachments/123e4567-e89b-12d3-a456-426614174000",
  createdAt: "2026-06-03T00:00:00.000Z",
  boundAt: "2026-06-03T00:00:00.000Z",
};

describe("buildUserUiMessage", () => {
  it("builds a required text initial message", async () => {
    const message = await buildUserUiMessage(
      "session-1",
      { content: "  Fix this  " },
      {
        attachmentService: {
          getByIdsBoundToSession: async () => [],
        },
      },
    );

    expect(message.role).toBe("user");
    expect(message.parts).toEqual([{ type: "text", text: "Fix this" }]);
  });

  it("builds a required attachment-only initial message", async () => {
    const message = await buildUserUiMessage(
      "session-1",
      { attachmentIds: [attachmentRecord.id] },
      {
        attachmentService: {
          getByIdsBoundToSession: async () => [attachmentRecord],
        },
      },
    );

    expect(message.role).toBe("user");
    expect(message.parts).toMatchObject([
      {
        type: "file",
        filename: "screenshot.png",
        mediaType: "image/png",
      },
    ]);
  });

  it("throws when no initial message can be built", async () => {
    await expect(buildUserUiMessage(
      "session-1",
      {},
      {
        attachmentService: {
          getByIdsBoundToSession: async () => [],
        },
      },
    )).rejects.toThrow("Expected initial user message to include content or attachments");
  });
});
