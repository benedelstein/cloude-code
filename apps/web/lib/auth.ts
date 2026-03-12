import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserInfo } from "@repo/shared";
import { decryptSessionToken } from "@/lib/session";
import { getAuthenticatedUser, ServerApiError } from "@/lib/server-api";

/**
 * Data access layer for verifying the session token.
 * This runs server-side and calls the API server directly (not through the
 * Next.js proxy) because there is no browser cookie jar available here.
 * https://nextjs.org/docs/app/guides/authentication#creating-a-data-access-layer-dal
 */
export const verifySession = cache(async (): Promise<UserInfo> => {
  const encryptedToken = (await cookies()).get("session_token")?.value;
  const sessionToken = await decryptSessionToken(encryptedToken);

  if (!sessionToken) {
    redirect("/login");
  }

  try {
    return await getAuthenticatedUser(sessionToken);
  } catch (cause) {
    if (cause instanceof ServerApiError && cause.status === 401) {
      redirect("/login");
    }
    throw new Error("Failed to verify session", { cause });
  }
});
