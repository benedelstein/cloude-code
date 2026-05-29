import type { WorkersSpriteClient } from "@/shared/integrations/sprites/WorkersSpriteClient";
import { dedent } from "@repo/shared";

export interface GitSetupOptions {
  workspaceDir: string;
  githubRemoteUrl: string;
  cloneUrl: string;
  proxyBaseUrl: string;
  gitProxySecret: string;
  useProxyForFetch?: boolean;
}

/**
 * Configures git remote URLs, identity, and proxy auth header in the workspace.
 */
export async function configureGitRemote(
  sprite: WorkersSpriteClient,
  options: GitSetupOptions,
): Promise<void> {
  const {
    workspaceDir,
    githubRemoteUrl,
    cloneUrl,
    proxyBaseUrl,
    gitProxySecret,
    useProxyForFetch = false,
  } = options;
  const fetchUrl = useProxyForFetch ? cloneUrl : githubRemoteUrl;

  await sprite.execHttp(dedent`
    set -e
    cd ${workspaceDir}
    git remote set-url origin ${fetchUrl}
    git remote set-url --push origin ${cloneUrl}
    git config user.email "agent@cloudecode.dev"
    git config user.name "Cloude Code"
    git config --unset-all http.extraHeader || true
    git config --unset-all "http.${proxyBaseUrl}/.extraHeader" || true
    git config --add "http.${proxyBaseUrl}/.extraHeader" "Authorization: Bearer ${gitProxySecret}"
  `, {});
}
