import { z } from "zod";

export const Repo = z.object({
  id: z.number(),
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
});
export type ListReposResponse = z.infer<typeof ListReposResponse>;
