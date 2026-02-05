const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export interface SessionResponse {
  sessionId: string;
}

export async function createSession(repoId: string): Promise<SessionResponse> {
  const res = await fetch(`${API_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repoId }),
  });

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to create session: ${res.status} ${error}`);
  }

  return res.json();
}

export async function getSession(sessionId: string): Promise<SessionResponse> {
  const res = await fetch(`${API_URL}/sessions/${sessionId}`);

  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Failed to get session: ${res.status} ${error}`);
  }

  return res.json();
}
