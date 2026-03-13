import type { PullRequestState } from "@repo/shared";

/** POST /pr — set initial pull request info on the DO */
export interface SetPullRequestRequest {
  url: string;
  number: number;
  state: PullRequestState;
}

/** PATCH /pr — update pull request state on the DO */
export interface UpdatePullRequestRequest {
  state: PullRequestState;
}
