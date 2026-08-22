# Xero MCP Server

This is a Model Context Protocol (MCP) server implementation for Xero. It provides a bridge between the MCP protocol and Xero's API, allowing for standardized access to Xero's accounting and business features.

## Features

- Xero OAuth2 authentication with custom connections (single tenant)
- MCP `2026-07-28` over stdio and authenticated stateless HTTP
- Draft-only, preview-confirmed mutations
- Contact management
- Chart of Accounts management
- Invoice creation and management
- MCP protocol compliance

## Prerequisites

- Node.js (v18 or higher)
- npm or pnpm
- A Xero developer account with API credentials

## Docs and Links

- [Xero Public API Documentation](https://developer.xero.com/documentation/api/)
- [Xero API Explorer](https://api-explorer.xero.com/)
- [Xero OpenAPI Specs](https://github.com/XeroAPI/Xero-OpenAPI)
- [Xero-Node Public API SDK Docs](https://xeroapi.github.io/xero-node/accounting)
- [Developer Documentation](https://developer.xero.com/)

## Setup

### Create a Xero Account

If you don't already have a Xero account and organisation already, can create one by signing up [here](https://www.xero.com/au/signup/) using the free trial.

We recommend using a Demo Company to start with because it comes with some pre-loaded sample data. Once you are logged in, switch to it by using the top left-hand dropdown and selecting "Demo Company". You can reset the data on a Demo Company, or change the country, at any time by using the top left-hand dropdown and navigating to [My Xero](https://my.xero.com).

NOTE: To use Payroll-specific queries, the region should be either NZ or UK.

### Configuration

The server is single-tenant: it authenticates to one Xero organisation with a
[Custom Connection](https://developer.xero.com/documentation/guides/oauth2/custom-connections/)
(client credentials) and every request carries the configured tenant ID. All
configuration is read from environment variables (a local `.env` file is
loaded if present; see `.env.example`).

| Variable | Required | Purpose |
|----------|----------|---------|
| `XERO_CLIENT_ID` | yes | Custom Connection client ID |
| `XERO_CLIENT_SECRET` | yes | Custom Connection client secret |
| `XERO_TENANT_ID` | yes | The organisation every request targets. Never inferred from the first connection. |
| `XERO_CONFIRMATION_SECRET` | yes | Keys (HMAC) the preview→confirm tokens used by draft mutations. Use a long random value. |
| `XERO_CONFIRMATION_TTL_SECONDS` | no | Lifetime of a preview confirmation token, 1–3600 (default 600). |
| `MCP_AUTH_TOKEN` | http mode | Shared secret HTTP clients must send as `Authorization: Bearer …` (minimum 32 characters). |
| `MCP_BIND_HOST` | no | Interface the HTTP listener binds to (default `127.0.0.1`). |
| `PORT` | no | HTTP port, 0–65535 (default 3000). |
| `MCP_ALLOWED_HOSTS` | no | Comma-separated extra hostnames accepted in the HTTP `Host` header (loopback is always accepted). |
| `MCP_ALLOWED_ORIGINS` | no | Comma-separated extra origins accepted in the HTTP `Origin` header (loopback is always accepted). |
| `MCP_MAX_BODY_BYTES` | no | Largest accepted HTTP request body (default 1 MiB). |

Invalid values fail at startup with a message that names the variable but
never echoes its value. Wildcards (`*`) are rejected in both allowlists.

##### Required Xero scopes

Add the scopes in [`CLIENT_CREDENTIAL_SCOPES`](src/xero/client.ts) to your
Custom Connection. There is no `XERO_SCOPES` override.

##### Integrating the MCP server with Claude Desktop (stdio)

Go to Settings > Developer > Edit config and add the following to your
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "xero": {
      "command": "npx",
      "args": ["-y", "@xeroapi/xero-mcp-server@latest"],
      "env": {
        "XERO_CLIENT_ID": "your_client_id_here",
        "XERO_CLIENT_SECRET": "your_client_secret_here",
        "XERO_TENANT_ID": "your_tenant_id_here",
        "XERO_CONFIRMATION_SECRET": "a_long_random_value"
      }
    }
  }
}
```

NOTE: If you are using [Node Version Manager](https://github.com/nvm-sh/nvm) `"command": "npx"` section change it to be the full path to the executable, ie: `your_home_directory/.nvm/versions/node/v22.14.0/bin/npx` on Mac / Linux or `"your_home_directory\\.nvm\\versions\\node\\v22.14.0\\bin\\npx"` on Windows

### HTTP mode

`node dist/index.js http` serves MCP `2026-07-28` over stateless Streamable
HTTP at `POST /mcp`. Before relying on it, understand what protects it:

- **Authentication is required.** Every request must carry
  `Authorization: Bearer <MCP_AUTH_TOKEN>`; anything else receives `401` with a
  `WWW-Authenticate` challenge before any body byte is read.
- **Loopback by default.** The listener binds `127.0.0.1`. Set
  `MCP_BIND_HOST` only when you intend other machines to reach it, and put TLS
  in front (the server speaks plain HTTP).
- **Host / Origin validation is DNS-rebinding protection, not authentication.**
  A direct client can send any `Host` header it likes; the bearer token is what
  keeps strangers out. `MCP_ALLOWED_HOSTS` and `MCP_ALLOWED_ORIGINS` are
  separate lists — granting a browser origin never widens the `Host` allowlist.
- **Bodies are capped** at `MCP_MAX_BODY_BYTES`; larger requests receive `413`.
- The startup line `xero-mcp http listening on http://…/mcp` is written to
  stderr. Nothing is ever written to stdout in HTTP mode.

Legacy (2025-era) MCP traffic — `initialize`, `Mcp-Session-Id`, `GET` SSE
streams — is rejected.

### Available MCP tools

The modernisation is in progress. The served tool catalogue is asserted by
[`src/mcp/server.test.ts`](src/mcp/server.test.ts) and is currently **empty**:
the read tools under `src/tools/list` and `src/tools/get` are being ported
behind the new result boundary, and the draft-only mutation tools
(preview → confirm → apply for invoices, credit notes, quotes, purchase orders
and manual journals) will be registered once that boundary exists.

No tool will ever create, approve, pay, send, void or otherwise transition a
Xero record beyond `DRAFT`; the former direct-write tools have been removed.

For detailed API documentation, please refer to the [MCP Protocol Specification](https://modelcontextprotocol.io/).

## For Developers

### Installation

```bash
# Using npm
npm install

# Using pnpm
pnpm install
```

### Run a build

```bash
# Using npm
npm run build

# Using pnpm
pnpm build
```

### Run the server

```bash
npm run dev -- stdio   # or: node dist/index.js
npm run dev -- http    # requires MCP_AUTH_TOKEN; see "HTTP mode"
```

### Release gate

```bash
npm run typecheck && npm run lint && npm run build && npm test && npm run test:eval
```

### Integrating with Claude Desktop

To link your Xero MCP server in development to Claude Desktop go to Settings > Developer > Edit config and add the following to your `claude_desktop_config.json` file:

NOTE: For Windows ensure the `args` path escapes the `\` between folders ie. `"C:\\projects\xero-mcp-server\\dist\\index.js"`

```json
{
  "mcpServers": {
    "xero": {
      "command": "node",
      "args": ["insert-your-file-path-here/xero-mcp-server/dist/index.js"],
      "env": {
        "XERO_CLIENT_ID": "your_client_id_here",
        "XERO_CLIENT_SECRET": "your_client_secret_here",
        "XERO_TENANT_ID": "your_tenant_id_here",
        "XERO_CONFIRMATION_SECRET": "a_long_random_value"
      }
    }
  }
}
```

## License

MIT

## Security

- Never commit your `.env` file or any credentials (it is in `.gitignore`).
- Xero tokens, client secrets and `Authorization` headers are never written to
  tool output or logs; error text passes through a redaction layer.
- Xero mutations are draft-only and require a preview confirmation token that
  is single-use, HMAC-keyed with `XERO_CONFIRMATION_SECRET`, bound to the
  operation/payload/target version, and expires after
  `XERO_CONFIRMATION_TTL_SECONDS`.
- HTTP mode requires `MCP_AUTH_TOKEN` and binds loopback by default; see
  "HTTP mode" above before exposing it anywhere.
- Every read-tool input is validated (UUIDs, bounded pages, `YYYY-MM-DD`
  dates, quote-free filter text) before it reaches a Xero query.

The latest review and the tests that back each item:
[`docs/security-review-2026-08-22.md`](docs/security-review-2026-08-22.md).
