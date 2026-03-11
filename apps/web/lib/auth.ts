import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { UserInfo } from "@repo/shared";
import { decryptSessionToken } from "@/lib/session";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * Data access layer for verifying the session token.
 * This runs server-side before allowing a user to access authenticated routes.
 * https://nextjs.org/docs/app/guides/authentication#creating-a-data-access-layer-dal
 */
export const verifySession = cache(async (): Promise<UserInfo> => {
  if (!API_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is not set");
  }

  const encryptedToken = (await cookies()).get("session_token")?.value;
  const sessionToken = await decryptSessionToken(encryptedToken);

  if (!sessionToken) {
    redirect("/login");
  }

  const response = await fetch(`${API_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${sessionToken}`,
    },
    cache: "no-store",
  });

  if (response.status === 401) {
    redirect("/login");
  }

  if (!response.ok) {
    throw new Error(`Failed to verify session: ${response.status}`);
  }

  return response.json();
});
