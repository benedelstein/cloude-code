import { describe, expect, it } from "vitest";
import { mapPullRequestWebhookState } from "../../src/lib/github/pull-request-webhook";

describe("mapPullRequestWebhookState", () => {
  it("maps pull_request actions to cached PR states", () => {
    expect(mapPullRequestWebhookState("opened", false)).toBe("open");
    expect(mapPullRequestWebhookState("reopened", false)).toBe("open");
    expect(mapPullRequestWebhookState("synchronize", false)).toBe("open");
    expect(mapPullRequestWebhookState("edited", false)).toBe("open");
    expect(mapPullRequestWebhookState("closed", false)).toBe("closed");
    expect(mapPullRequestWebhookState("closed", true)).toBe("merged");
  });

  it("ignores pull_request actions that do not affect sidebar state", () => {
    expect(mapPullRequestWebhookState("assigned", false)).toBeNull();
  });
});
