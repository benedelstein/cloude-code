import {
  RepoEnvironmentNetworkMode,
  type NetworkAccessConfig,
  type PlainEnvVars,
  type RepoEnvironment,
  type RepoEnvironmentSummary,
} from "@repo/shared";
import { fromSqliteDatetime } from "@/shared/utils/utils";

export interface CreateRepoEnvironmentParams {
  id: string;
  userId: string;
  repoId: number;
  repoFullName: string;
  name: string;
  network: NetworkAccessConfig;
  plainEnvVars: PlainEnvVars;
  startupScript: string | null;
}

export interface UpdateRepoEnvironmentParams {
  id: string;
  userId: string;
  repoId: number;
  name?: string;
  network?: NetworkAccessConfig;
  plainEnvVars?: PlainEnvVars;
  startupScript?: string | null;
}

interface RepoEnvironmentRow {
  id: string;
  user_id: string;
  repo_id: number;
  repo_full_name: string | null;
  name: string;
  network_mode: string;
  network_extra_allowlist_json: string;
  network_include_default_allowlist: number | null;
  plain_env_vars_json: string;
  startup_script: string | null;
  created_at: string;
  updated_at: string;
}

function rowToEnvironment(row: RepoEnvironmentRow): RepoEnvironment {
  const extraAllowlist = JSON.parse(row.network_extra_allowlist_json) as string[];
  const network = networkFromRow({
    mode: row.network_mode,
    extraAllowlist,
    includeDefaultAllowlist: row.network_include_default_allowlist === 1,
  });

  return {
    id: row.id,
    repoId: row.repo_id,
    name: row.name,
    network,
    plainEnvVars: JSON.parse(row.plain_env_vars_json) as PlainEnvVars,
    startupScript: row.startup_script,
    createdAt: fromSqliteDatetime(row.created_at),
    updatedAt: fromSqliteDatetime(row.updated_at),
  };
}

function rowToEnvironmentSummary(row: RepoEnvironmentRow): RepoEnvironmentSummary {
  return {
    ...rowToEnvironment(row),
    repoFullName: row.repo_full_name ?? String(row.repo_id),
  };
}

function networkMode(network: NetworkAccessConfig): string {
  return network.mode;
}

function extraAllowlistJson(network: NetworkAccessConfig): string {
  return JSON.stringify(
    network.mode === "custom" ? network.extraAllowlist : [],
  );
}

function includeDefaultAllowlist(network: NetworkAccessConfig): number {
  return network.mode === "custom" && network.includeDefaultAllowlist ? 1 : 0;
}

function networkFromRow(params: {
  mode: string;
  extraAllowlist: string[];
  includeDefaultAllowlist: boolean;
}): NetworkAccessConfig {
  const mode = RepoEnvironmentNetworkMode.parse(params.mode);

  switch (mode) {
    case "custom":
      return {
        mode: "custom",
        extraAllowlist: params.extraAllowlist,
        includeDefaultAllowlist: params.includeDefaultAllowlist,
      };
    case "default":
    case "locked":
    case "open":
      return { mode };
    default: {
      const exhaustiveCheck: never = mode;
      throw new Error(`Unknown repo environment network mode: ${String(exhaustiveCheck)}`);
    }
  }
}

export class RepoEnvironmentsRepository {
  constructor(private readonly database: D1Database) {}

  async listForRepo(params: {
    userId: string;
    repoId: number;
  }): Promise<RepoEnvironment[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM repo_environments
         WHERE user_id = ? AND repo_id = ?
         ORDER BY updated_at DESC, name ASC`,
      )
      .bind(params.userId, params.repoId)
      .all<RepoEnvironmentRow>();

    return (result.results ?? []).map(rowToEnvironment);
  }

  async listForUser(params: {
    userId: string;
  }): Promise<RepoEnvironmentSummary[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM repo_environments
         WHERE user_id = ?
         ORDER BY updated_at DESC, name ASC`,
      )
      .bind(params.userId)
      .all<RepoEnvironmentRow>();

    return (result.results ?? []).map(rowToEnvironmentSummary);
  }

  async getById(params: {
    id: string;
    userId: string;
    repoId: number;
  }): Promise<RepoEnvironment | null> {
    const row = await this.database
      .prepare(
        `SELECT * FROM repo_environments
         WHERE id = ? AND user_id = ? AND repo_id = ?`,
      )
      .bind(params.id, params.userId, params.repoId)
      .first<RepoEnvironmentRow>();

    return row ? rowToEnvironment(row) : null;
  }

  async getByIdForUser(params: {
    id: string;
    userId: string;
  }): Promise<RepoEnvironmentSummary | null> {
    const row = await this.database
      .prepare(
        `SELECT * FROM repo_environments
         WHERE id = ? AND user_id = ?`,
      )
      .bind(params.id, params.userId)
      .first<RepoEnvironmentRow>();

    return row ? rowToEnvironmentSummary(row) : null;
  }

  async getByNameForRepo(params: {
    userId: string;
    repoId: number;
    name: string;
    excludeId?: string;
  }): Promise<RepoEnvironment | null> {
    const row = params.excludeId
      ? await this.database
        .prepare(
          `SELECT * FROM repo_environments
           WHERE user_id = ? AND repo_id = ? AND name = ? AND id != ?`,
        )
        .bind(params.userId, params.repoId, params.name, params.excludeId)
        .first<RepoEnvironmentRow>()
      : await this.database
        .prepare(
          `SELECT * FROM repo_environments
           WHERE user_id = ? AND repo_id = ? AND name = ?`,
        )
        .bind(params.userId, params.repoId, params.name)
        .first<RepoEnvironmentRow>();

    return row ? rowToEnvironment(row) : null;
  }

  async create(params: CreateRepoEnvironmentParams): Promise<RepoEnvironment> {
    await this.database
      .prepare(
        `INSERT INTO repo_environments (
         id,
         user_id,
         repo_id,
         repo_full_name,
         name,
         network_mode,
         network_extra_allowlist_json,
         network_include_default_allowlist,
         plain_env_vars_json,
         startup_script
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        params.id,
        params.userId,
        params.repoId,
        params.repoFullName,
        params.name,
        networkMode(params.network),
        extraAllowlistJson(params.network),
        includeDefaultAllowlist(params.network),
        JSON.stringify(params.plainEnvVars),
        params.startupScript,
      )
      .run();

    const environment = await this.getById({
      id: params.id,
      userId: params.userId,
      repoId: params.repoId,
    });
    if (!environment) {
      throw new Error("Created repo environment could not be read");
    }
    return environment;
  }

  async update(params: UpdateRepoEnvironmentParams): Promise<RepoEnvironment | null> {
    const current = await this.getById({
      id: params.id,
      userId: params.userId,
      repoId: params.repoId,
    });
    if (!current) {
      return null;
    }

    const nextNetwork = params.network ?? current.network;
    const nextPlainEnvVars = params.plainEnvVars ?? current.plainEnvVars;
    await this.database
      .prepare(
        `UPDATE repo_environments
         SET name = ?,
             network_mode = ?,
             network_extra_allowlist_json = ?,
             network_include_default_allowlist = ?,
             plain_env_vars_json = ?,
             startup_script = ?,
             updated_at = datetime('now')
         WHERE id = ? AND user_id = ? AND repo_id = ?`,
      )
      .bind(
        params.name ?? current.name,
        networkMode(nextNetwork),
        extraAllowlistJson(nextNetwork),
        includeDefaultAllowlist(nextNetwork),
        JSON.stringify(nextPlainEnvVars),
        params.startupScript !== undefined
          ? params.startupScript
          : current.startupScript,
        params.id,
        params.userId,
        params.repoId,
      )
      .run();

    return this.getById({
      id: params.id,
      userId: params.userId,
      repoId: params.repoId,
    });
  }

  async delete(params: {
    id: string;
    userId: string;
    repoId: number;
  }): Promise<boolean> {
    const result = await this.database
      .prepare(
        `DELETE FROM repo_environments
         WHERE id = ? AND user_id = ? AND repo_id = ?`,
      )
      .bind(params.id, params.userId, params.repoId)
      .run();

    return result.meta.changes > 0;
  }
}
