---
name: ghostfolio
description: Query the user's Ghostfolio investment portfolio — holdings, performance, dividends, accounts, activities. Use when the user asks about investments, portfolio, stocks, ETFs, crypto, or finances.
allowed-tools: Bash(curl:*)
---

# Ghostfolio — Portfolio Data

Query the user's investment portfolio via the Ghostfolio REST API. Authentication is handled automatically by the credential proxy — do not add any auth headers.

**Base URL:** `http://ghostfolio:3333/api/v1`

## Endpoints

### Portfolio

```bash
# Current holdings with values and allocation
curl -s http://ghostfolio:3333/api/v1/portfolio/holdings

# Portfolio performance over a time range
curl -s "http://ghostfolio:3333/api/v1/portfolio/performance?range=1y"

# Dividend history
curl -s "http://ghostfolio:3333/api/v1/portfolio/dividends?range=1y"

# Full portfolio details (includes allocation breakdown)
curl -s "http://ghostfolio:3333/api/v1/portfolio/details?range=1y"

# Investment timeline
curl -s "http://ghostfolio:3333/api/v1/portfolio/investments?range=1y"

# Details for a specific holding
curl -s http://ghostfolio:3333/api/v1/portfolio/holding/YAHOO/AAPL
```

**Range values:** `1d`, `1w`, `1m`, `3m`, `6m`, `ytd`, `1y`, `3y`, `5y`, `max`

### Accounts

```bash
# List all accounts
curl -s http://ghostfolio:3333/api/v1/account

# Account details
curl -s http://ghostfolio:3333/api/v1/account/{accountId}

# Account balances
curl -s http://ghostfolio:3333/api/v1/account/{accountId}/balances
```

### Activities (Transactions)

```bash
# List recent activities
curl -s http://ghostfolio:3333/api/v1/activities

# Single activity
curl -s http://ghostfolio:3333/api/v1/activities/{activityId}
```

### Symbol Lookup

```bash
# Search for a symbol by name
curl -s "http://ghostfolio:3333/api/v1/symbol/lookup?query=Apple"

# Get symbol details
curl -s http://ghostfolio:3333/api/v1/symbol/YAHOO/AAPL
```

### Export

```bash
# Export all portfolio data
curl -s http://ghostfolio:3333/api/v1/export
```

## Usage Notes

- All responses are JSON. Parse and format them nicely for the user.
- If you get a `401 Unauthorized`, tell the user their Ghostfolio token needs refreshing: `npx tsx scripts/ghostfolio-auth.ts refresh`
- Use the `lookup` endpoint when the user mentions a company name instead of a ticker symbol.
- The `holdings` endpoint is the most useful starting point for "what do I own?" questions.
- The `performance` endpoint with different ranges answers "how am I doing?" questions.
