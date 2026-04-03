# Obsidian MCP — One-Command Setup

Connect your Obsidian vault to ChatGPT with a single command.

```
npm start
```

Starts the auth proxy, MCP server, opens an ngrok tunnel, and prints the URL to paste into ChatGPT.

---

## Architecture

```
ChatGPT Dev Mode
      │  HTTPS /mcp  (Streamable HTTP)
      ▼
   ngrok tunnel
      │
      ▼
MCP Server  :3020    ← tools: list/read/search/create/append/patch/delete notes
      │  HTTP (no auth)
      ▼
Auth Proxy  :3010    ← injects  Authorization: Bearer <key>
      │  HTTPS + self-signed cert OK
      ▼
Obsidian LocalREST API  :27124
      │
      ▼
Your Obsidian Vault 📓
```

---

## Setup (4 steps)

### 1. Install Obsidian LocalREST API plugin

- Obsidian → Settings → Community Plugins → Browse → search **"Local REST API"**
- Install, enable it, then go to Settings → Local REST API → copy the **API Key**

### 2. Clone and install

```bash
git clone https://github.com/your-username/obsidian-mcp.git
cd obsidian-mcp
npm install
```

On Termux: if `@ngrok/ngrok` install fails, see the [Termux section](#termux-android).

### 3. Edit `config.json`

```json
{
  "obsidian": {
    "apiKey": "paste_your_obsidian_api_key_here",
    "host":   "https://127.0.0.1:27124"
  },
  "ngrok": {
    "authtoken": "paste_your_ngrok_authtoken_here"
  },
  "ports": {
    "proxy":  3010,
    "server": 3020
  }
}
```

Get your ngrok token at: https://dashboard.ngrok.com/get-started/your-authtoken

### 4. Run

```bash
npm start
```

Output:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✅  Obsidian MCP is live!

  ChatGPT Connector URL:
    https://abc123.ngrok-free.app/mcp

  Settings → Connectors → Create → paste URL above
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Adding to ChatGPT

1. Settings → Connectors → Advanced → enable **Developer Mode**
2. Connectors → **Create**
3. Connector URL: `https://xxxx.ngrok-free.app/mcp`
4. Authentication: **None** → Save

---

## Termux (Android)

`@ngrok/ngrok` ships an arm64 binary and should work. If it doesn't:

```bash
pkg install wget
wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz
tar -xzf ngrok-v3-stable-linux-arm64.tgz && mv ngrok $PREFIX/bin/

chmod +x scripts/ngrok-fallback.sh
./scripts/ngrok-fallback.sh
```

---

## Tools

`list_notes` · `read_note` · `search_notes` · `create_note` · `append_to_note` · `patch_note` · `delete_note` · `get_active_note` · `open_note`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `ECONNREFUSED :27124` | Obsidian must be open with LocalREST plugin enabled |
| `401 Unauthorized` | Wrong `obsidian.apiKey` |
| ChatGPT loads forever | URL must end in `/mcp` not `/sse` |
| ngrok URL expired | Re-run `npm start`, update ChatGPT connector |

---

## Files

```
obsidian-mcp/
├── config.json                ← EDIT THIS — your only config file
├── src/server.js              ← MCP server (Streamable HTTP + SSE)
├── proxy/proxy.js             ← Auth proxy
├── scripts/
│   ├── launch.js              ← Main one-command launcher
│   ├── launch-no-ngrok.js     ← Used by shell fallback
│   ├── ngrok-fallback.sh      ← Termux fallback
│   └── test-mcp.js            ← Smoke test
└── package.json
```
