export interface AuthContext {
  userId: string;
}

export interface AuthUser {
  id: string;
  githubId: number;
  githubLogin: string;
  githubName: string | null;
  githubAvatarUrl: string | null;
}
