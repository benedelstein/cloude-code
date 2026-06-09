import type { Result } from "@repo/shared";

export type RepoAccessValue = {
  userId: string;
  repoId: number;
  installationId: number;
  repoFullName: string;
};

export type UserRepoAccessError =
  | {
      code: "INSTALLATION_NOT_FOUND";
      status: 403;
      message: string;
    }
  | {
      code: "REPO_NOT_ACCESSIBLE";
      status: 403;
      message: string;
    }
  | {
      code: "INVALID_REPO";
      status: 400;
      message: string;
    }
  | {
      code: "GITHUB_API_ERROR";
      status: 503;
      message: string;
    }
  | {
      code: "GITHUB_AUTH_ERROR";
      status: 401;
      message: string;
    }
  | {
      code: "GITHUB_AUTH_REQUIRED";
      status: 401;
      message: string;
    }
  | {
      code: "GITHUB_UNAVAILABLE";
      status: 503;
      message: string;
    };

export type UserRepoAccessResult = Result<RepoAccessValue, UserRepoAccessError>;

export type SessionRepoAccessError =
  | {
      code: "SESSION_NOT_FOUND";
      status: 404;
      message: string;
    }
  | {
      code: "GITHUB_AUTH_REQUIRED";
      status: 401;
      message: string;
    }
  | {
      code: "GITHUB_UNAVAILABLE";
      status: 503;
      message: string;
    }
  | {
      code: "REPO_ACCESS_BLOCKED";
      status: 403;
      message: string;
      justBlocked: boolean;
    }
  | {
      code: "GITHUB_API_ERROR";
      status: 503;
      message: string;
    }
  | {
      code: "INVALID_REPO";
      status: 400;
      message: string;
    };

export type SessionRepoAccessResult = Result<RepoAccessValue, SessionRepoAccessError>;
