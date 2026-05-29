"use client";

import { useEffect, useState } from "react";
import { Plus, Save, Settings2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createRepoEnvironment,
  deleteRepoEnvironment,
  listRepoEnvironments,
  updateRepoEnvironment,
  type CreateRepoEnvironmentRequest,
  type Repo,
} from "@/lib/client-api";
import type { NetworkAccessConfig, RepoEnvironment } from "@repo/shared";

type EnvironmentDraft = {
  id: string | null;
  name: string;
  networkMode: NetworkAccessConfig["mode"];
  extraAllowlistText: string;
  plainEnvVarsText: string;
  startupScript: string;
};

function emptyEnvironmentDraft(): EnvironmentDraft {
  return {
    id: null,
    name: "",
    networkMode: "default_plus_extras",
    extraAllowlistText: "",
    plainEnvVarsText: "",
    startupScript: "",
  };
}

function draftFromEnvironment(environment: RepoEnvironment): EnvironmentDraft {
  return {
    id: environment.id,
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
      throw new Error("Use KEY=value for plain env vars");
    }
    const key = line.slice(0, separatorIndex).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new Error(`Invalid env var name: ${key}`);
    }
    vars[key] = line.slice(separatorIndex + 1);
  }
  return vars;
}

function buildEnvironmentRequest(draft: EnvironmentDraft): CreateRepoEnvironmentRequest {
  const extraAllowlist = draft.extraAllowlistText
    .split(/\s|,/)
    .map((domain) => domain.trim())
    .filter(Boolean);
  const network: NetworkAccessConfig = draft.networkMode === "default_plus_extras"
    ? { mode: "default_plus_extras", extraAllowlist }
    : { mode: draft.networkMode };

  return {
    name: draft.name.trim(),
    network,
    plainEnvVars: parseEnvVars(draft.plainEnvVarsText),
    startupScript: draft.startupScript.trim() || null,
  };
}

export function SessionEnvironmentSelector({
  selectedRepo,
  disabled,
  selectedEnvironmentId,
  onSelectEnvironment,
}: {
  selectedRepo: Repo | null;
  disabled: boolean;
  selectedEnvironmentId: string | null;
  onSelectEnvironment(environmentId: string | null): void;
}) {
  const [environments, setEnvironments] = useState<RepoEnvironment[]>([]);
  const [loading, setLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [draft, setDraft] = useState<EnvironmentDraft>(() => emptyEnvironmentDraft());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedRepo) {
      setEnvironments([]);
      onSelectEnvironment(null);
      setEditorOpen(false);
      setDraft(emptyEnvironmentDraft());
      return;
    }

    let stale = false;
    setLoading(true);
    onSelectEnvironment(null);
    setDraft(emptyEnvironmentDraft());
    (async () => {
      try {
        const data = await listRepoEnvironments(selectedRepo.id);
        if (stale) { return; }
        setEnvironments(data.environments);
      } catch (error) {
        if (!stale) {
          toast.error("Failed to load environments", {
            description: error instanceof Error ? error.message : "Unknown error",
          });
        }
      } finally {
        if (!stale) {
          setLoading(false);
        }
      }
    })();

    return () => {
      stale = true;
    };
  }, [onSelectEnvironment, selectedRepo]);

  const selectedEnvironment = environments.find((environment) =>
    environment.id === selectedEnvironmentId,
  ) ?? null;

  async function saveEnvironment(): Promise<void> {
    if (!selectedRepo) { return; }
    setSaving(true);
    try {
      const request = buildEnvironmentRequest(draft);
      const response = draft.id
        ? await updateRepoEnvironment(selectedRepo.id, draft.id, request)
        : await createRepoEnvironment(selectedRepo.id, request);
      setEnvironments((current) => {
        const withoutSaved = current.filter((environment) =>
          environment.id !== response.environment.id,
        );
        return [response.environment, ...withoutSaved];
      });
      onSelectEnvironment(response.environment.id);
      setDraft(draftFromEnvironment(response.environment));
      toast.success("Environment saved");
    } catch (error) {
      toast.error("Failed to save environment", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function removeEnvironment(): Promise<void> {
    if (!selectedRepo || !draft.id) { return; }
    setSaving(true);
    try {
      await deleteRepoEnvironment(selectedRepo.id, draft.id);
      setEnvironments((current) =>
        current.filter((environment) => environment.id !== draft.id),
      );
      onSelectEnvironment(null);
      setDraft(emptyEnvironmentDraft());
      toast.success("Environment deleted");
    } catch (error) {
      toast.error("Failed to delete environment", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!selectedRepo) {
    return null;
  }

  return (
    <div className="border-b border-border/70 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={selectedEnvironmentId ?? ""}
          disabled={disabled || loading}
          onChange={(event) => {
            const nextId = event.target.value || null;
            onSelectEnvironment(nextId);
            const nextEnvironment = environments.find((environment) =>
              environment.id === nextId,
            );
            if (nextEnvironment) {
              setDraft(draftFromEnvironment(nextEnvironment));
            }
          }}
          className="h-8 max-w-[220px] rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none disabled:opacity-50"
        >
          <option value="">Default environment</option>
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>
              {environment.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            setDraft(selectedEnvironment
              ? draftFromEnvironment(selectedEnvironment)
              : emptyEnvironmentDraft());
            setEditorOpen((open) => !open);
          }}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
          disabled={disabled}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Environments
        </button>
      </div>

      {editorOpen && (
        <div className="mt-3 grid gap-3 border-t border-border/60 pt-3">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              placeholder="Environment name"
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none"
            />
            <select
              value={draft.networkMode}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  networkMode: event.target.value as NetworkAccessConfig["mode"],
                }))
              }
              className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none"
            >
              <option value="default_plus_extras">Default + extras</option>
              <option value="locked">Locked</option>
              <option value="open">Open</option>
            </select>
          </div>

          {draft.networkMode === "default_plus_extras" && (
            <textarea
              value={draft.extraAllowlistText}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  extraAllowlistText: event.target.value,
                }))
              }
              placeholder="Extra allowed domains, one per line"
              rows={2}
              className="min-h-16 rounded-md border border-border bg-background px-3 py-2 text-xs outline-none"
            />
          )}

          <textarea
            value={draft.plainEnvVarsText}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                plainEnvVarsText: event.target.value,
              }))
            }
            placeholder="Plain env vars: KEY=value"
            rows={2}
            className="min-h-16 rounded-md border border-border bg-background px-3 py-2 text-xs outline-none"
          />
          <textarea
            value={draft.startupScript}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                startupScript: event.target.value,
              }))
            }
            placeholder="Startup script"
            rows={3}
            className="min-h-20 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-foreground-secondary/70">
              Plain env vars are not encrypted secrets. Locked mode applies after setup.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraft(emptyEnvironmentDraft());
                  onSelectEnvironment(null);
                }}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </button>
              {draft.id && (
                <button
                  type="button"
                  onClick={() => void removeEnvironment()}
                  disabled={saving}
                  className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground-secondary transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => void saveEnvironment()}
                disabled={saving || !draft.name.trim()}
                className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
