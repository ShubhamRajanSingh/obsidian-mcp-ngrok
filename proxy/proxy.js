#!/usr/bin/env node
/**
 * Obsidian Auth Proxy
 * ───────────────────
 * Sits between the MCP server (and ChatGPT via ngrok) and the Obsidian
 * LocalREST API plugin. Injects the Authorization header so callers
 * don't need to know the API key.
 *
 * ENV VARS:
 *   OBSIDIAN_API_KEY   – API key from Obsidian LocalREST plugin settings
 *   OBSIDIAN_HOST      – Obsidian host (default: https://127.0.0.1:27124)
 *   PROXY_PORT         – Port this proxy listens on (default: 3010)
 */

import http from "http";
import https from "https";
import { URL } from "url";

const OBSIDIAN_API_KEY = process.env.OBSIDIAN_API_KEY;
const OBSIDIAN_HOST    = process.env.OBSIDIAN_HOST || "https://127.0.0.1:27124";
const PROXY_PORT       = parseInt(process.env.PROXY_PORT || "3010");

if (!OBSIDIAN_API_KEY) {
  console.error("❌  OBSIDIAN_API_KEY environment variable is required.");
  process.exit(1);
}

const target = new URL(OBSIDIAN_HOST);

const server = http.createServer((req, res) => {
  const targetUrl = new URL(req.url, OBSIDIAN_HOST);

  const options = {
    hostname: target.hostname,
    port:     target.port || (target.protocol === "https:" ? 443 : 80),
    path:     targetUrl.pathname + targetUrl.search,
    method:   req.method,
    headers: {
      ...req.headers,
      host:          target.host,
      authorization: `Bearer ${OBSIDIAN_API_KEY}`,
    },
    // LocalREST plugin uses self-signed cert
    rejectUnauthorized: false,
  };

  const proto = target.protocol === "https:" ? https : http;

  const proxy = proto.request(options, (obsRes) => {
    res.writeHead(obsRes.statusCode, {
      ...obsRes.headers,
      // Allow ChatGPT / any origin during dev
      "access-control-allow-origin":  "*",
      "access-control-allow-headers": "Content-Type, Accept",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    });
    obsRes.pipe(res);
  });

  proxy.on("error", (e) => {
    console.error("Proxy error:", e.message);
    res.writeHead(502).end(JSON.stringify({ error: e.message }));
  });

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "access-control-allow-origin":  "*",
      "access-control-allow-headers": "Content-Type, Accept",
      "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    }).end();
    return;
  }

  req.pipe(proxy);
});

server.listen(PROXY_PORT, () => {
  console.log(`✅  Obsidian Auth Proxy running on http://localhost:${PROXY_PORT}`);
  console.log(`    → Forwarding to ${OBSIDIAN_HOST}`);
});
