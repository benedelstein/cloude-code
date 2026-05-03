import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "../../src/types/attachments";
import { CreateSessionRequest } from "../../src/types/api/sessions";

describe("session api schemas", () => {
  it("limits create-session initial attachments to five", () => {
    const attachmentId = "123e4567-e89b-12d3-a456-426614174000";

    expect(() => CreateSessionRequest.parse({
      repoId: 1,
      attachmentIds: Array.from(
        { length: MAX_ATTACHMENTS_PER_MESSAGE },
        () => attachmentId,
      ),
    })).not.toThrow();

    expect(() => CreateSessionRequest.parse({
      repoId: 1,
      attachmentIds: Array.from(
        { length: MAX_ATTACHMENTS_PER_MESSAGE + 1 },
        () => attachmentId,
      ),
    })).toThrow();
  });
});
