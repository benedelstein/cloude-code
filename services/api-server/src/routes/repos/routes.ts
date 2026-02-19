import { createRoute } from "@hono/zod-openapi";
import { ListReposResponse } from "@repo/shared";

export const listReposRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      content: { "application/json": { schema: ListReposResponse } },
      description: "List of repos with GitHub App installed",
    },
  },
});
