#!/usr/bin/env node
/**
 * Obsidian MCP Server  (v2 — Streamable HTTP transport)
 * ──────────────────────────────────────────────────────
 * Uses the official @modelcontextprotocol/sdk.
 * Exposes /mcp endpoint (Streamable HTTP) — what ChatGPT Dev Mode expects.
 * Also keeps /sse + /messages for MCP Inspector and legacy clients.
 *
 * ENV VARS:
 *   OBSIDIAN_PROXY_URL  – Auth proxy URL  (default: http://localhost:3010)
 *   SERVER_PORT         – HTTP port       (default: 3020)
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import fetch from "node-fetch";
import { randomUUID } from "crypto";

const PROXY_BASE = process.env.OBSIDIAN_PROXY_URL || "http://localhost:3010";
const PORT       = parseInt(process.env.SERVER_PORT || "3020");

// ─── Obsidian API helper ─────────────────────────────────────────────────────

async function obsidian(method, path, body) {
  const url  = `${PROXY_BASE}${path}`;
  const isText = typeof body === "string";
  const opts = {
    method,
    headers: {
      "Content-Type": isText ? "text/markdown" : "application/json",
      Accept: "application/json",
    },
  };
  if (body !== undefined) opts.body = isText ? body : JSON.stringify(body);

  const res  = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`Obsidian ${res.status}: ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ─── Build MCP Server instance ───────────────────────────────────────────────
// Called fresh per session so each session gets its own server instance.

function buildMcpServer() {
  const server = new McpServer({ name: "obsidian-mcp", version: "2.0.0" });

  server.tool("list_notes",
    "List all notes in the Obsidian vault, or inside a specific folder.",
    { folder: z.string().optional().describe("Folder path inside vault, e.g. 'Projects'") },
    async ({ folder }) => {
      const seg    = folder ? encodeURIComponent(folder) : "";
      const result = await obsidian("GET", seg ? `/vault/${seg}/` : "/vault/");
      const files  = result.files ?? result;
      return { content: [{ type: "text", text: Array.isArray(files) ? files.join("\n") : JSON.stringify(files, null, 2) }] };
    }
  );

  server.tool("read_note",
    "Read the full Markdown content of a note by its vault path.",
    { path: z.string().describe("Note path, e.g. 'Daily/2024-01-01.md'") },
    async ({ path: p }) => {
      const encoded = p.split("/").map(encodeURIComponent).join("/");
      const content = await obsidian("GET", `/vault/${encoded}`);
      return { content: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content, null, 2) }] };
    }
  );

  server.tool("search_notes",
    "Full-text search across all notes. Returns matching filenames and context snippets.",
    {
      query:          z.string().describe("Search query"),
      context_length: z.number().optional().describe("Context chars per match (default 100)"),
    },
    async ({ query, context_length }) => {
      const result = await obsidian("POST", "/search/simple/", { query, contextLength: context_length ?? 100 });
      if (!result?.length) return { content: [{ type: "text", text: "No results found." }] };
      const text = result.map(r =>
        `📄 ${r.filename}\n${(r.matches ?? []).map(m => `  …${m.context}…`).join("\n")}`
      ).join("\n\n");
      return { content: [{ type: "text", text }] };
    }
  );

  server.tool("create_note",
    "Create a new note or overwrite an existing one with Markdown content.",
    {
      path:    z.string().describe("Vault path, e.g. 'Ideas/NewIdea.md'"),
      content: z.string().describe("Markdown content"),
    },
    async ({ path: p, content }) => {
      const encoded = p.split("/").map(encodeURIComponent).join("/");
      await obsidian("PUT", `/vault/${encoded}`, content);
      return { content: [{ type: "text", text: `✅ Created: ${p}` }] };
    }
  );

  server.tool("append_to_note",
    "Append text to the end of an existing note.",
    {
      path:    z.string().describe("Vault path of the note"),
      content: z.string().describe("Text to append"),
    },
    async ({ path: p, content }) => {
      const encoded = p.split("/").map(encodeURIComponent).join("/");
      await obsidian("POST", `/vault/${encoded}`, content);
      return { content: [{ type: "text", text: `✅ Appended to: ${p}` }] };
    }
  );

  server.tool("patch_note",
    "Insert or replace content under a specific heading in a note.",
    {
      path:            z.string().describe("Vault path"),
      heading:         z.string().describe("Target heading, e.g. '## Tasks'"),
      content:         z.string().describe("Content to insert"),
      insert_position: z.enum(["beginning", "end"]).optional().describe("Where to insert (default: end)"),
    },
    async ({ path: p, heading, content, insert_position }) => {
      const encoded = p.split("/").map(encodeURIComponent).join("/");
      await obsidian("PATCH", `/vault/${encoded}`, {
        operation: "replace", targetType: "heading", target: heading,
        insertPosition: insert_position ?? "end", content,
      });
      return { content: [{ type: "text", text: `✅ Patched "${p}" under "${heading}"` }] };
    }
  );

  server.tool("delete_note",
    "Permanently delete a note from the vault.",
    { path: z.string().describe("Vault path of the note") },
    async ({ path: p }) => {
      const encoded = p.split("/").map(encodeURIComponent).join("/");
      await obsidian("DELETE", `/vault/${encoded}`);
      return { content: [{ type: "text", text: `🗑️ Deleted: ${p}` }] };
    }
  );

  server.tool("get_active_note",
    "Get the content of the note currently open in Obsidian.",
    {},
    async () => {
      const result = await obsidian("GET", "/active/");
      return { content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool("open_note",
    "Open a specific note in the Obsidian UI.",
    { path: z.string().describe("Vault path to open") },
    async ({ path: p }) => {
      const encoded = p.split("/").map(encodeURIComponent).join("/");
      await obsidian("POST", `/open/${encoded}`);
      return { content: [{ type: "text", text: `📂 Opened: ${p}` }] };
    }
  );

  return server;
}

// ─── Express app ─────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// CORS — allow ChatGPT (chatgpt.com) and any ngrok tunnel
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

// Health check
app.get("/health", (_, res) =>
  res.json({ status: "ok", server: "obsidian-mcp", version: "2.0.0", transport: ["streamable-http", "sse"] })
);

// ── Streamable HTTP — /mcp  (ChatGPT Dev Mode connects here) ─────────────────
const sessions = new Map(); // sessionId → StreamableHTTPServerTransport

app.all("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];

    if (req.method === "POST") {
      if (!sessionId || !sessions.has(sessionId)) {
        // New session
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, transport);
            console.log(`[Streamable] Session started: ${id}`);
          },
        });
        transport.onclose = () => {
          if (transport.sessionId) {
            sessions.delete(transport.sessionId);
            console.log(`[Streamable] Session closed: ${transport.sessionId}`);
          }
        };
        await buildMcpServer().connect(transport);
        await transport.handleRequest(req, res, req.body);
      } else {
        await sessions.get(sessionId).handleRequest(req, res, req.body);
      }

    } else if (req.method === "GET") {
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: "Missing or unknown Mcp-Session-Id" });
        return;
      }
      await sessions.get(sessionId).handleRequest(req, res);

    } else if (req.method === "DELETE") {
      if (sessionId && sessions.has(sessionId)) {
        await sessions.get(sessionId).close();
        sessions.delete(sessionId);
      }
      res.sendStatus(200);

    } else {
      res.sendStatus(405);
    }
  } catch (e) {
    console.error("[Streamable] Error:", e.message);
    if (!res.headersSent) res.status(500).json({ error: e.message });
  }
});

// ── Legacy SSE — /sse  (MCP Inspector, older clients) ────────────────────────
const sseTransports = new Map();

app.get("/sse", async (req, res) => {
  console.log("[SSE] Client connected");
  const transport = new SSEServerTransport("/messages", res);
  sseTransports.set(transport.sessionId, transport);

  // Heartbeat — prevent ngrok and proxies from killing idle streams
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25000);

  res.on("close", () => {
    clearInterval(heartbeat);
    sseTransports.delete(transport.sessionId);
    console.log("[SSE] Client disconnected");
  });

  await buildMcpServer().connect(transport);
});

app.post("/messages", async (req, res) => {
  const t = sseTransports.get(req.query.sessionId);
  if (!t) { res.status(404).json({ error: "Session not found" }); return; }
  await t.handlePostMessage(req, res, req.body);
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n✅  Obsidian MCP Server v2 on http://localhost:${PORT}`);
  console.log(`\n   ChatGPT Dev Mode → use:  https://<ngrok>/mcp`);
  console.log(`   MCP Inspector    → use:  http://localhost:${PORT}/sse`);
  console.log(`   Health           →       http://localhost:${PORT}/health\n`);
});
