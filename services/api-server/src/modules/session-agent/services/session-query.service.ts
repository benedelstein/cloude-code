import {
  failure,
  success,
  type ClientState,
  type SessionInfoResponse,
  type SessionPlanResponse,
} from "@repo/shared";
import type {
  HandleGetMessagesResult,
  HandleGetPlanResult,
  HandleGetSessionResult,
} from "@/shared/types/session-agent";
import type { LatestPlanRepository } from "../repositories/latest-plan.repository";
import type { MessageRepository } from "../repositories/message.repository";
import type { ServerState } from "../repositories/server-state.repository";

export interface SessionQueryServiceDeps {
  messageRepository: MessageRepository;
  latestPlanRepository: LatestPlanRepository;
  getServerState: () => ServerState;
  getClientState: () => ClientState;
}

export class SessionQueryService {
  private readonly messageRepository: MessageRepository;
  private readonly latestPlanRepository: LatestPlanRepository;
  private readonly getServerState: () => ServerState;
  private readonly getClientState: () => ClientState;

  constructor(deps: SessionQueryServiceDeps) {
    this.messageRepository = deps.messageRepository;
    this.latestPlanRepository = deps.latestPlanRepository;
    this.getServerState = deps.getServerState;
    this.getClientState = deps.getClientState;
  }

  handleGetSession(): HandleGetSessionResult {
    const serverState = this.getServerState();
    const clientState = this.getClientState();
    const sessionId = serverState.sessionId;
    if (!sessionId || !clientState.repoFullName) {
      return failure({ code: "SESSION_NOT_INITIALIZED", message: "Session not found" });
    }
    const pullRequest = clientState.pullRequest?.status === "created" ? clientState.pullRequest : null;

    return success({
      sessionId,
      title: null,
      status: clientState.status,
      repoFullName: clientState.repoFullName,
      baseBranch: clientState.baseBranch ?? undefined,
      pushedBranch: clientState.pushedBranch ?? undefined,
      pullRequestUrl: pullRequest?.url ?? undefined,
      pullRequestNumber: pullRequest?.number ?? undefined,
      pullRequestState: pullRequest?.state ?? undefined,
      editorUrl: clientState.editorUrl ?? undefined,
    } satisfies SessionInfoResponse);
  }

  handleGetMessages(): HandleGetMessagesResult {
    const sessionId = this.getServerState().sessionId;
    if (!sessionId) {
      return failure({ code: "SESSION_NOT_INITIALIZED", message: "Session not found" });
    }

    return success(
      this.messageRepository
        .getAllBySession(sessionId)
        .map((message) => message.message),
    );
  }

  handleGetPlan(): HandleGetPlanResult {
    const sessionId = this.getServerState().sessionId;
    if (!sessionId) {
      return failure({ code: "SESSION_NOT_INITIALIZED", message: "Session not found" });
    }

    const latestPlan = this.latestPlanRepository.getBySession(sessionId);
    if (!latestPlan) {
      return failure({ code: "PLAN_NOT_FOUND", message: "Plan not found" });
    }

    return success({
      plan: latestPlan.plan,
      updatedAt: latestPlan.updatedAt,
      sourceMessageId: latestPlan.sourceMessageId,
    } satisfies SessionPlanResponse);
  }
}
