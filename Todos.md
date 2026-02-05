- [x] Make sure websocket types are consistent between vm<->server<->client.
- [x] Use cloudflare agents sdk for message storage and streaming and websockets.
- [x] Figure out repo pulling and cloning synchronization.
- [ ] 
- [ ] 1 client implementation (web or cli)
- [ ] Add github auth and connecting to a user's github repos.
- [ ] Proxy git and github actions for security. VM should only have write access specific to the repo and branch.
- [ ] Network access permissions.  See https://docs.sprites.dev/api/v001-rc30/policy/
- [ ] Image uploads.
- [ ] Use https://docs.sprites.dev/api/v001-rc30/proxy/ to set up a proxy to vs code running in the VM for direct user edits.

Sprites are long-lived VMs. I'm kind of using them like disposable VMs - just creating 1 session and checking out a repo on a new branch.
How can I make use of their persistence?ww