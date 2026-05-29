"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  updateRepoEnvironment,
} from "@/lib/client-api";
import {
  RepoEnvironmentNetworkMode,
  type NetworkAccessConfig,
  type RepoEnvironmentSummary,
} from "@repo/shared";
import { SettingsShell } from "../../settings-shell";

type FormState = {
  name: string;
  networkMode: NetworkAccessConfig["mode"];
  extraAllowlistText: string;
  plainEnvVarsText: string;
  startupScript: string;
};

const NETWORK_MODE_LABELS = {
  default_plus_extras: "Default + extras",
  locked: "No access",
  open: "Unrestricted",
} satisfies Record<NetworkAccessConfig["mode"], string>;

export function EditEnvironmentPageClient({
  initialEnvironment,
}: {
  initialEnvironment: RepoEnvironmentSummary | null;
}) {
  const router = useRouter();
  const [environment] = useState<RepoEnvironmentSummary | null>(initialEnvironment);
  const [form, setForm] = useState<FormState | null>(
    initialEnvironment ? formFromEnvironment(initialEnvironment) : null,
  );
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!environment || !form) { return; }

    setSaving(true);
    try {
      await updateRepoEnvironment(environment.repoId, environment.id, {
        name: form.name.trim(),
        network: buildNetworkConfig(form),
        plainEnvVars: parseEnvVars(form.plainEnvVarsText),
        startupScript: form.startupScript.trim() || null,
      });
      toast.success("Environment updated");
      router.push("/settings/environments");
    } catch (error) {
      toast.error("Failed to update environment", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!environment || !form) {
    return (
      <SettingsShell>
        <div className="flex w-full flex-col gap-4">
          <Button asChild variant="ghost" size="sm" className="w-fit px-0 text-foreground-secondary shadow-none hover:bg-transparent hover:text-foreground">
            <Link href="/settings/environments">
              <ArrowLeft className="h-4 w-4" />
              Environments
            </Link>
          </Button>
          <div>
            <h2 className="text-xl font-semibold text-foreground">Environment not found</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              The environment may have been deleted.
            </p>
          </div>
        </div>
      </SettingsShell>
    );
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
            <h2 className="text-xl font-semibold text-foreground">Edit environment</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              Update setup for sessions created in {environment.repoFullName}.
            </p>
          </div>
        </div>

        <section className="grid gap-5 rounded-lg border border-border bg-background p-5">
          <Field label="Repository" description="Repository scope cannot be changed after creation.">
            <Input
              value={environment.repoFullName}
              disabled
              className="shadow-none"
            />
          </Field>

          <Field label="Name">
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((current) => current && ({ ...current, name: event.target.value }))
              }
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
                setForm((current) => current && ({
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
                  setForm((current) => current && ({
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
                setForm((current) => current && ({
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
            description="Runs from the workspace root after clone and before the first agent turn. Use this script to install dependencies or perform any pre-development setup.\nNetwork access is enabled when this script runs."
          >
            <textarea
              value={form.startupScript}
              onChange={(event) =>
                setForm((current) => current && ({
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
          <Button type="submit" disabled={saving || !form.name.trim()} className="shadow-none">
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save environment"}
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

function formFromEnvironment(environment: RepoEnvironmentSummary): FormState {
  return {
    name: environment.name,
    networkMode: environment.network.mode,
    extraAllowlistText: environment.network.mode === "default_plus_extras"
      ? environment.network.extraAllowlist.join("\n")
      : "",
    plainEnvVarsText: Object.entries(environment.plainEnvVars)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    startupScript: environment.startupScript ?? "",
  };
}

function parseEnvVars(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) { continue; }
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error("Use KEY=value for environment variables");
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
