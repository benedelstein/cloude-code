import {
  createDefaultSessionEnvironmentSnapshot,
  failure,
  type CreateRepoEnvironmentRequest,
  type DeleteRepoEnvironmentResponse,
  type ListRepoEnvironmentsResponse,
  type ListUserRepoEnvironmentsResponse,
  type RepoEnvironmentResponse,
  type Result,
  type SessionEnvironmentSnapshot,
  type UserRepoEnvironmentResponse,
  success,
  type UpdateRepoEnvironmentRequest,
} from "@repo/shared";
import type { Env } from "@/shared/types";
import { RepoEnvironmentsRepository } from "../repositories/repo-environments.repository";

type RepoEnvironmentsErrorStatus = 400 | 401 | 403 | 404 | 409 | 503;
type RepoEnvironmentSnapshotErrorStatus = Exclude<RepoEnvironmentsErrorStatus, 401>;

export interface RepoEnvironmentsServiceError<
  Status extends RepoEnvironmentsErrorStatus = RepoEnvironmentsErrorStatus,
> {
  domain: "repo_environments";
  status: Status;
  message: string;
  code?: string;
}

type RepoEnvironmentsServiceResult<
  T,
  Status extends RepoEnvironmentsErrorStatus = RepoEnvironmentsErrorStatus,
> = Result<T, RepoEnvironmentsServiceError<Status>>;

export interface RepoEnvironmentAccessProvider {
  assertUserRepoAccess(params: {
    env: Env;
    userId: string;
    repoId: number;
  }): Promise<Result<{ repoFullName: string }, {
    status: 400 | 401 | 403 | 404 | 503;
    message: string;
    code: string;
  }>>;
}

export class RepoEnvironmentsService {
  private readonly repository: RepoEnvironmentsRepository;
  private readonly env: Env;
  private readonly accessProvider: RepoEnvironmentAccessProvider;

  constructor(deps: {
    env: Env;
    accessProvider: RepoEnvironmentAccessProvider;
  }) {
    this.env = deps.env;
    this.repository = new RepoEnvironmentsRepository(deps.env.DB);
    this.accessProvider = deps.accessProvider;
  }

  async list(params: {
    userId: string;
    repoId: number;
  }): Promise<RepoEnvironmentsServiceResult<ListRepoEnvironmentsResponse>> {
    return success({
      environments: await this.repository.listForRepo(params),
    });
  }

  async listAll(params: {
    userId: string;
  }): Promise<RepoEnvironmentsServiceResult<ListUserRepoEnvironmentsResponse>> {
    return success({
      environments: await this.repository.listForUser({
        userId: params.userId,
      }),
    });
  }

  async get(params: {
    id: string;
    userId: string;
    repoId: number;
  }): Promise<RepoEnvironmentsServiceResult<RepoEnvironmentResponse>> {
    const environment = await this.repository.getForRepo(params);
    if (!environment) {
      return failure(this.error(404, "Repo environment not found"));
    }
    return success({ environment });
  }

  async getOwned(params: {
    id: string;
    userId: string;
  }): Promise<RepoEnvironmentsServiceResult<UserRepoEnvironmentResponse>> {
    const environment = await this.repository.getForUser(params);
    if (!environment) {
      return failure(this.error(404, "Repo environment not found"));
    }
    return success({ environment });
  }

  async create(params: {
    userId: string;
    repoId: number;
    request: CreateRepoEnvironmentRequest;
  }): Promise<RepoEnvironmentsServiceResult<RepoEnvironmentResponse>> {
    const accessResult = await this.assertAccess(params);
    if (!accessResult.ok) {
      return accessResult;
    }

    const result = await this.repository.create({
      id: crypto.randomUUID(),
      userId: params.userId,
      repoId: params.repoId,
      repoFullName: accessResult.value.repoFullName,
      name: params.request.name,
      network: params.request.network,
      plainEnvVars: params.request.plainEnvVars,
      startupScript: params.request.startupScript ?? null,
    });
    if (result.ok) {
      return success({ environment: result.value });
    }
    switch (result.error.code) {
      case "DUPLICATE_NAME":
        return failure(this.error(409, "A repo environment with this name already exists"));
      case "READ_FAILED":
        return failure(this.error(503, "Repo environment could not be read after creation"));
      default: {
        const exhaustiveCheck: never = result.error;
        throw new Error(`Unhandled repo environment create result: ${String(exhaustiveCheck)}`);
      }
    }
  }

  async update(params: {
    id: string;
    userId: string;
    repoId: number;
    request: UpdateRepoEnvironmentRequest;
  }): Promise<RepoEnvironmentsServiceResult<RepoEnvironmentResponse>> {
    const result = await this.repository.update({
      id: params.id,
      userId: params.userId,
      repoId: params.repoId,
      ...params.request,
    });
    if (result.ok) {
      return success({ environment: result.value });
    }
    switch (result.error.code) {
      case "NOT_FOUND":
        return failure(this.error(404, "Repo environment not found"));
      case "DUPLICATE_NAME":
        return failure(this.error(409, "A repo environment with this name already exists"));
      case "READ_FAILED":
        return failure(this.error(503, "Repo environment could not be read after update"));
      default: {
        const exhaustiveCheck: never = result.error;
        throw new Error(`Unhandled repo environment update result: ${String(exhaustiveCheck)}`);
      }
    }
  }

  async delete(params: {
    id: string;
    userId: string;
    repoId: number;
  }): Promise<RepoEnvironmentsServiceResult<DeleteRepoEnvironmentResponse>> {
    const deleted = await this.repository.delete(params);
    if (!deleted) {
      return failure(this.error(404, "Repo environment not found"));
    }
    return success({ deleted: true });
  }

  async resolveEnvironmentSnapshot(params: {
    environmentId: string | undefined;
    userId: string;
    repoId: number;
  }): Promise<RepoEnvironmentsServiceResult<
    SessionEnvironmentSnapshot,
    RepoEnvironmentSnapshotErrorStatus
  >> {
    const resolvedAt = new Date().toISOString();
    if (!params.environmentId) {
      return success(createDefaultSessionEnvironmentSnapshot({
        repoId: params.repoId,
        resolvedAt,
      }));
    }

    const environment = await this.repository.getForRepo({
      id: params.environmentId,
      userId: params.userId,
      repoId: params.repoId,
    });
    if (!environment) {
      return failure(this.error(400, "Repo environment does not belong to the selected repository"));
    }

    return success({
      sourceEnvironmentId: environment.id,
      sourceEnvironmentName: environment.name,
      repoId: environment.repoId,
      network: environment.network,
      plainEnvVars: environment.plainEnvVars,
      startupScript: environment.startupScript,
      resolvedAt,
      schemaVersion: 1,
    });
  }

  private async assertAccess(params: {
    userId: string;
    repoId: number;
  }): Promise<RepoEnvironmentsServiceResult<
    { repoFullName: string },
    400 | 401 | 403 | 404 | 503
  >> {
    const result = await this.accessProvider.assertUserRepoAccess({
      env: this.env,
      userId: params.userId,
      repoId: params.repoId,
    });
    if (result.ok) {
      return success(result.value);
    }
    return failure(this.error(
      result.error.status,
      result.error.message,
      result.error.code,
    ));
  }

  private error<Status extends RepoEnvironmentsErrorStatus>(
    status: Status,
    message: string,
    code?: string,
  ): RepoEnvironmentsServiceError<Status> {
    return {
      domain: "repo_environments",
      status,
      message,
      code,
    };
  }
}
