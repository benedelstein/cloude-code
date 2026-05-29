import { OpenAPIHono } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { AuthUser } from "@/shared/types/auth";
import type { Env } from "@/shared/types";
import type { RepoEnvironmentsService } from "../services/repo-environments.service";
import {
  createRepoEnvironmentRoute,
  deleteRepoEnvironmentRoute,
  getRepoEnvironmentRoute,
  listRepoEnvironmentsRoute,
  listUserRepoEnvironmentsRoute,
  updateRepoEnvironmentRoute,
} from "./repo-environments.schema";

type RepoEnvironmentsRouteEnv = {
  Bindings: Env;
  Variables: { user: AuthUser };
};

export interface RepoEnvironmentsRouteDeps {
  authMiddleware: MiddlewareHandler<RepoEnvironmentsRouteEnv>;
  createRepoEnvironmentsService(env: Env): RepoEnvironmentsService;
}

export function createRepoEnvironmentsRoutes(
  deps: RepoEnvironmentsRouteDeps,
): OpenAPIHono<RepoEnvironmentsRouteEnv> {
  const routes = new OpenAPIHono<RepoEnvironmentsRouteEnv>();

  routes.use("*", deps.authMiddleware);

  routes.openapi(listRepoEnvironmentsRoute, async (c) => {
    const user = c.get("user");
    const { repoId } = c.req.valid("param");
    const result = await deps.createRepoEnvironmentsService(c.env).list({
      userId: user.id,
      githubAccessToken: user.githubAccessToken,
      repoId,
    });
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json(result.value, 200);
  });

  routes.openapi(createRepoEnvironmentRoute, async (c) => {
    const user = c.get("user");
    const { repoId } = c.req.valid("param");
    const result = await deps.createRepoEnvironmentsService(c.env).create({
      userId: user.id,
      githubAccessToken: user.githubAccessToken,
      repoId,
      request: c.req.valid("json"),
    });
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json(result.value, 201);
  });

  routes.openapi(getRepoEnvironmentRoute, async (c) => {
    const user = c.get("user");
    const { repoId, environmentId } = c.req.valid("param");
    const result = await deps.createRepoEnvironmentsService(c.env).get({
      id: environmentId,
      userId: user.id,
      githubAccessToken: user.githubAccessToken,
      repoId,
    });
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json(result.value, 200);
  });

  routes.openapi(updateRepoEnvironmentRoute, async (c) => {
    const user = c.get("user");
    const { repoId, environmentId } = c.req.valid("param");
    const result = await deps.createRepoEnvironmentsService(c.env).update({
      id: environmentId,
      userId: user.id,
      githubAccessToken: user.githubAccessToken,
      repoId,
      request: c.req.valid("json"),
    });
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json(result.value, 200);
  });

  routes.openapi(deleteRepoEnvironmentRoute, async (c) => {
    const user = c.get("user");
    const { repoId, environmentId } = c.req.valid("param");
    const result = await deps.createRepoEnvironmentsService(c.env).delete({
      id: environmentId,
      userId: user.id,
      githubAccessToken: user.githubAccessToken,
      repoId,
    });
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json(result.value, 200);
  });

  return routes;
}

export function createUserRepoEnvironmentsRoutes(
  deps: RepoEnvironmentsRouteDeps,
): OpenAPIHono<RepoEnvironmentsRouteEnv> {
  const routes = new OpenAPIHono<RepoEnvironmentsRouteEnv>();

  routes.use("*", deps.authMiddleware);

  routes.openapi(listUserRepoEnvironmentsRoute, async (c) => {
    const user = c.get("user");
    const result = await deps.createRepoEnvironmentsService(c.env).listAll({
      userId: user.id,
    });
    if (!result.ok) {
      return errorResponse(c, result.error);
    }
    return c.json(result.value, 200);
  });

  return routes;
}

function errorResponse(
  c: Parameters<Parameters<OpenAPIHono<RepoEnvironmentsRouteEnv>["openapi"]>[1]>[0],
  error: {
    status: 400 | 403 | 404 | 409 | 503;
    message: string;
    code?: string;
  },
) {
  return c.json({
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
  }, error.status);
}
