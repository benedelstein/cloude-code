import { z } from "zod";

export const USER_SESSIONS_USER_ID_HEADER = "X-User-Id";

export const UserSessionsSessionRpcRequestSchema = z.object({
  userId: z.uuid(),
  sessionId: z.uuid(),
});
export type UserSessionsSessionRpcRequest = z.infer<
  typeof UserSessionsSessionRpcRequestSchema
>;

export const UserSessionsUserRpcRequestSchema = z.object({
  userId: z.uuid(),
});
export type UserSessionsUserRpcRequest = z.infer<
  typeof UserSessionsUserRpcRequestSchema
>;

export interface UserSessionsRpc {
  createSessionSummary(
    request: UserSessionsSessionRpcRequest,
  ): Promise<void>;
  invalidateSessionSummary(
    request: UserSessionsSessionRpcRequest,
  ): Promise<void>;
  removeSessionSummary(request: UserSessionsSessionRpcRequest): Promise<void>;
  requestResync(request: UserSessionsUserRpcRequest): Promise<void>;
}
