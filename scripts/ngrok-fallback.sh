#!/data/data/com.termux/files/usr/bin/bash
# scripts/ngrok-fallback.sh
# ─────────────────────────────────────────────────────────────────
# Use this ONLY if `npm install` fails for @ngrok/ngrok on Termux.
# It reads the same config.json but spawns the system ngrok binary
# and the Node MCP server/proxy via launch-no-ngrok.js
# ─────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG="$ROOT/config.json"

# ── Parse config.json with node ─────────────────────────────────
read_cfg() {
  node -e "const c=JSON.parse(require('fs').readFileSync('$CONFIG','utf8')); process.stdout.write(String(c.$1||''));"
}

NGROK_TOKEN="$(read_cfg 'ngrok.authtoken')"
SERVER_PORT="$(read_cfg 'ports.server')"
SERVER_PORT="${SERVER_PORT:-3020}"

if [ -z "$NGROK_TOKEN" ] || [ "$NGROK_TOKEN" = "YOUR_NGROK_AUTHTOKEN_HERE" ]; then
  echo "❌  Set ngrok.authtoken in config.json first."
  exit 1
fi

if ! command -v ngrok &>/dev/null; then
  echo "❌  ngrok binary not found in PATH."
  echo ""
  echo "Install it with:"
  echo "  pkg install wget"
  echo "  wget https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-arm64.tgz"
  echo "  tar -xzf ngrok-v3-stable-linux-arm64.tgz"
  echo "  mv ngrok \$PREFIX/bin/"
  exit 1
fi

# Authenticate ngrok (idempotent)
ngrok config add-authtoken "$NGROK_TOKEN" 2>/dev/null

echo "[LAUNCHER] Starting proxy + MCP server…"
node "$SCRIPT_DIR/launch-no-ngrok.js" &
NODE_PID=$!

sleep 2

echo "[LAUNCHER] Starting ngrok tunnel on port $SERVER_PORT…"
# --log=stdout --log-format=json lets us parse the URL
ngrok http "$SERVER_PORT" --log=stdout --log-format=json 2>&1 | while IFS= read -r line; do
  URL=$(echo "$line" | node -e "
    let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{
      try{const o=JSON.parse(d); if(o.url) process.stdout.write(o.url);}catch{}
    });
  " 2>/dev/null)
  if [ -n "$URL" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  ✅  Obsidian MCP is live!"
    echo ""
    echo "  ChatGPT Connector URL:"
    echo "    ${URL}/mcp"
    echo ""
    echo "  Settings → Connectors → Create → paste URL above"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    break
  fi
  echo "$line"
done

wait
kill $NODE_PID 2>/dev/null
