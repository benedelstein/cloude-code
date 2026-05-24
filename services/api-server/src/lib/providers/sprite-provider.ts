export {
  SpritesCoordinator,
  WorkersSpriteClient,
  SpriteWebsocketSession,
  SpritesError,
} from "@/lib/sprites";
export type {
  AttachSessionOptions,
  ExecResult,
  NewExecSessionOptions,
  SpriteServerMessage,
} from "@/lib/sprites";
export { buildNetworkPolicy } from "@/lib/sprites/network-policy";
export { configureGitRemote } from "@/lib/providers/git-setup-provider";
