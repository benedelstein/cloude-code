import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserInfo } from "@repo/shared";
import { decryptCookieValue } from "@/lib/session";
import { getAuthenticatedUser, ServerApiError } from "@/lib/server-api";

export const getSessionToken = cache(async (): Promise<string | null> => {
  const encryptedToken = (await cookies()).get("session_token")?.value;
  return decryptCookieValue(encryptedToken);
});

/**
 * Data access layer for verifying the session token.
 * This runs server-side and calls the API server directly (not through the
 * Next.js proxy) because there is no browser cookie jar available here.
 * https://nextjs.org/docs/app/guides/authentication#creating-a-data-access-layer-dal
 */
export const getVerifiedSessionToken = cache(async (): Promise<string> => {
  const sessionToken = await getSessionToken();

  if (!sessionToken) {
    redirect("/");
  }

  return sessionToken;
});

export const verifySession = cache(async (): Promise<UserInfo> => {
  const sessionToken = await getVerifiedSessionToken();

  try {
    return await getAuthenticatedUser(sessionToken);
  } catch (cause) {
    if (cause instanceof ServerApiError && cause.status === 401) {
      redirect("/");
    }
    throw new Error("Failed to verify session", { cause });
  }
});
