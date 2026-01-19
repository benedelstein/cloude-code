# Cloude Code ☁️

A remote agent coding environment. 

## Services

- api-server: Handles user connection and session management. Coordinates between vm server and client.
- vm-server: Runs a VM for the session with an agent process. Pulls in the repository and edits files, runs commands, etc.
- Clients: Connects to the server and sends messages to the agent. Tbd.