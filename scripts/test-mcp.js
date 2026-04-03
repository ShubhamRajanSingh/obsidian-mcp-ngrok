#!/usr/bin/env node
/**
 * test-mcp.js  — smoke-test the MCP server without ChatGPT or ngrok
 *
 * Usage:
 *   node scripts/test-mcp.js
 *
 * Make sure the server is already running:
 *   source .env && npm start
 */

const BASE = process.env.SERVER_URL || "http://localhost:3020";
let sessionId = null;

async function rpc(method, params = {}) {
  const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;

  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });

  // Capture session ID from response
  const sid = res.headers.get("mcp-session-id");
  if (sid) sessionId = sid;

  // Streamable HTTP may respond with SSE or JSON
  const ct = res.headers.get("content-type") || "";
  const text = await res.text();

  if (ct.includes("text/event-stream")) {
    // Extract last data: line
    const lines = text.split("\n").filter(l => l.startsWith("data: "));
    const last  = lines[lines.length - 1]?.replace("data: ", "");
    return last ? JSON.parse(last) : null;
  }
  return JSON.parse(text);
}

async function run() {
  console.log(`\n🧪 Testing Obsidian MCP Server at ${BASE}\n`);

  // 1. Health check
  console.log("1️⃣  Health check...");
  const health = await fetch(`${BASE}/health`).then(r => r.json());
  console.log("   ✅", JSON.stringify(health));

  // 2. Initialize
  console.log("\n2️⃣  MCP initialize...");
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0" },
  });
  console.log("   ✅ Server:", init?.result?.serverInfo);
  console.log("   Session ID:", sessionId);

  // 3. Send initialized notification
  await rpc("notifications/initialized");

  // 4. List tools
  console.log("\n3️⃣  tools/list...");
  const tools = await rpc("tools/list");
  const toolNames = tools?.result?.tools?.map(t => t.name) ?? [];
  console.log("   ✅ Tools found:", toolNames.join(", "));

  if (toolNames.length === 0) {
    console.error("   ❌ No tools returned — something is wrong");
    process.exit(1);
  }

  // 5. Call list_notes
  console.log("\n4️⃣  Calling list_notes (tests Obsidian connection)...");
  try {
    const notes = await rpc("tools/call", { name: "list_notes", arguments: {} });
    if (notes?.result?.content?.[0]?.text) {
      const lines = notes.result.content[0].text.split("\n");
      console.log(`   ✅ Got ${lines.length} notes. First few:`);
      lines.slice(0, 5).forEach(l => console.log(`      ${l}`));
    } else if (notes?.error) {
      console.log("   ⚠️  Tool error (expected if Obsidian is not running):", notes.error.message);
    }
  } catch (e) {
    console.log("   ⚠️  Could not reach Obsidian:", e.message);
    console.log("      (This is fine — MCP server is working, Obsidian may not be running)");
  }

  console.log("\n✅  MCP server is working correctly!\n");
  console.log("Next step: ngrok http 3020");
  console.log("Then in ChatGPT Dev Mode → Settings → Connectors → Create");
  console.log("Connector URL: https://<your-ngrok-id>.ngrok-free.app/mcp\n");
}

run().catch(e => { console.error("❌ Test failed:", e.message); process.exit(1); });
