# Metis AI MCP Gateway

This package is the public module boundary for the Metis AI agent platform's
MCP gateway. It exposes the gateway dispatcher and registry operations while
the application keeps the runtime implementation in `lib/mcp-core`.

## Configuration

The gateway uses environment variables instead of machine-specific paths:

```text
MCP_PORT=8787
MCP_PUBLIC_URL=http://127.0.0.1:8787
MCP_BEARER_TOKEN=replace-me
MCP_ALLOW_REMOTE_ADMIN=false
MCP_SDK_ROOT=/path/to/node_modules/@modelcontextprotocol/sdk
AI_CHAT_ROOT=/path/to/metis-ai
AI_CHAT_MCP_STATE_DIR=/path/to/state
AGENT_CWD=/path/to/agent-workspace
```

Never commit bearer tokens, chat passwords, `.env` files, databases, or
runtime state. Keep the gateway bound to localhost unless it is protected by
authentication and a trusted network boundary.

## File edits

`edit_file` accepts the existing `path, oldText, newText` form or several ordered
replacements for one file:

```json
{
  "path": "src/config.ts",
  "edits": [
    { "oldText": "enabled: false", "newText": "enabled: true" },
    { "oldText": "timeout: 30", "newText": "timeout: 60" }
  ],
  "dryRun": true
}
```

Later replacements see the preceding replacements. The tool validates every
match before atomically saving the file; a failed edit leaves the file unchanged.
`dryRun` validates and reports replacement counts and first matching lines
without writing. For repeated snippets, explicitly set `replaceAll: true` on
that replacement and optionally `expectedOccurrences` to assert the count.
Legacy single edits support those same flags at the top level.

UTF-8/BOM, existing line endings, ownership and mode are preserved. Files are
limited to 32 MiB, batches to 100 edits. Hard-linked files cannot be atomically
replaced. Server edits execute as the mapped OS identity and remain inside the
permitted workspace. For a Remote Device, use `target: "client:<id>"`.
Updated clients use the native batch operation. Older clients may use a bounded
command transport only under full-access policy; otherwise update the client.
There is one file per call, so existing edit snapshots and message Revert remain
available.

The gateway can discover and call registered child MCP servers, expose web and
documentation tools, run allowlisted platform operations, persist workflows,
and provision supported servers from the official MCP Registry. Dangerous
operations such as shell, Docker, filesystem, and service control should only
be enabled in a trusted, authenticated deployment.
