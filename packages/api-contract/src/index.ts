/**
 * The client API contract. Every exported Zod schema in this package is
 * transpiled to Swift (apps/ios/Modules/CoreAPI) by ./codegen and consumed as
 * z.infer types by the server and web client. Server-internal types do not
 * belong here — see docs/api-type-codegen.md.
 */
export * from "./attachments";
export * from "./auth";
export * from "./client-state";
export * from "./integrations";
export * from "./models";
export * from "./providers";
export * from "./repo-environments";
export * from "./repos";
export * from "./session";
export * from "./sessions";
export * from "./user-sessions-websocket-api";
export * from "./voice";
export * from "./websocket-api";
