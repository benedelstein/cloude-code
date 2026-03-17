# Codex Oauth login - Design Document.

## Goal

We want to enable users to connect their codex account to use openai models via our platform. 

## Information

Codex explicitly supports 3rd party oauth, but their oauth flow is kind of tricky.
Their normal flow sends a callback to a local server running on port 1455. So you need something that can spin up a local server, which can't easily be done from a web or mobile app.


https://developers.openai.com/codex/auth#login-on-headless-devices

We will need to use the device flow (which is more cumbersome tbh but that's what we have access to):

```md
Login on headless devices

If you are signing in to ChatGPT with the Codex CLI, there are some situations where the browser-based login UI may not work:

You’re running the CLI in a remote or headless environment.
Your local networking configuration blocks the localhost callback Codex uses to return the OAuth token to the CLI after you sign in.
In these situations, prefer device code authentication (beta). In the interactive login UI, choose Sign in with Device Code, or run codex login --device-auth directly. If device code authentication doesn’t work in your environment, use one of the fallback methods.

Preferred: Device code authentication (beta)

Enable device code login in your ChatGPT security settings (personal account) or ChatGPT workspace permissions (workspace admin).
In the terminal where you’re running Codex, choose one of these options:
In the interactive login UI, select Sign in with Device Code.
Run codex login --device-auth.
Open the link in your browser, sign in, then enter the one-time code.
If device code login isn’t enabled by the server, Codex falls back to the standard browser-based login flow.

Fallback: Authenticate locally and copy your auth cache

If you can complete the login flow on a machine with a browser, you can copy your cached credentials to the headless machine.

On a machine where you can use the browser-based login flow, run codex login.
Confirm the login cache exists at ~/.codex/auth.json.
Copy ~/.codex/auth.json to ~/.codex/auth.json on the headless machine.
Treat ~/.codex/auth.json like a password: it contains access tokens. Don’t commit it, paste it into tickets, or share it in chat.

If your OS stores credentials in a credential store instead of ~/.codex/auth.json, this method may not apply. See Credential storage for how to configure file-based storage.

Copy to a remote machine over SSH:

ssh user@remote 'mkdir -p ~/.codex'
scp ~/.codex/auth.json user@remote:~/.codex/auth.json

Or use a one-liner that avoids scp:

ssh user@remote 'mkdir -p ~/.codex && cat > ~/.codex/auth.json' < ~/.codex/auth.json

Copy into a Docker container:

# Replace MY_CONTAINER with the name or ID of your container.
CONTAINER_HOME=$(docker exec MY_CONTAINER printenv HOME)
docker exec MY_CONTAINER mkdir -p "$CONTAINER_HOME/.codex"
docker cp ~/.codex/auth.json MY_CONTAINER:"$CONTAINER_HOME/.codex/auth.json"

For a more advanced version of this same pattern on trusted CI/CD runners, see Maintain Codex account auth in CI/CD (advanced). That guide explains how to let Codex refresh auth.json during normal runs and then keep the updated file for the next job. API keys are still the recommended default for automation.

Fallback: Forward the localhost callback over SSH

If you can forward ports between your local machine and the remote host, you can use the standard browser-based flow by tunneling Codex’s local callback server (default localhost:1455).

From your local machine, start port forwarding:
ssh -L 1455:localhost:1455 user@remote

In that SSH session, run codex login and follow the printed address on your local machine.
```

Once logged in, codex credentials will be encrypted and store in the database table
`openai_tokens`

When a session is created with `codex-cli` provider, we need to grab those tokens and refresh the access token if necessary. Each time a new message is sent, we need to ensure the access token is valid - otherwise the vm itself may refresh it, which would cause our db to get out of sync. This is very similar to the claude flow.

On the sprite, tokens will be stored in `~/.codex/auth.json`:

## Design considerations

- Let's think of a way to neatly abstract away the codex and openai flows such that they are not strewn about inside `session-agent-do.ts`. They have very similar refresh logic. We can somehow switch on the provider and use the appropriate flow.
- I'd like to make this generic such that we could add other providers in the future (gemini, grok, etc). The more interchangeable the better. Opencode does this well. The UI may not be super generic yet (probably will just do a picker with a connection card if the provider is disconnected), but the architecture should be generic.