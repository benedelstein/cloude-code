// OpenAI OAuth callback — path must be /auth/callback to match
// the redirect_uri pattern allowed by the Codex CLI OAuth client.
export { GET } from "@/app/api/auth/openai/callback/route";
