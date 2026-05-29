"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Save, TriangleAlert } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createRepoEnvironment,
} from "@/lib/client-api";
import { RepoEnvironmentNetworkMode, type NetworkAccessConfig } from "@repo/shared";
import { RepoSelector } from "../../../repo-selector";
import { useRepoPicker } from "../../../use-repo-picker";
import { SettingsShell } from "../../settings-shell";
import { DefaultAllowlistSheetTrigger } from "../default-allowlist-sheet";

type FormState = {
  repoId: string;
  name: string;
  networkMode: NetworkAccessConfig["mode"];
  includeDefaultAllowlist: boolean;
  extraAllowlistText: string;
  plainEnvVarsText: string;
  startupScript: string;
};

const INITIAL_FORM: FormState = {
  repoId: "",
  name: "",
  networkMode: "default",
  includeDefaultAllowlist: true,
  extraAllowlistText: "",
  plainEnvVarsText: "",
  startupScript: "",
};

const NETWORK_MODE_LABELS = {
  locked: "No access",
  default: "Default",
  custom: "Custom",
  open: "Unrestricted",
} satisfies Record<NetworkAccessConfig["mode"], string>;

const NETWORK_MODE_DESCRIPTIONS = {
  locked: "Your agent will not be able to access the internet, except for direct requests to its inference API and git remote restricted through the proxy.",
  default: "Your agent can access the default allowlist for model providers, source control, common package registries, and development infrastructure.",
  custom: "Only allow the domains you list here. You can also include the default allowlist.",
  open: "Your agent will have unrestricted access to the internet, which poses a security risk. Confirm that you want this, or limit access to known safe domains.",
} satisfies Record<NetworkAccessConfig["mode"], string>;

export function CreateEnvironmentPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedRepoId = Number(searchParams.get("repoId"));
  const requestedRepoFullName = searchParams.get("repoFullName");
  const hasRequestedRepo = Number.isFinite(requestedRepoId) && requestedRepoId > 0;
  const {
    visibleRepos,
    installUrl,
    loading: reposLoading,
    cursor: reposCursor,
    loadingMore: reposLoadingMore,
    selectedRepo,
    setSelectedRepo,
    searchQuery: repoSearchQuery,
    setSearchQuery: setRepoSearchQuery,
    searching: repoSearchLoading,
    isSearchMode: isRepoSearchMode,
    open: repoPickerOpen,
    setOpen: setRepoPickerOpen,
    loadMore: loadMoreRepos,
  } = useRepoPicker({
    requestedRepoId: hasRequestedRepo ? requestedRepoId : null,
    requestedRepoFullName,
  });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(() => ({
    ...INITIAL_FORM,
    repoId: hasRequestedRepo ? String(requestedRepoId) : "",
  }));

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
      <form onSubmit={(event) => void handleSubmit(event)} className="flex w-full flex-col gap-6">
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

        <section className="rounded-lg border border-border bg-background">
          <FormSection title="Repository">
            <Field label="Repository" description="Environments are scoped to one repository.">
              <RepoSelector
                repos={visibleRepos}
                selectedRepo={selectedRepo}
                onSelect={(repo) => {
                  setSelectedRepo(repo);
                  setForm((current) => ({ ...current, repoId: String(repo.id) }));
                }}
                loading={reposLoading}
                disabled={saving}
                installUrl={installUrl}
                open={repoPickerOpen}
                onOpenChange={setRepoPickerOpen}
                hasMore={reposCursor !== null}
                loadingMore={reposLoadingMore}
                onLoadMore={loadMoreRepos}
                searchQuery={repoSearchQuery}
                onSearchQueryChange={setRepoSearchQuery}
                searching={repoSearchLoading}
                isSearchMode={isRepoSearchMode}
                triggerClassName="h-9 w-full max-w-none justify-start text-sm"
              />
            </Field>

            <Field label="Name">
              <Input
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Enter a name"
                disabled={saving}
                required
                maxLength={80}
                className="shadow-none"
              />
            </Field>
          </FormSection>

          <FormSection title="Network">
            <Field label="Network access">
              <Select
                value={form.networkMode}
                onValueChange={(networkMode) =>
                  setForm((current) => ({
                    ...current,
                    networkMode: networkMode as NetworkAccessConfig["mode"],
                  }))
                }
                disabled={saving}
              >
                <SelectTrigger className="bg-background shadow-none">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {RepoEnvironmentNetworkMode.options.map((networkMode) => (
                      <SelectItem key={networkMode} value={networkMode}>
                        {NETWORK_MODE_LABELS[networkMode]}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <span className="text-xs leading-5 text-foreground-muted">
                {form.networkMode === "default" ? (
                  <>
                    Your agent can access the{" "}
                    <DefaultAllowlistSheetTrigger className="align-baseline">
                      default allowlist
                    </DefaultAllowlistSheetTrigger>{" "}
                    for model providers, source control, common package registries, and development infrastructure.
                  </>
                ) : (
                  NETWORK_MODE_DESCRIPTIONS[form.networkMode]
                )}
              </span>
            </Field>

            {form.networkMode !== "locked" && (
              <InternetRiskCallout />
            )}

            {form.networkMode === "custom" && (
              <Field
                label="Allowed domains"
                description="One hostname per line."
              >
                <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <span className="grid gap-0.5">
                    <span className="text-sm text-foreground-secondary">
                      Include the default allowlist
                    </span>
                    <span className="text-xs text-foreground-muted">
                      Adds common provider, source control, package registry, and development domains.{" "}
                      <DefaultAllowlistSheetTrigger />
                    </span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={form.includeDefaultAllowlist}
                    disabled={saving}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        includeDefaultAllowlist: !current.includeDefaultAllowlist,
                      }))
                    }
                    className="relative h-6 w-11 rounded-full bg-muted transition-colors aria-checked:bg-primary disabled:opacity-50"
                  >
                    <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-background shadow transition-transform data-[checked=true]:translate-x-5" data-checked={form.includeDefaultAllowlist} />
                  </button>
                </div>
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
          </FormSection>

          <FormSection title="Runtime">
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
          </FormSection>
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

function FormSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-5 border-b border-border p-5 last:border-b-0">
      <h3 className="text-sm font-semibold text-foreground-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

function InternetRiskCallout() {
  return (
    <div className="flex gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs leading-5 text-foreground">
      <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span>
        Internet access poses security risks. Limit access to known safe domains when possible.
      </span>
    </div>
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
    <div className="grid gap-2">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {description && (
        <span className="text-xs text-foreground-muted">{description}</span>
      )}
    </div>
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
      throw new Error(
        `Invalid environment variable name: ${key}. Use shell-compatible names like API_KEY or _SECRET_1.`,
      );
    }
    vars[key] = line.slice(separatorIndex + 1);
  }
  return vars;
}

function buildNetworkConfig(form: FormState): NetworkAccessConfig {
  if (form.networkMode !== "custom") {
    return { mode: form.networkMode };
  }
  return {
    mode: "custom",
    includeDefaultAllowlist: form.includeDefaultAllowlist,
    extraAllowlist: form.extraAllowlistText
      .split(/\s|,/)
      .map((domain) => domain.trim())
      .filter(Boolean),
  };
}
