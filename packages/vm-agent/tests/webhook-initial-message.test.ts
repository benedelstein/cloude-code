import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { loadInitialMessageFromFile } from "../src/lib/webhook-initial-message";

describe("loadInitialMessageFromFile", () => {
  it("loads, validates, and removes the initial message file", () => {
    const dir = mkdtempSync(join(tmpdir(), "vm-agent-message-"));
    const path = join(dir, "message.json");
    writeFileSync(
      path,
      JSON.stringify({
        content: "hello",
        attachments: [{
          filename: "image.png",
          mediaType: "image/png",
          dataUrl: "data:image/png;base64,abc",
        }],
      }),
    );

    const message = loadInitialMessageFromFile(path);

    expect(message.attachments).toHaveLength(1);
    expect(existsSync(path)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
