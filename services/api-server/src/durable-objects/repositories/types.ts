/** Tagged template SQL function type from the Cloudflare Durable Object Agent SDK. */
export type SqlFn = <T = Record<string, string | number | boolean | null>>(
  strings: TemplateStringsArray,
  ...values: (string | number | boolean | null)[]
) => T[];

/** Repositories must implement migrate() for schema initialization. */
export interface Repository {
  migrate(): void;
}
