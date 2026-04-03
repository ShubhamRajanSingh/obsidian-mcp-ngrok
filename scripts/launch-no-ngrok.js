#!/usr/bin/env node
/**
 * launch-no-ngrok.js
 * Starts the auth proxy and MCP server using config.json,
 * but does NOT start ngrok (used by ngrok-fallback.sh).
 */

import { readFileSync, existsSync } from "fs";
import { fileURLToPath }           from "url";
import path                        from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, "..");
const cfg       = JSON.parse(readFileSync(path.join(ROOT, "config.json"), "utf8"));

const OBSIDIAN_KEY  = cfg?.obsidian?.apiKey;
const OBSIDIAN_HOST = cfg?.obsidian?.host  || "https://127.0.0.1:27124";
const PROXY_PORT    = cfg?.ports?.proxy    || 3010;
const SERVER_PORT   = cfg?.ports?.server   || 3020;

const { default: http  } = await import("http");
const { default: https } = await import("https");
const { URL: NodeURL   } = await import("url");

const target = new NodeURL(OBSIDIAN_HOST);

const proxyServer = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors()).end();
    return;
  }
  const opts = {
    hostname: target.hostname,
    port:     target.port || (target.protocol === "https:" ? 443 : 80),
    path:     req.url,
    method:   req.method,
    headers:  { ...req.headers, host: target.host, authorization: `Bearer ${OBSIDIAN_KEY}` },
    rejectUnauthorized: false,
  };
  const proto = target.protocol === "https:" ? https : http;
  const proxy = proto.request(opts, (r) => { res.writeHead(r.statusCode, { ...r.headers, ...cors() }); r.pipe(res); });
  proxy.on("error", (e) => { if (!res.headersSent) res.writeHead(502).end(e.message); });
  req.pipe(proxy);
});

function cors() {
  return {
    "access-control-allow-origin":  "*",
    "access-control-allow-headers": "Content-Type, Accept",
    "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };
}

await new Promise(r => proxyServer.listen(PROXY_PORT, r));
console.log(`[PROXY] Listening on :${PROXY_PORT}`);

process.env.OBSIDIAN_PROXY_URL = `http://localhost:${PROXY_PORT}`;
process.env.SERVER_PORT        = String(SERVER_PORT);
await import("../src/server.js");
console.log(`[MCP]   Listening on :${SERVER_PORT}`);
