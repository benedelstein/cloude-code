export function buildGitHubAppInstallUrl(appSlug: string): string {
  return `https://github.com/apps/${appSlug}/installations/new`;
}
