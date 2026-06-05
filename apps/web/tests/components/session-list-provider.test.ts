import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ListSessionsResponse,
  SessionRepoGroup,
  SessionSummary,
} from "@repo/shared";

const { listSessions, useUserSessionsWebSocket } = vi.hoisted(() => ({
  listSessions: vi.fn(),
  useUserSessionsWebSocket: vi.fn(),
}));

vi.mock("@/lib/client-api", () => ({
  listSessions,
}));

vi.mock("@/hooks/use-user-sessions-websocket", () => ({
  useUserSessionsWebSocket,
}));

// Import after the mock so the provider picks up the mocked listSessions.
import {
  SessionListProvider,
  useSessionList,
  useSessionTitle,
} from "@/components/providers/session-list-provider";

type UserSessionsWebSocketOptions = {
  enabled: boolean;
  onSessionUpdated: (session: SessionSummary) => void;
  onSessionRemoved: (sessionId: string) => void;
  onResyncRequired: () => void;
};

function wrapper({ children }: { children: ReactNode }) {
  return createElement(SessionListProvider, null, children);
}

function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: overrides.id ?? "session-1",
    repoId: overrides.repoId ?? 100,
    repoFullName: overrides.repoFullName ?? "acme/repo",
    title: overrides.title ?? "Session title",
    archived: overrides.archived ?? false,
    workingState: overrides.workingState ?? "idle",
    pushedBranch: overrides.pushedBranch ?? null,
    pullRequest: overrides.pullRequest ?? null,
    createdAt: overrides.createdAt ?? "2026-05-22T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-05-22T00:00:00.000Z",
    lastMessageAt: overrides.lastMessageAt ?? "2026-05-22T00:00:00.000Z",
  };
}

function makeGroup(overrides: Partial<SessionRepoGroup> = {}): SessionRepoGroup {
  return {
    repoId: overrides.repoId ?? 100,
    repoFullName: overrides.repoFullName ?? "acme/repo",
    sessions: overrides.sessions ?? [makeSession()],
    nextSessionCursor: overrides.nextSessionCursor ?? null,
  };
}

function makeResponse(
  overrides: Partial<ListSessionsResponse> = {},
): ListSessionsResponse {
  return {
    groups: overrides.groups ?? [makeGroup()],
    nextRepoCursor: overrides.nextRepoCursor ?? null,
  };
}

async function renderProvider() {
  const hook = renderHook(() => useSessionList(), { wrapper });
  await waitFor(() => {
    expect(hook.result.current.loading).toBe(false);
  });
  return hook;
}

describe("SessionListProvider", () => {
  beforeEach(() => {
    listSessions.mockReset();
    useUserSessionsWebSocket.mockReset();
  });

  function getLatestUserSessionsWebSocketOptions(): UserSessionsWebSocketOptions {
    return useUserSessionsWebSocket.mock.calls.at(-1)?.[0] as UserSessionsWebSocketOptions;
  }

  describe("initial load", () => {
    it("populates groups and nextRepoCursor from the first listSessions call", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({ repoId: 1, repoFullName: "a/x" }),
            makeGroup({ repoId: 2, repoFullName: "b/y" }),
          ],
          nextRepoCursor: "cursor-after-page-1",
        }),
      );

      const { result } = await renderProvider();

      expect(result.current.groups.map((g) => g.repoId)).toEqual([1, 2]);
      expect(result.current.nextRepoCursor).toBe("cursor-after-page-1");
    });
  });

  describe("addSession", () => {
    it("creates a new group at the top when the repo isn't present", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [makeGroup({ repoId: 1, repoFullName: "a/x" })],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        result.current.addSession(
          makeSession({ id: "new-session", repoId: 99, repoFullName: "new/repo" }),
        );
      });

      expect(result.current.groups[0]).toMatchObject({
        repoId: 99,
        repoFullName: "new/repo",
        sessions: [{ id: "new-session" }],
      });
      expect(result.current.groups.map((g) => g.repoId)).toEqual([99, 1]);
    });

    it("prepends to an existing group AND lifts that group to the top", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({ repoId: 1, repoFullName: "a/x" }),
            makeGroup({
              repoId: 2,
              repoFullName: "b/y",
              sessions: [makeSession({ id: "existing-in-2" })],
            }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        result.current.addSession(
          makeSession({ id: "fresh", repoId: 2, repoFullName: "b/y" }),
        );
      });

      expect(result.current.groups.map((g) => g.repoId)).toEqual([2, 1]);
      expect(result.current.groups[0]?.sessions.map((s) => s.id)).toEqual([
        "fresh",
        "existing-in-2",
      ]);
    });

    it("refreshes the repo display name from the newest session", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [makeGroup({ repoId: 1, repoFullName: "old-owner/old-name" })],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        result.current.addSession(
          makeSession({
            id: "fresh",
            repoId: 1,
            repoFullName: "new-owner/new-name",
          }),
        );
      });

      expect(result.current.groups[0]?.repoFullName).toBe("new-owner/new-name");
    });
  });

  describe("removeSession", () => {
    it("removes the matching session from its group", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [
                makeSession({ id: "keep" }),
                makeSession({ id: "drop" }),
              ],
            }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        result.current.removeSession("drop");
      });

      expect(result.current.groups[0]?.sessions.map((s) => s.id)).toEqual([
        "keep",
      ]);
    });

    it("drops a group whose last session is removed AND that has no more to load", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [makeSession({ id: "only" })],
              nextSessionCursor: null,
            }),
            makeGroup({ repoId: 2 }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        result.current.removeSession("only");
      });

      expect(result.current.groups.map((g) => g.repoId)).toEqual([2]);
    });

    it("keeps an empty group when more sessions can still be loaded for it", async () => {
      // Repo with > sessionLimit sessions: after removing the last loaded one,
      // the "Show more" affordance should survive so the user can pull in the rest.
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [makeSession({ id: "only-loaded" })],
              nextSessionCursor: "still-more",
            }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        result.current.removeSession("only-loaded");
      });

      expect(result.current.groups).toHaveLength(1);
      expect(result.current.groups[0]).toMatchObject({
        repoId: 1,
        sessions: [],
        nextSessionCursor: "still-more",
      });
    });
  });

  describe("updateTitle", () => {
    it("updates the title of the matching session and leaves others untouched", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [
                makeSession({ id: "a", title: "old A" }),
                makeSession({ id: "b", title: "old B" }),
              ],
            }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        result.current.updateTitle("a", "new A");
      });

      const sessions = result.current.groups[0]?.sessions ?? [];
      expect(sessions.find((s) => s.id === "a")?.title).toBe("new A");
      expect(sessions.find((s) => s.id === "b")?.title).toBe("old B");
    });

    it("supports clearing a title to null", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              sessions: [makeSession({ id: "a", title: "old" })],
            }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        result.current.updateTitle("a", null);
      });

      expect(result.current.groups[0]?.sessions[0]?.title).toBeNull();
    });
  });

  describe("updateSessionSidebarState", () => {
    it("updates status fields for the matching session only", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [
                makeSession({ id: "a" }),
                makeSession({ id: "b" }),
              ],
            }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        result.current.updateSessionSidebarState("a", {
          workingState: "responding",
          pushedBranch: "cloude/sidebar-abcd",
          pullRequest: {
            url: "https://github.com/acme/repo/pull/7",
            number: 7,
            state: "open",
          },
        });
      });

      const sessions = result.current.groups[0]?.sessions ?? [];
      expect(sessions.find((s) => s.id === "a")).toMatchObject({
        workingState: "responding",
        pushedBranch: "cloude/sidebar-abcd",
        pullRequest: {
          number: 7,
          state: "open",
        },
      });
      expect(sessions.find((s) => s.id === "b")).toMatchObject({
        workingState: "idle",
        pushedBranch: null,
        pullRequest: null,
      });
    });
  });

  describe("user sessions websocket", () => {
    it("enables the stream after initial load", async () => {
      listSessions.mockResolvedValueOnce(makeResponse());

      await renderProvider();

      expect(getLatestUserSessionsWebSocketOptions()).toMatchObject({
        enabled: true,
      });
    });

    it("replaces a loaded session summary without reordering groups", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              repoFullName: "a/x",
              sessions: [
                makeSession({ id: "target", repoId: 1, repoFullName: "a/x" }),
              ],
            }),
            makeGroup({
              repoId: 2,
              repoFullName: "b/y",
              sessions: [
                makeSession({ id: "other", repoId: 2, repoFullName: "b/y" }),
              ],
            }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        getLatestUserSessionsWebSocketOptions().onSessionUpdated(
          makeSession({
            id: "target",
            repoId: 1,
            repoFullName: "a/renamed",
            workingState: "idle",
            pushedBranch: "cloude/sidebar-abcd",
            pullRequest: {
              url: "https://github.com/a/renamed/pull/12",
              number: 12,
              state: "open",
            },
            updatedAt: "2026-05-23T00:00:00.000Z",
          }),
        );
      });

      expect(result.current.groups.map((g) => g.repoId)).toEqual([1, 2]);
      expect(result.current.groups[0]).toMatchObject({
        repoFullName: "a/renamed",
        sessions: [{
          id: "target",
          workingState: "idle",
          pushedBranch: "cloude/sidebar-abcd",
          pullRequest: { number: 12 },
        }],
      });
    });

    it("ignores updated summaries for unloaded sessions", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({ repoId: 1, sessions: [makeSession({ id: "loaded" })] }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        getLatestUserSessionsWebSocketOptions().onSessionUpdated(
          makeSession({ id: "not-loaded", repoId: 99, repoFullName: "other/repo" }),
        );
      });

      expect(result.current.groups).toHaveLength(1);
      expect(result.current.groups[0]?.sessions.map((s) => s.id)).toEqual([
        "loaded",
      ]);
    });

    it("removes loaded sessions from stream remove messages", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [
                makeSession({ id: "keep" }),
                makeSession({ id: "drop" }),
              ],
            }),
          ],
        }),
      );

      const { result } = await renderProvider();

      act(() => {
        getLatestUserSessionsWebSocketOptions().onSessionRemoved("drop");
      });

      expect(result.current.groups[0]?.sessions.map((s) => s.id)).toEqual([
        "keep",
      ]);
    });

    it("refreshes silently when the stream asks for resync or reconnect recovery", async () => {
      listSessions
        .mockResolvedValueOnce(
          makeResponse({
            groups: [makeGroup({ repoId: 1, repoFullName: "a/x" })],
          }),
        )
        .mockResolvedValueOnce(
          makeResponse({
            groups: [makeGroup({ repoId: 2, repoFullName: "b/y" })],
          }),
        );

      const { result } = await renderProvider();

      await act(async () => {
        getLatestUserSessionsWebSocketOptions().onResyncRequired();
      });

      await waitFor(() => {
        expect(result.current.groups.map((g) => g.repoId)).toEqual([2]);
      });
      expect(result.current.loading).toBe(false);
      expect(listSessions).toHaveBeenCalledTimes(2);
    });
  });

  describe("loadMoreRepos", () => {
    it("appends incoming groups and updates nextRepoCursor", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [makeGroup({ repoId: 1 })],
          nextRepoCursor: "page-2",
        }),
      );

      const { result } = await renderProvider();

      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [makeGroup({ repoId: 2 }), makeGroup({ repoId: 3 })],
          nextRepoCursor: null,
        }),
      );

      await act(async () => {
        await result.current.loadMoreRepos();
      });

      expect(listSessions).toHaveBeenLastCalledWith({ repoCursor: "page-2" });
      expect(result.current.groups.map((g) => g.repoId)).toEqual([1, 2, 3]);
      expect(result.current.nextRepoCursor).toBeNull();
    });

    it("de-dupes incoming groups against ones already present", async () => {
      // Belt-and-suspenders: shouldn't happen at the API layer but guards
      // against accidental duplication during racey local mutations.
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [makeGroup({ repoId: 1 })],
          nextRepoCursor: "page-2",
        }),
      );

      const { result } = await renderProvider();

      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({ repoId: 1, repoFullName: "duplicate/incoming" }),
            makeGroup({ repoId: 2 }),
          ],
        }),
      );

      await act(async () => {
        await result.current.loadMoreRepos();
      });

      expect(result.current.groups.map((g) => g.repoId)).toEqual([1, 2]);
    });

    it("is a no-op when there is no nextRepoCursor", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [makeGroup({ repoId: 1 })],
          nextRepoCursor: null,
        }),
      );

      const { result } = await renderProvider();

      await act(async () => {
        await result.current.loadMoreRepos();
      });

      // Only the initial fetch should have happened.
      expect(listSessions).toHaveBeenCalledTimes(1);
    });
  });

  describe("loadMoreSessionsForRepo", () => {
    it("appends sessions to the target group and updates its cursor", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [makeSession({ id: "s1" })],
              nextSessionCursor: "after-s1",
            }),
            makeGroup({ repoId: 2 }),
          ],
        }),
      );

      const { result } = await renderProvider();

      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [makeSession({ id: "s2" }), makeSession({ id: "s3" })],
              nextSessionCursor: null,
            }),
          ],
        }),
      );

      await act(async () => {
        await result.current.loadMoreSessionsForRepo(1);
      });

      expect(listSessions).toHaveBeenLastCalledWith({
        repoId: 1,
        sessionCursor: "after-s1",
      });
      expect(result.current.groups[0]?.sessions.map((s) => s.id)).toEqual([
        "s1",
        "s2",
        "s3",
      ]);
      expect(result.current.groups[0]?.nextSessionCursor).toBeNull();
      // Untouched group stays as it was.
      expect(result.current.groups[1]?.repoId).toBe(2);
    });

    it("de-dupes incoming sessions against ones already in the group", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [makeSession({ id: "s1" })],
              nextSessionCursor: "more",
            }),
          ],
        }),
      );

      const { result } = await renderProvider();

      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({
              repoId: 1,
              sessions: [makeSession({ id: "s1" }), makeSession({ id: "s2" })],
              nextSessionCursor: null,
            }),
          ],
        }),
      );

      await act(async () => {
        await result.current.loadMoreSessionsForRepo(1);
      });

      expect(result.current.groups[0]?.sessions.map((s) => s.id)).toEqual([
        "s1",
        "s2",
      ]);
    });

    it("is a no-op when the target group has no nextSessionCursor", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({ repoId: 1, nextSessionCursor: null }),
          ],
        }),
      );

      const { result } = await renderProvider();

      await act(async () => {
        await result.current.loadMoreSessionsForRepo(1);
      });

      expect(listSessions).toHaveBeenCalledTimes(1);
    });
  });

  describe("useSessionTitle", () => {
    it("returns the title of a session living inside any group", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [
            makeGroup({ repoId: 1, sessions: [makeSession({ id: "a", title: "T-A" })] }),
            makeGroup({ repoId: 2, sessions: [makeSession({ id: "b", title: "T-B" })] }),
          ],
        }),
      );

      const { result } = renderHook(
        () => ({ title: useSessionTitle("b"), list: useSessionList() }),
        { wrapper },
      );
      await waitFor(() => {
        expect(result.current.list.loading).toBe(false);
      });

      expect(result.current.title).toBe("T-B");
    });

    it("returns null when no session matches", async () => {
      listSessions.mockResolvedValueOnce(
        makeResponse({
          groups: [makeGroup({ sessions: [makeSession({ id: "a" })] })],
        }),
      );

      const { result } = renderHook(
        () => ({ title: useSessionTitle("missing"), list: useSessionList() }),
        { wrapper },
      );
      await waitFor(() => {
        expect(result.current.list.loading).toBe(false);
      });

      expect(result.current.title).toBeNull();
    });
  });
});
