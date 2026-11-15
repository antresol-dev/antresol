# Antresol MCP server

A local [MCP](https://modelcontextprotocol.io/) server that lets an AI assistant look through your Antresol inventory and prepare intake drafts from receipts and photos.

It reads everything and writes only intake drafts. Nothing reaches your stock until you review the draft and commit it in the Antresol app.

## Get the connection key

In the Antresol app open Settings → Connect AI and copy the key. The key is a secret: it gives access to your database. Paste it only into the settings of your AI app (as below), never into a chat.

## Install

Download from the [Releases](https://github.com/antresol-dev/antresol/releases) page (tags `mcp-v*`):

- `antresol.mcpb` for Claude Desktop.
- `antresol-mcp-node.zip` for every other app: `server.mjs` and the image codec files (`*.wasm`) that must stay next to it. Unzip it anywhere and keep the folder. It needs [Node.js](https://nodejs.org/) 20 or newer.

### Claude Desktop

Open `antresol.mcpb` (double-click it, or drag it into Claude Desktop). Paste the connection key when asked. Optionally pick a photos folder.

### Claude Code

```sh
claude mcp add antresol --env ANTRESOL_CONNECTION=<key> -- node /path/to/unzipped/server.mjs
```

### Other apps

Not tested by us. Each one starts the same command, `node /path/to/unzipped/server.mjs`, with the key in the environment variable `ANTRESOL_CONNECTION`.

Cursor, in `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "antresol": {
      "command": "node",
      "args": ["/path/to/unzipped/server.mjs"],
      "env": { "ANTRESOL_CONNECTION": "<key>" }
    }
  }
}
```

VS Code, in `.vscode/mcp.json` or the user settings (`MCP: Open User Configuration`):

```json
{
  "servers": {
    "antresol": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/unzipped/server.mjs"],
      "env": { "ANTRESOL_CONNECTION": "<key>" }
    }
  }
}
```

Codex CLI, in `~/.codex/config.toml`:

```toml
[mcp_servers.antresol]
command = "node"
args = ["/path/to/unzipped/server.mjs"]
env = { ANTRESOL_CONNECTION = "<key>" }
```

## What the assistant can do

Read: `get_overview` (call first), `search`, `get_item`, `get_folder`, `list_intakes`, `get_intake`, `refresh`.

Draft intakes: `create_intake`, `update_intake_header`, `add_intake_lines`, `update_intake_line`, `remove_intake_line`, `update_new_item`. Lines may carry a photo.

Photos: `list_photos`, `view_photos`.

Prompt: `intake_from_photos` goes through a folder of receipt and item photos and fills a draft.

After the assistant changes a draft, open the app, check it and commit it there.

## Photos

Put the photos in a folder. The default folder is:

- macOS and Windows: `Pictures/Antresol` in your home folder.
- Linux: `$XDG_PICTURES_DIR/Antresol`, or `~/Pictures/Antresol` when that variable is not set.

To use another folder, set it in the Claude Desktop settings of the extension, or set `ANTRESOL_PHOTOS_DIR` in the `env` of the snippets above; an empty value means the default. You can also tell the assistant a path in the chat. Photos you attach directly in a chat do not reach the server: it can only read files from a folder.

Supported: jpg, png, webp, heic. The server shrinks them and uploads them to the photo store of your source (set up in the app) when a draft line is saved.

## Build it yourself

```sh
pnpm --filter @antresol/mcp build          # packages/mcp/dist/server.mjs and the .wasm files
pnpm --filter @antresol/mcp run pack:mcpb  # also dist/antresol.mcpb and dist/antresol-mcp-node.zip
```

(`pnpm pack` is a pnpm command of its own, hence `run pack:mcpb`.) A release is made by pushing a tag `mcp-v<version>`, where the version is the one in `packages/mcp/package.json` and `packages/mcp/mcpb/manifest.json`.
