import { drainAttachmentGcQueue } from "@/modules/attachments/services/attachment-gc-service";
import type { Env } from "@/shared/types";

export function handleScheduled(
  env: Env,
  ctx: ExecutionContext,
): void {
  ctx.waitUntil(drainAttachmentGcQueue(env));
}
