# JARVIS

A futuristic personal AI command centre with an Agent Core UI.

## GitHub Pages

The root `index.html` is ready for GitHub Pages. It runs as a static dashboard. The Agent Core can display plans, tool states, approvals, task queue and memory UI.

## Full agent mode

GitHub Pages cannot run a persistent Node backend. To enable real tool execution, deploy `agent-server/` to a server/host and point the UI's `/api/agent` endpoint at that backend (or configure a reverse proxy).

Never put private AI API keys in `index.html` or commit `.env` files.

## Local backend

```bash
cd agent-server
npm install
cp .env.example .env
npm start
```

Then open the server's public URL. Configure your hosting platform to serve the same origin if possible.

## Safety

Keep approvals for consequential actions such as sending messages, publishing, purchases, account changes, or destructive file operations. Only grant tools the permissions you actually need.
