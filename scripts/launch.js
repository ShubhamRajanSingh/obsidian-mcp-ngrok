#!/usr/bin/env node
/**
 * launch.js — One-command launcher for Obsidian MCP
 * ───────────────────────────────────────────────────
 * 1. Reads config.json
 * 2. Validates the config
 * 3. Starts the auth proxy (inline, no child process)
 * 4. Starts the MCP HTTP server (inline)
 * 5. Opens ngrok tunnel → prints the ChatGPT-ready URL
 *
 * Usage:  npm start
 *         node scripts/launch.js
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath }           from "url";
import path                        from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, "..");

// ─── Load & validate config ───────────────────────────────────────────────────

const CONFIG_PATH = path.join(ROOT, "config.json");

if (!existsSync(CONFIG_PATH)) {
  die(`config.json not found at ${CONFIG_PATH}\nCopy config.json.example → config.json and fill in your keys.`);
}

let cfg;
try {
  cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
} catch (e) {
  die(`config.json is not valid JSON: ${e.message}`);
}

const OBSIDIAN_KEY  = cfg?.obsidian?.apiKey;
const OBSIDIAN_HOST = cfg?.obsidian?.host    || "https://127.0.0.1:27124";
const NGROK_TOKEN   = cfg?.ngrok?.authtoken;
const PROXY_PORT    = cfg?.ports?.proxy      || 3010;
const SERVER_PORT   = cfg?.ports?.server     || 3020;

if (!OBSIDIAN_KEY || OBSIDIAN_KEY === "YOUR_OBSIDIAN_API_KEY_HERE")
  die('Set obsidian.apiKey in config.json.\nFind it in Obsidian → Settings → Community Plugins → Local REST API.');

if (!NGROK_TOKEN || NGROK_TOKEN === "YOUR_NGROK_AUTHTOKEN_HERE")
  die('Set ngrok.authtoken in config.json.\nGet it at: https://dashboard.ngrok.com/get-started/your-authtoken');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function die(msg) {
  console.error(`\n❌  ${msg}\n`);
  process.exit(1);
}

const C = { reset:"\x1b[0m", green:"\x1b[32m", yellow:"\x1b[33m", cyan:"\x1b[36m", bold:"\x1b[1m", dim:"\x1b[2m" };
const log = (label, color, msg) => console.log(`${color}[${label}]${C.reset} ${msg}`);

// ─── Step 1: Start Auth Proxy ─────────────────────────────────────────────────

log("PROXY", C.yellow, `Starting auth proxy on port ${PROXY_PORT}…`);

// Inline — avoids child process issues on Termux
const { default: http  } = await import("http");
const { default: https } = await import("https");
const { URL: NodeURL   } = await import("url");

const target = new NodeURL(OBSIDIAN_HOST);

const proxyServer = http.createServer((req, res) => {
  const options = {
    hostname:           target.hostname,
    port:               target.port || (target.protocol === "https:" ? 443 : 80),
    path:               req.url,
    method:             req.method,
    headers: {
      ...req.headers,
      host:             target.host,
      authorization:    `Bearer ${OBSIDIAN_KEY}`,
    },
    rejectUnauthorized: false,          // Obsidian uses self-signed cert
  };

  const proto = target.protocol === "https:" ? https : http;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders()).end();
    return;
  }

  const proxy = proto.request(options, (obsRes) => {
    res.writeHead(obsRes.statusCode, { ...obsRes.headers, ...corsHeaders() });
    obsRes.pipe(res);
  });

  proxy.on("error", (e) => {
    log("PROXY", C.yellow, `⚠️  ${e.message} — is Obsidian running?`);
    if (!res.headersSent) res.writeHead(502).end(JSON.stringify({ error: e.message }));
  });

  req.pipe(proxy);
});

function corsHeaders() {
  return {
    "access-control-allow-origin":  "*",
    "access-control-allow-headers": "Content-Type, Accept",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };
}

await new Promise((resolve, reject) => {
  proxyServer.listen(PROXY_PORT, (err) => err ? reject(err) : resolve());
});
log("PROXY", C.yellow, `✅  Auth proxy ready → forwarding to ${OBSIDIAN_HOST}`);

// ─── Step 2: Start MCP HTTP Server ────────────────────────────────────────────

log("MCP", C.cyan, `Starting MCP server on port ${SERVER_PORT}…`);

// Set env vars so server.js picks them up
process.env.OBSIDIAN_PROXY_URL = `http://localhost:${PROXY_PORT}`;
process.env.SERVER_PORT        = String(SERVER_PORT);

// Dynamic import runs the server module (it calls app.listen internally)
await import("../src/server.js");

// Give express a moment to bind
await sleep(600);
log("MCP", C.cyan, "✅  MCP server ready");

// ─── Step 3: Open ngrok tunnel ────────────────────────────────────────────────

log("NGROK", C.green, "Connecting ngrok tunnel…");

let ngrok;
try {
  ngrok = await import("@ngrok/ngrok");
} catch {
  die(
    "@ngrok/ngrok is not installed.\n" +
    "Run:  npm install\n\n" +
    "If you're on Termux and see build errors, install the prebuilt binary instead:\n" +
    "  pkg install wget\n" +
    "  wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz\n" +
    "  tar -xzf ngrok-v3-stable-linux-arm64.tgz\n" +
    "  mv ngrok $PREFIX/bin/\n" +
    "Then run:  ./scripts/ngrok-fallback.sh\n"
  );
}

let listener;
try {
  listener = await ngrok.forward({
    addr:     SERVER_PORT,
    authtoken: NGROK_TOKEN,
  });
} catch (e) {
  die(`ngrok failed: ${e.message}\nCheck your authtoken in config.json.`);
}

const publicUrl = listener.url();

// ─── 🎉 Done ──────────────────────────────────────────────────────────────────

console.log(`
${C.bold}${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}
${C.bold}  ✅  Obsidian MCP is live!${C.reset}

  ${C.bold}ChatGPT Connector URL:${C.reset}
  ${C.bold}${C.cyan}  ${publicUrl}/mcp${C.reset}

  How to add in ChatGPT:
  ${C.dim}Settings → Connectors → Create
  Paste the URL above → Authentication: None → Save${C.reset}

  ${C.dim}Proxy  : http://localhost:${PROXY_PORT}
  MCP    : http://localhost:${SERVER_PORT}
  Health : http://localhost:${SERVER_PORT}/health${C.reset}
${C.bold}${C.green}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}

${C.dim}Press Ctrl+C to stop.${C.reset}
`);

// Keep alive — handle graceful shutdown
process.on("SIGINT",  () => shutdown());
process.on("SIGTERM", () => shutdown());

async function shutdown() {
  console.log("\n\nShutting down…");
  try { await listener.close(); } catch {}
  try { proxyServer.close();    } catch {}
  process.exit(0);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
