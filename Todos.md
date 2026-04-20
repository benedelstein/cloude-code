# Todos

Ongoing work tracker. Format: `- [status] [area] title — one-line context`. Oldest-first within each section.

For larger efforts, spin out a plan in `docs/plans/` from `TEMPLATE.md` and link it here.

## Active

- [ ] [bug][HIGH] Sessions sometimes get stuck as `syncing` on restore and can't be recovered. Root cause likely `pending_message_chunks` rehydration racing with a rotated agent PID — cancel signals get sent to the new process which isn't responding. Needs bulletproof DO state sync.
- [ ] [bug][HIGH] After server restart, in-progress `pending_message_chunks` are lost; we respawn the agent but cancel routes to the new PID and never actually aborts. Tied to the item above.
- [ ] [infra][HIGH] DO/VM message state sync: VM local fs loses history on crash; occasionally a message reaches SQLite but not the VM. Single source of truth — pass full history from DO to VM on start?
- [ ] [infra][MED] DO state migration strategy. Version the DO schema + VM (e.g. `/version.json` on the VM), check on boot, run migrations. Needed before we break any `ClientState` / `ServerState` shape.
- [ ] [feature][MED] Pre-warm sprite pool per repo. Keep an index of sprite ↔ session/repo; on session end mark sprite reusable. Explore multi-session per CPU with resource caps. Avoids fresh-clone cost.
- [ ] [feature][MED] Ask-user-question tool. How do we model interactive tool calls that block on a user response? Needs a round-trip protocol on the ws + UI surface.
- [ ] [feature][MED] After PR creation, auto-run a review subagent, post comments, then have the main agent address them.
- [ ] [feature][MED] Proactive push notifications when a session needs input or is done. Requires tracking session state (responding / pending-input / done) for passive monitoring.
- [ ] [feature][LOW] Slash commands + file mentions. Allow `/fork` to spawn a child session scoped to follow-up work on an already-merged session (vs. switching branches in-place).
- [ ] [feature][LOW] Multi-provider selection (Claude / Codex / Gemini / …) — partially there via `AgentSettings` union; needs model / provider UI polish.
- [ ] [feature][LOW] Visualize sessions grouped by repo for high-level orchestration.
- [ ] [feature][LOW] Upload files that persist into the agent's filesystem (not just tokens via attachments).
- [ ] [feature][LOW] Agent-side browser screenshots for visual verification. Chromium on the sprite vs. a user-invoked skill.
- [ ] [feature][LOW] Keep agent message history in memory for faster client sync.
- [ ] [feature][LOW] Mobile client.
- [ ] [feature][LOW] Landing page.

## Open questions

- Sprites are persistent VMs; we're using them like disposables. What's the right way to exploit persistence — warm pools? per-user pools? branch reuse?

## Done

Archive of completed items (no dates on historical entries; add dates going forward).

- [x] Image uploads
- [x] Store past session history and resume
- [x] VS Code editor proxy on the sprite
- [x] Sprite network egress policy
- [x] git/github actions proxy for scoped write access
- [x] Customized vm-agent system prompt (container env, commit flow)
- [x] Persist conversations in D1 with a resumable session list
- [x] GitHub auth + connect user repos
- [x] Initial web client
- [x] Repo pull/clone synchronization
- [x] Cloudflare Agents SDK for storage + streaming + ws
- [x] Websocket types unified across vm ↔ server ↔ client
- [x] Bug: VM state reset losing local branch progress (sprite crash)
