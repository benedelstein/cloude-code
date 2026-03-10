- [x] Make sure websocket types are consistent between vm<->server<->client.
- [x] Use cloudflare agents sdk for message storage and streaming and websockets.
- [x] Figure out repo pulling and cloning synchronization.
- [x] 1 client implementation (web or cli)
- [x] Add github auth and connecting to a user's github repos.
- [x] store conversations in d1 and let user click on old convo list to resume
- [x] customize system prompt for agent specifying its container environment and how to commit changes
- [x] Proxy git and github actions for security. VM should only have write access specific to the repo and branch.
- [ ] After creating PR, have the agent auto-review the pr using a subagent and then write comments. Then have the agent fix any comments itself.
- [ ] Pre-warm sprite instances for a repo and cache them for reuse later so we don't have to do a fresh clone.
        This will require keeping an index of which sprite is associated with which session & repository. 
        When a session is complete, we can mark the sprite as available for reuse.
        Maybe,...run multiple sessions on one cpu for different repos. would need to handle resource sharing.
- [x] Store past session history and open resumed sessions
- [ ] Proactive push notifications to the user when something is ready.
        Track session state (responding, pending input, done) so user can passively monitor multiple sessions.
- [ ] Visualize sessions by repo — make it more useful for high-level orchestration.
- [ ] Mobile client
- [ ] keep session agent message history in memory for faster syncing with clients
- [ ] Ask user question tool - how do we handle interactive tool calls that wait for responses?
- [x] Bug: sometimes sessions get stuck as syncing on restore and can't be recovered.
- [x] Network access permissions. See https://docs.sprites.dev/api/v001-rc30/policy/
- [ ] Image uploads.
- [ ] Slash commands (plugins), file mentions
- [x] Use https://docs.sprites.dev/api/v001-rc30/proxy/ to set up a proxy to vs code running in the VM for direct user edits.
- [ ] Allow the vm to render results as screenshots with a browser in order to visually see its results. Extra tool?
        Can we install chromium on the sprite? eh can't the user prompt this with a skill?

Sprites are long-lived VMs. I'm kind of using them like disposable VMs - just creating 1 session and checking out a repo on a new branch.
How can I make use of their persistence? keep a pool of sprites warm?