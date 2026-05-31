import { redirect } from "next/navigation";
import { getSessionToken } from "@/lib/auth";
import { getAuthenticatedUser, ServerApiError } from "@/lib/server-api";
import { SplashPageClient } from "./splash-page-client";

export default async function SplashPage() {
  const sessionToken = await getSessionToken();
  let hasSessionCookie = sessionToken !== null;

  if (sessionToken) {
    let isAuthenticated = false;

    try {
      await getAuthenticatedUser(sessionToken);
      isAuthenticated = true;
    } catch (cause) {
      if (!(cause instanceof ServerApiError && cause.status === 401)) {
        throw new Error("Failed to verify session", { cause });
      }

      hasSessionCookie = false;
    }

    if (isAuthenticated) {
      redirect("/dashboard");
    }
  }

  return <SplashPageClient hasSessionCookie={hasSessionCookie} />;
}
