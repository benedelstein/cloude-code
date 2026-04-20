import dotenv from "dotenv";

dotenv.config();

const API_URL = process.env.API_URL ?? "http://localhost:8787";

type CreateSessionResponse = {
  sessionId: string;
  title: string | null;
  websocketToken: string;
  websocketTokenExpiresAt: string;
};

function parseRepoId(rawValue: string | undefined): number {
  const repoId = Number(rawValue ?? process.env.REPO_ID);
  if (!Number.isInteger(repoId) || repoId <= 0) {
    throw new Error("Provide a numeric repo ID as the first argument or set REPO_ID.");
  }
  return repoId;
}

async function createSession(repoId: number): Promise<CreateSessionResponse> {
  const response = await fetch(`${API_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create session: ${response.status} ${errorText}`);
  }

  return response.json() as Promise<CreateSessionResponse>;
}

async function main(): Promise<void> {
  const repoId = parseRepoId(process.argv[2]);
  console.log(`API URL: ${API_URL}`);
  console.log(`Creating session for repo ID: ${repoId}`);

  const session = await createSession(repoId);
  console.log(JSON.stringify(session, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
