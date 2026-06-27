import { describe, expect, it } from "vitest";
import { AttachmentDescriptor } from "../src/attachments";

describe("attachments contract", () => {
  it("accepts optional image dimensions on attachment descriptors", () => {
    expect(AttachmentDescriptor.parse({
      attachmentId: "123e4567-e89b-12d3-a456-426614174000",
      filename: "screenshot.png",
      mediaType: "image/png",
      sizeBytes: 123,
      width: 640,
      height: 480,
      createdAt: "2026-06-24T00:00:00.000Z",
      contentUrl: "/attachments/123e4567-e89b-12d3-a456-426614174000/content",
    })).toMatchObject({
      width: 640,
      height: 480,
    });
  });

  it("keeps older attachment descriptors without dimensions valid", () => {
    expect(AttachmentDescriptor.parse({
      attachmentId: "123e4567-e89b-12d3-a456-426614174000",
      filename: "screenshot.png",
      mediaType: "image/png",
      sizeBytes: 123,
      createdAt: "2026-06-24T00:00:00.000Z",
      contentUrl: "/attachments/123e4567-e89b-12d3-a456-426614174000/content",
    })).not.toHaveProperty("width");
  });
});
