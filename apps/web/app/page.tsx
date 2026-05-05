import { cookies } from "next/headers";
import { SplashPageClient } from "./splash-page-client";

export default async function SplashPage() {
  const hasSessionCookie = Boolean(
    (await cookies()).get("session_token")?.value,
  );

  return <SplashPageClient hasSessionCookie={hasSessionCookie} />;
}
