import { WorkersSpriteClient } from "@/lib/sprites/WorkersSpriteClient";
import { dedent } from "@repo/shared";

export interface GitSetupOptions {
  workspaceDir: string;
  githubRemoteUrl: string;
  cloneUrl: string;
  proxyBaseUrl: string;
  gitProxySecret: string;
}

/**
 * Configures git remote URLs, identity, and proxy auth header in the workspace.
 */
export async function configureGitRemote(
  sprite: WorkersSpriteClient,
  options: GitSetupOptions,
): Promise<void> {
  const { workspaceDir, githubRemoteUrl, cloneUrl, proxyBaseUrl, gitProxySecret } = options;

  await sprite.execWs(dedent`
    set -e
    cd ${workspaceDir}
    git remote set-url origin ${githubRemoteUrl}
    git remote set-url --push origin ${cloneUrl}
    git config user.email "cloude@cloude.dev"
    git config user.name "Cloude Code"
    git config --unset-all http.extraHeader || true
    git config --unset-all "http.${proxyBaseUrl}/.extraHeader" || true
    git config --add "http.${proxyBaseUrl}/.extraHeader" "Authorization: Bearer ${gitProxySecret}"
  `, {});
}
