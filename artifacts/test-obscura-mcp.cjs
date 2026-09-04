// Full round-trip: initialize + tools/call browser_tab_list on obscura MCP
const { spawn } = require("child_process");

const child = spawn("C:\\Tools\\obscura\\obscura.exe", ["mcp", "--stealth"], { stdio: ["pipe", "pipe", "pipe"] });
let buffer = "";

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        child.stdin.write(JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "browser_tab_list", arguments: {} },
        }) + "\n");
      }
      if (msg.id === 2) {
        console.log("TOOL CALL RESULT (browser_tab_list):");
        console.log(JSON.stringify(msg.result, null, 2).slice(0, 800));
        child.kill();
        process.exit(0);
      }
    } catch { /* non-JSON line */ }
  }
});

child.stdin.write(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "cline-test", version: "1.0.0" },
  },
}) + "\n");

setTimeout(() => { console.log("TIMEOUT: no tool result in 30s"); child.kill(); process.exit(1); }, 30000);

