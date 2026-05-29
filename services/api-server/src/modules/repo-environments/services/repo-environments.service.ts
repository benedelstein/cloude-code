import {
  createDefaultSessionRuntimeConfig,
  failure,
  type CreateRepoEnvironmentRequest,
  type DeleteRepoEnvironmentResponse,
  type ListRepoEnvironmentsResponse,
  type ListUserRepoEnvironmentsResponse,
  type RepoEnvironmentResponse,
  type Result,
  type SessionRuntimeConfigSnapshot,
  success,
  type UpdateRepoEnvironmentRequest,
} from "@repo/shared";
import type { Env } from "@/shared/types";
import { RepoEnvironmentsRepository } from "../repositories/repo-environments.repository";

type RepoEnvironmentStatus = 400 | 403 | 404 | 409 | 503;

export interface RepoEnvironmentsServiceError {
  domain: "repo_environments";
  status: RepoEnvironmentStatus;
  message: string;
  code?: string;
}

type RepoEnvironmentsServiceResult<T> = Result<T, RepoEnvironmentsServiceError>;

export interface RepoEnvironmentAccessProvider {
  assertUserRepoAccess(params: {
    env: Env;
    userId: string;
    repoId: number;
    githubAccessToken: string;
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
    githubAccessToken: string;
    repoId: number;
  }): Promise<RepoEnvironmentsServiceResult<ListRepoEnvironmentsResponse>> {
    const accessResult = await this.assertAccess(params);
    if (!accessResult.ok) {
      return accessResult;
    }

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
    githubAccessToken: string;
    repoId: number;
  }): Promise<RepoEnvironmentsServiceResult<RepoEnvironmentResponse>> {
    const accessResult = await this.assertAccess(params);
    if (!accessResult.ok) {
      return accessResult;
    }

    const environment = await this.repository.getById(params);
    if (!environment) {
      return failure(this.error(404, "Repo environment not found"));
    }
    return success({ environment });
  }

  async create(params: {
    userId: string;
    githubAccessToken: string;
    repoId: number;
    request: CreateRepoEnvironmentRequest;
  }): Promise<RepoEnvironmentsServiceResult<RepoEnvironmentResponse>> {
    const accessResult = await this.assertAccess(params);
    if (!accessResult.ok) {
      return accessResult;
    }

    try {
      const environment = await this.repository.create({
        id: crypto.randomUUID(),
        userId: params.userId,
        repoId: params.repoId,
        repoFullName: accessResult.value.repoFullName,
        name: params.request.name,
        network: params.request.network,
        plainEnvVars: params.request.plainEnvVars,
        startupScript: params.request.startupScript ?? null,
      });
      return success({ environment });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return failure(this.error(409, "A repo environment with this name already exists"));
      }
      throw error;
    }
  }

  async update(params: {
    id: string;
    userId: string;
    githubAccessToken: string;
    repoId: number;
    request: UpdateRepoEnvironmentRequest;
  }): Promise<RepoEnvironmentsServiceResult<RepoEnvironmentResponse>> {
    const accessResult = await this.assertAccess(params);
    if (!accessResult.ok) {
      return accessResult;
    }

    try {
      const environment = await this.repository.update({
        id: params.id,
        userId: params.userId,
        repoId: params.repoId,
        ...params.request,
      });
      if (!environment) {
        return failure(this.error(404, "Repo environment not found"));
      }
      return success({ environment });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return failure(this.error(409, "A repo environment with this name already exists"));
      }
      throw error;
    }
  }

  async delete(params: {
    id: string;
    userId: string;
    githubAccessToken: string;
    repoId: number;
  }): Promise<RepoEnvironmentsServiceResult<DeleteRepoEnvironmentResponse>> {
    const accessResult = await this.assertAccess(params);
    if (!accessResult.ok) {
      return accessResult;
    }

    const deleted = await this.repository.delete(params);
    if (!deleted) {
      return failure(this.error(404, "Repo environment not found"));
    }
    return success({ deleted: true });
  }

  async resolveRuntimeConfig(params: {
    environmentId: string | undefined;
    userId: string;
    repoId: number;
  }): Promise<RepoEnvironmentsServiceResult<SessionRuntimeConfigSnapshot>> {
    const resolvedAt = new Date().toISOString();
    if (!params.environmentId) {
      return success(createDefaultSessionRuntimeConfig({
        repoId: params.repoId,
        resolvedAt,
      }));
    }

    const environment = await this.repository.getById({
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
    githubAccessToken: string;
  }): Promise<RepoEnvironmentsServiceResult<{ repoFullName: string }>> {
    const result = await this.accessProvider.assertUserRepoAccess({
      env: this.env,
      userId: params.userId,
      repoId: params.repoId,
      githubAccessToken: params.githubAccessToken,
    });
    if (result.ok) {
      return success(result.value);
    }
    return failure(this.error(
      result.error.status === 401 ? 403 : result.error.status,
      result.error.message,
      result.error.code,
    ));
  }

  private error(
    status: RepoEnvironmentStatus,
    message: string,
    code?: string,
  ): RepoEnvironmentsServiceError {
    return {
      domain: "repo_environments",
      status,
      message,
      code,
    };
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("unique");
}
