- [x] Make sure websocket types are consistent between vm<->server<->client.
- [x] Use cloudflare agents sdk for message storage and streaming and websockets.
- [x] Figure out repo pulling and cloning synchronization.
- [x] 1 client implementation (web or cli)
- [x] Add github auth and connecting to a user's github repos.
- [x] store conversations in d1 and let user click on old convo list to resume
- [ ] customize system prompt for agent specifying its container environment and how to commit changes
- [ ] Proxy git and github actions for security. VM should only have write access specific to the repo and branch.
- [ ] Network access permissions. See https://docs.sprites.dev/api/v001-rc30/policy/
- [ ] Image uploads.
- [ ] Use https://docs.sprites.dev/api/v001-rc30/proxy/ to set up a proxy to vs code running in the VM for direct user edits.

Sprites are long-lived VMs. I'm kind of using them like disposable VMs - just creating 1 session and checking out a repo on a new branch.
How can I make use of their persistence? keep a pool of sprites warm? 