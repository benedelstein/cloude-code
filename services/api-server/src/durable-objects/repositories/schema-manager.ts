import type { Repository } from "./types";

/** Runs migrate() on all registered repositories. */
export class SchemaManager {
  constructor(private repositories: Repository[]) {}

  migrate(): void {
    for (const repo of this.repositories) {
      repo.migrate();
    }
  }
}
