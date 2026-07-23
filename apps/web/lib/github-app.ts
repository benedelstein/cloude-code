import { buildGitHubAppInstallUrl } from "@repo/shared";

const DEFAULT_GITHUB_APP_SLUG = "my-machines-integration";

export const GITHUB_APP_SLUG =
  process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? DEFAULT_GITHUB_APP_SLUG;

export const GITHUB_APP_INSTALL_URL = buildGitHubAppInstallUrl(GITHUB_APP_SLUG);
