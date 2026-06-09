import { describe, expect, it } from "vitest";
import type { Repo } from "@repo/shared";
import {
  findDirectRepoReference,
  normalizeText,
  rankRepos,
  scoreRepo,
  tokenize,
} from "../../src/modules/integrations/utils/repo-routing.utils";

function makeRepo(overrides: Partial<Repo> & { fullName: string }): Repo {
  const name = overrides.fullName.split("/")[1] ?? overrides.fullName;
  return {
    id: 1,
    name,
    fullName: overrides.fullName,
    owner: overrides.fullName.split("/")[0] ?? "owner",
    private: false,
    description: null,
    defaultBranch: "main",
    ...overrides,
  };
}

describe("normalizeText", () => {
  it("lowercases and collapses punctuation to spaces", () => {
    expect(normalizeText("Fix the Auth! (ASAP)")).toBe("fix the auth asap");
  });

  it("keeps repo name characters", () => {
    expect(normalizeText("Use owner/my-repo_v2.app")).toBe("use owner/my-repo_v2.app");
  });
});

describe("tokenize", () => {
  it("drops stop words and single characters", () => {
    const tokens = tokenize("please fix the auth in a birthday repo");
    expect(tokens).toEqual(new Set(["birthday"]));
  });

  it("deduplicates tokens", () => {
    expect(tokenize("deploy deploy deploy")).toEqual(new Set(["deploy"]));
  });
});

describe("findDirectRepoReference", () => {
  const repos = [
    makeRepo({ id: 1, fullName: "acme/birthday-app" }),
    makeRepo({ id: 2, fullName: "acme/payments" }),
  ];

  it("matches an explicit owner/name reference", () => {
    const match = findDirectRepoReference("update auth in acme/birthday-app", repos);
    expect(match?.id).toBe(1);
  });

  it("ignores case and surrounding punctuation", () => {
    const match = findDirectRepoReference("Deploy ACME/Payments!", repos);
    expect(match?.id).toBe(2);
  });

  it("returns null when no full name appears", () => {
    expect(findDirectRepoReference("update the birthday app", repos)).toBeNull();
  });
});

describe("scoreRepo", () => {
  it("scores exact full-name mentions highest", () => {
    const repo = makeRepo({ fullName: "acme/birthday-app" });
    const prompt = normalizeText("change acme/birthday-app");
    const score = scoreRepo(repo, prompt, tokenize(prompt));
    expect(score).toBeGreaterThanOrEqual(100);
  });

  it("scores name mentions above description-only matches", () => {
    const prompt = normalizeText("improve the payments flow");
    const tokens = tokenize(prompt);
    const nameMatch = scoreRepo(makeRepo({ fullName: "acme/payments" }), prompt, tokens);
    const descriptionMatch = scoreRepo(
      makeRepo({ fullName: "acme/api", description: "payments service" }),
      prompt,
      tokens,
    );
    expect(nameMatch).toBeGreaterThan(descriptionMatch);
    expect(descriptionMatch).toBeGreaterThan(0);
  });

  it("returns zero when nothing matches", () => {
    const prompt = normalizeText("write documentation");
    const score = scoreRepo(makeRepo({ fullName: "acme/payments" }), prompt, tokenize(prompt));
    expect(score).toBe(0);
  });
});

describe("rankRepos", () => {
  const repos = [
    makeRepo({ id: 1, fullName: "acme/birthday-app", description: "birthday reminders" }),
    makeRepo({ id: 2, fullName: "acme/payments" }),
    makeRepo({ id: 3, fullName: "acme/birthday-infra", description: "infra for birthday" }),
  ];

  it("orders matches by score and drops zero-score repos", () => {
    const ranked = rankRepos("change the birthday-app reminders", repos);
    expect(ranked[0]?.id).toBe(1);
    expect(ranked.map((repo) => repo.id)).not.toContain(2);
  });

  it("breaks score ties by full name", () => {
    const tied = [
      makeRepo({ id: 1, fullName: "acme/zeta-tools", description: "shared tools" }),
      makeRepo({ id: 2, fullName: "acme/alpha-tools", description: "shared tools" }),
    ];
    const ranked = rankRepos("update tools", tied);
    expect(ranked.map((repo) => repo.fullName)).toEqual([
      "acme/alpha-tools",
      "acme/zeta-tools",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(rankRepos("completely unrelated request", repos)).toEqual([]);
  });
});
