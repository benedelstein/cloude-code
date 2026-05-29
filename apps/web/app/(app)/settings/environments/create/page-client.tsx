"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createRepoEnvironment,
  listRepos,
  type Repo,
} from "@/lib/client-api";
import { RepoEnvironmentNetworkMode, type NetworkAccessConfig } from "@repo/shared";
import { SettingsShell } from "../../settings-shell";

type FormState = {
  repoId: string;
  name: string;
  networkMode: NetworkAccessConfig["mode"];
  extraAllowlistText: string;
  plainEnvVarsText: string;
  startupScript: string;
};

const INITIAL_FORM: FormState = {
  repoId: "",
  name: "",
  networkMode: "default_plus_extras",
  extraAllowlistText: "",
  plainEnvVarsText: "",
  startupScript: "",
};

const NETWORK_MODE_LABELS = {
  default_plus_extras: "Default + extras",
  locked: "No access",
  open: "Unrestricted",
} satisfies Record<NetworkAccessConfig["mode"], string>;

export function CreateEnvironmentPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRepoId = searchParams.get("repoId");
  const requestedRepoFullName = searchParams.get("repoFullName");
  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposCursor, setReposCursor] = useState<string | null>(null);
  const [reposLoading, setReposLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    ...INITIAL_FORM,
    repoId: requestedRepoId ?? "",
  }));

  useEffect(() => {
    let stale = false;
    setReposLoading(true);
    (async () => {
      try {
        const data = await listRepos({ limit: 100 });
        if (stale) { return; }
        const nextRepos = data.repos;
        if (
          requestedRepoId
          && requestedRepoFullName
          && !nextRepos.some((repo) => repo.id === Number(requestedRepoId))
        ) {
          nextRepos.unshift({
            id: Number(requestedRepoId),
            name: repoDisplayName(requestedRepoFullName),
            fullName: requestedRepoFullName,
            owner: requestedRepoFullName.split("/")[0] ?? "",
            private: false,
            description: null,
            defaultBranch: "",
          });
        }
        setRepos(nextRepos);
        setReposCursor(data.cursor);
      } catch (error) {
        if (!stale) {
          toast.error("Failed to load repositories", {
            description: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } finally {
        if (!stale) {
          setReposLoading(false);
        }
      }
    })();

    return () => {
      stale = true;
    };
  }, [requestedRepoFullName, requestedRepoId]);

  const selectedRepo = useMemo(() => {
    const repoId = Number(form.repoId);
    return repos.find((repo) => repo.id === repoId) ?? null;
  }, [form.repoId, repos]);

  async function loadMoreRepos(): Promise<void> {
    if (!reposCursor || reposLoading) { return; }
    setReposLoading(true);
    try {
      const data = await listRepos({ cursor: reposCursor, limit: 100 });
      setRepos((current) => mergeRepos(current, data.repos));
      setReposCursor(data.cursor);
    } catch (error) {
      toast.error("Failed to load more repositories", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setReposLoading(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const repoId = Number(form.repoId);
    if (!Number.isFinite(repoId) || repoId <= 0) {
      toast.error("Select a repository");
      return;
    }

    setSaving(true);
    try {
      await createRepoEnvironment(repoId, {
        name: form.name.trim(),
        network: buildNetworkConfig(form),
        plainEnvVars: parseEnvVars(form.plainEnvVarsText),
        startupScript: form.startupScript.trim() || null,
      });
      toast.success("Environment created");
      router.push("/settings/environments");
    } catch (error) {
      toast.error("Failed to create environment", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsShell>
      <form onSubmit={(event) => void handleSubmit(event)} className="flex max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-4 border-b border-border pb-4">
          <Button asChild variant="ghost" size="sm" className="w-fit px-0 text-foreground-secondary shadow-none hover:bg-transparent hover:text-foreground">
            <Link href="/settings/environments">
              <ArrowLeft className="h-4 w-4" />
              Environments
            </Link>
          </Button>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Create environment</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              Configure startup behavior for sessions created in a repository.
            </p>
          </div>
        </div>

        <section className="grid gap-5 rounded-lg border border-border bg-background p-5">
          <Field label="Repository" description="Environments are scoped to one repository.">
            <select
              value={form.repoId}
              onChange={(event) =>
                setForm((current) => ({ ...current, repoId: event.target.value }))
              }
              disabled={reposLoading || saving}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none disabled:opacity-50"
              required
            >
              <option value="">
                {reposLoading ? "Loading repositories..." : "Select repository"}
              </option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.fullName}
                </option>
              ))}
            </select>
            {reposCursor && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 shadow-none"
                disabled={reposLoading}
                onClick={() => void loadMoreRepos()}
              >
                Load more repositories
              </Button>
            )}
          </Field>

          <Field label="Name">
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              placeholder={selectedRepo ? repoDisplayName(selectedRepo.fullName) : "Web app"}
              disabled={saving}
              required
              maxLength={80}
              className="shadow-none"
            />
          </Field>

          <Field label="Network access">
            <select
              value={form.networkMode}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  networkMode: event.target.value as NetworkAccessConfig["mode"],
                }))
              }
              disabled={saving}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none disabled:opacity-50"
            >
              {RepoEnvironmentNetworkMode.options.map((networkMode) => (
                <option key={networkMode} value={networkMode}>
                  {NETWORK_MODE_LABELS[networkMode]}
                </option>
              ))}
            </select>
          </Field>

          {form.networkMode === "default_plus_extras" && (
            <Field
              label="Extra allowed domains"
              description="One hostname per line. Default provider and platform access is included."
            >
              <textarea
                value={form.extraAllowlistText}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    extraAllowlistText: event.target.value,
                  }))
                }
                rows={4}
                placeholder="registry.npmjs.org"
                disabled={saving}
                className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
            </Field>
          )}

          <Field
            label="Environment variables"
            description="Environment variables are stored in plaintext. Do not store secrets here."
          >
            <textarea
              value={form.plainEnvVarsText}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  plainEnvVarsText: event.target.value,
                }))
              }
              rows={4}
              placeholder="NEXT_PUBLIC_API_URL=https://example.com"
              disabled={saving}
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </Field>

          <Field
            label="Startup script"
            description="Runs from the workspace root after clone and before the first agent turn. Use this script to install dependencies or perform any pre-development setup."
          >
            <textarea
              value={form.startupScript}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  startupScript: event.target.value,
                }))
              }
              rows={8}
              placeholder="pnpm install"
              disabled={saving}
              className="min-h-44 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </Field>
        </section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button asChild variant="outline" className="shadow-none">
            <Link href="/settings/environments">Cancel</Link>
          </Button>
          <Button type="submit" disabled={saving || !form.name.trim() || !form.repoId} className="shadow-none">
            <Save className="h-4 w-4" />
            {saving ? "Creating..." : "Create environment"}
          </Button>
        </div>
      </form>
    </SettingsShell>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {description && (
        <span className="text-xs text-foreground-muted">{description}</span>
      )}
    </label>
  );
}

function parseEnvVars(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) { continue; }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error("Use KEY=value for plain env vars");
    }
    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }
    vars[key] = line.slice(separatorIndex + 1);
  }
  return vars;
}

function buildNetworkConfig(form: FormState): NetworkAccessConfig {
  if (form.networkMode !== "default_plus_extras") {
    return { mode: form.networkMode };
  }
  return {
    mode: "default_plus_extras",
    extraAllowlist: form.extraAllowlistText
      .split(/\s|,/)
      .map((domain) => domain.trim())
      .filter(Boolean),
  };
}

function repoDisplayName(repoFullName: string): string {
  return repoFullName.split("/").pop() ?? repoFullName;
}

function mergeRepos(existingRepos: Repo[], incomingRepos: Repo[]): Repo[] {
  const reposById = new Map<number, Repo>();
  for (const repo of existingRepos) {
    reposById.set(repo.id, repo);
  }
  for (const repo of incomingRepos) {
    reposById.set(repo.id, repo);
  }
  return Array.from(reposById.values());
}
