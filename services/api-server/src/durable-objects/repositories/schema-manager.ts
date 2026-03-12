import type { Repository } from "./types";

/** Runs migrate() on all registered repositories. */
export function migrateAll(repositories: Repository[]): void {
  for (const repo of repositories) {
    repo.migrate();
  }
}
