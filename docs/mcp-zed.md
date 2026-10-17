# MCP for Zed (local, manual paste)

Zed reads MCP from your **global** `settings.json` (not the repo — don't commit tokens).
Open `zed: open settings file` → add under `context_servers`, restart Zed, check Agent Panel → green dot = active.

```json
{
	"context_servers": {
		"svelte": {
			"command": "npx",
			"args": ["-y", "@sveltejs/mcp"]
		},
		"tauri-docs": {
			"command": "npx",
			"args": ["-y", "mcp-remote", "https://tauri-docs.mastra.cloud/api/mcp/tauri-docs-mcp/mcp"]
		},
		"awesome-ionic-mcp": {
			"command": "npx",
			"args": ["-y", "awesome-ionic-mcp@latest"]
		},
		"android-docs": {
			"command": "npx",
			"args": ["-y", "@arabold/docs-mcp-server@latest"]
		},
		"tauri-mcp-server": {
			"command": "npx",
			"args": ["-y", "@hypothesi/tauri-mcp-server"],
			"env": {}
		}
	}
}
```

Notes:

- `svelte` can also run remote: `https://mcp.svelte.dev/mcp` as `url` (needs OAuth on first use). Prefer stdio `npx` for offline.
- `tauri-mcp-server` needs the bridge plugin + a running `driver-session` in dev (`tauri-mcp driver-session start`); skip it until T4 prototype.
- Kotlin PSI / JetBrains IDE MCP is bundled in IntelliJ/Android Studio — enable in IDE settings, no Zed entry needed.
- VS Code mirror of this lives in `.vscode/mcp.json` (workspace-local, committed).
