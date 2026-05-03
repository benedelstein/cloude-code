# Plan: Think-Based Rewrite

## Context

The current architecture uses a Durable Object as the session control plane, a Workflow for durable turn execution, and a Sprite VM as the persistent execution environment. The Sprite holds the real repository checkout and runs a provider-native coding agent (Claude Code or Codex) inside that checkout.

This works well for full development context, but it couples most agent capabilities to the VM from the start. Project Think offers a different shape: the Durable Object owns the run loop and persistence, while execution capabilities are decomposed into explicit tool layers such as workspace tools, codemode, browser, and sandbox.

The goal of a rewrite would not be to make the system "more Cloudflare-native" for its own sake. The goal would be to keep the current strengths:

- durable session state
- resumable long-running work
- real development environments when needed
- browser-based verification

while moving orchestration and capability boundaries into a Think-style host agent.

## Architecture

The rewrite would keep the session Durable Object as the durable identity, but replace the current "remote coding agent process" model with a host-owned Think agent.

### 1. Session Durable Object becomes a Think agent

Replace the current `SessionAgentDO extends Agent<Env, ClientState>` orchestration pattern with a `SessionAgentDO extends Think<Env, SessionConfig>` style agent.

The DO would own:

- message/session persistence
- cached prompt + context blocks
- conversation recovery / regeneration branches
- user/session/project memory
- tool approval state
- scheduling
- MCP and client tools

The DO would still remain the source of truth for:

- accepted user messages
- derived client state
- session metadata
- auth/session secrets

Current equivalents:

- `messages` table already maps cleanly to Think session history
- `server_state` remains necessary for repo/auth/execution metadata
- `pending_message_chunks` may be replaced by Think-native recovery for host-side runs, but a WAL-like mechanism is still useful for heavy execution tiers that stream back into the DO

### 2. Split execution into explicit capability tiers

Instead of provisioning a Sprite and launching a provider-native coding agent for every session turn, expose development capabilities as explicit tools:

- `workspace` tools for durable file access
- `execute` / codemode for batch file logic and small code transforms
- `browser` tools for navigation, screenshots, and assertions
- `sandbox` tools for real shell commands, installs, dev servers, tests, and exposed preview URLs

This keeps the DO in control of the run loop while still allowing escalation into a full development environment.

### 3. Two workspace concepts, not one

The rewrite should not force a single workspace abstraction to do everything.

There are really two separate needs:

- `session workspace`: durable DO-owned workspace for notes, plans, lightweight files, derived artifacts, and host-side edits
- `repo sandbox workspace`: real repo checkout inside Sandbox/Sprite for commands, package installs, builds, dev servers, and browser testing

The important point is that the DO remains the orchestrator even when the agent escalates into the sandbox.

Recommended model:

- Treat the sandbox repo checkout as a managed execution resource, not the durable source of truth for the session
- Sync files between the DO-owned workspace and the sandbox checkout when entering/leaving heavy execution
- For code-heavy repos, it may still be simpler to treat the sandbox checkout as canonical for repository contents and use the DO workspace mainly for agent-side metadata

This is the hardest design choice in the rewrite.

### 4. Replace provider-native CLI harnesses with host-owned tools

Today the actual coding behavior comes from Claude Code or Codex running inside the VM. In a Think rewrite, the host agent owns the tool surface directly.

That means:

- no remote stdin/stdout vm-agent protocol
- no `AgentProcessRunner` sending prompts into a coding CLI
- no provider-native tool runtime as the primary execution model

Instead:

- `getModel()` returns a network-native model provider
- `getTools()` exposes the workspace/browser/sandbox/git/github tools directly
- the host agent decides when to call those tools

Provider-native coding CLIs could still exist as an escape hatch, but they should be modeled as one optional heavy tool, not the default harness.

### 5. Replace Sprite session workflow with execution-resource services

Current components that would shrink or disappear:

- `SessionTurnWorkflow`
- `AgentProcessRunner`
- most of the vm-agent package

New components:

- `SandboxSessionService`
  - create/reuse sandbox per session
  - clone/fetch repo
  - manage env vars and credentials
  - start/stop background processes
  - expose preview URLs

- `BrowserSessionService`
  - create/reuse browser session
  - open preview URLs
  - run verification flows

- `RepoSyncService`
  - apply DO workspace edits into sandbox checkout
  - optionally copy changed files back out
  - manage branch status / git dirty state

- `ThinkToolFactory`
  - assemble the tool set exposed to the host agent

### 6. Session turn flow

Target turn flow:

1. User sends message to `SessionAgentDO`
2. Think host loop runs in the DO
3. Agent decides whether the task needs:
   - direct workspace tools
   - codemode
   - sandbox
   - browser
4. If sandbox is needed:
   - ensure sandbox exists for this session
   - ensure repo checkout exists and is current
   - run commands or start background processes
   - expose preview URL if needed
5. If browser is needed:
   - open preview URL in Browser Run
   - inspect/test the app
6. Host agent streams results back through the DO
7. Persist output and update derived state

### 7. Keep long-running execution explicit

Think should own the chat loop, but heavy execution should still be externalized into durable resources.

For example:

- the DO should not try to host `npm run dev`
- the sandbox should own that process
- the DO should track the sandbox process metadata and preview URL

This keeps the host loop clean while still supporting real development workflows.

### Tradeoffs & Other options considered

#### Full rewrite to pure Think workspace/codemode only

Rejected.

This would lose the strongest part of the current system: real execution context for development. Workspace + codemode alone are not enough for serious repo work involving installs, build tools, long-lived servers, or browser testing.

#### Keep the current architecture as-is

Viable.

The current design already has a good separation between durable control plane and execution environment. Its main downside is that the actual tool/runtime model is owned by Claude Code or Codex inside the VM, not by the host system.

#### Hybrid approach

Preferred.

The most realistic path is:

- keep the DO/workflow/session durability ideas you already have
- move the turn loop into a Think-style host agent
- expose Sandbox and Browser as explicit tools
- preserve a real execution environment for heavy development work

This keeps the advantages of Think's decomposition without giving up full execution context.

## Testing

The rewrite should be validated in stages:

1. Host-only turns
   - simple chat, memory, config, and workspace-tool turns run entirely in the DO

2. Sandbox-backed turns
   - clone repo
   - run git commands
   - install dependencies
   - run tests

3. Browser-backed turns
   - start dev server in sandbox
   - expose preview URL
   - open in browser
   - perform smoke checks

4. Recovery
   - DO restart during host-only turns
   - DO restart while sandbox process continues
   - reconnect to existing sandbox/browser session metadata

5. Migration parity
   - preserve current session history semantics
   - preserve provider auth flows
   - preserve repo access controls and git proxy behavior where still needed
