import { z } from "zod";

export const Repo = z.object({
  id: z.number().int(),
  name: z.string(),
  fullName: z.string(),
  owner: z.string(),
  private: z.boolean(),
  description: z.string().nullable(),
  defaultBranch: z.string(),
});
export type Repo = z.infer<typeof Repo>;

export const ListReposResponse = z.object({
  repos: z.array(Repo),
  installUrl: z.string(),
  cursor: z.string().nullable(),
});
export type ListReposResponse = z.infer<typeof ListReposResponse>;

export const SearchReposResponse = z.object({
  repos: z.array(Repo),
});
export type SearchReposResponse = z.infer<typeof SearchReposResponse>;

export const Branch = z.object({
  name: z.string(),
  default: z.boolean(),
});
export type Branch = z.infer<typeof Branch>;

export const ListBranchesResponse = z.object({
  branches: z.array(Branch),
  cursor: z.string().nullable(),
});
export type ListBranchesResponse = z.infer<typeof ListBranchesResponse>;
