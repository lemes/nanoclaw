# OneCLI Proxy Internals

Reference for how the OneCLI gateway proxy handles credential injection. Based on source analysis of OneCLI v1.15.1 (`apps/gateway/src/`). Installed version: v1.2.0.

## How It Works

Containers route all HTTP/HTTPS traffic through the OneCLI proxy via `HTTP_PROXY`/`HTTPS_PROXY` environment variables, injected by the SDK's `applyContainerConfig()`. The proxy intercepts requests, matches them against configured secrets, and injects credentials before forwarding upstream. Containers never see raw API keys or tokens.

## Host Matching

Host patterns are matched against the request's hostname with **ports stripped** (`strip_port()` in `gateway.rs`).

Two matching modes:

| Pattern | Matches | Does Not Match |
|---------|---------|----------------|
| `api.example.com` | `api.example.com` | `example.com`, `sub.api.example.com` |
| `*.example.com` | `api.example.com`, `sub.api.example.com` | `example.com` |

- Matching is **case-insensitive** (patterns are pre-lowercased)
- Port is always stripped: a request to `host.docker.internal:3333` matches `hostPattern: "host.docker.internal"`
- Setting `hostPattern: "host.docker.internal:3333"` is treated as hostname `host.docker.internal` (the `:3333` is stripped) — it does **not** restrict to port 3333

## Path Matching

Three modes:

| Pattern | Matches | Does Not Match |
|---------|---------|----------------|
| `*` | Everything | — |
| `/v1/*` | `/v1/messages`, `/v1/foo/bar` | `/v2/foo` |
| `/connections` | `/connections` | `/connections/123` |

- Prefix patterns (`/v1/*`) require a `/` boundary — `/v1messages` would not match
- When a secret has no `pathPattern`, it defaults to `*` (match all paths)

## Multiple Secrets on Same Host

When multiple secrets share a `hostPattern`:

1. All secrets matching the hostname are collected
2. Each becomes an `InjectionRule` with its `pathPattern`
3. During request forwarding, rules are evaluated in order — **first matching path wins**
4. Order is determined by the database query (creation order)

This means overlapping patterns can conflict. For example, if secret A has `/api/*` and secret B has `*`, and B was created first, B wins for `/api/foo`.

## Injection

For generic secrets, the proxy injects an HTTP header based on `injectionConfig`:

```
headerName: "Authorization"
valueFormat: "Bearer {value}"
```

The `{value}` placeholder is replaced with the decrypted secret. Injection is identical for HTTP and HTTPS requests — both go through `forward_request()`.

For Anthropic-type secrets, injection follows the Anthropic API convention (`x-api-key` header).

## HTTP vs HTTPS

- **HTTP**: Plain proxy request with absolute URI. The proxy reads the request, applies injection, forwards upstream via `reqwest`
- **HTTPS**: CONNECT tunnel → TLS interception (MITM with proxy CA cert) → same `forward_request()` path

Both use identical injection and policy logic. The container must trust the proxy's CA certificate (mounted at `/tmp/onecli-gateway-ca.pem` via `NODE_EXTRA_CA_CERTS`).

## Policy Rules

Evaluated in order of precedence: **Block > ManualApproval > RateLimit > Allow**.

Policy decisions are cached per `(account_id, agent_token, hostname)` with a 60-second TTL.

## DNS Resolution

The proxy resolves hostnames via standard system DNS (including `/etc/hosts`). There is no hostname allowlist — any resolvable host can be forwarded to.

## SDK Integration

The SDK's `applyContainerConfig()` adds these to the container's `docker run` args:

- `HTTP_PROXY` / `HTTPS_PROXY` — proxy URL with embedded agent token
- `NODE_EXTRA_CA_CERTS` — path to proxy CA cert (for HTTPS MITM)
- `SSL_CERT_FILE` — combined system + proxy CA bundle
- `CLAUDE_CODE_OAUTH_TOKEN=placeholder` — replaced by proxy at request time
