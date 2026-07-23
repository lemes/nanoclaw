---
name: qmd
description: Semantic + keyword search over this group's past conversations. Use when the user references something discussed before, asks "what did we say about X", or you need context from earlier sessions that isn't in the current thread.
allowed-tools: mcp__qmd__query, mcp__qmd__get, mcp__qmd__multi_get, mcp__qmd__status, Bash(grep:*), Glob, Read
---

# Conversation Search (qmd)

Your past conversations with this group are indexed for hybrid search (BM25 keyword +
on-device vector embeddings + reranking) by a qmd MCP server running on the host. Use it
to recall context from earlier sessions instead of asking the user to repeat themselves.

## When to use

- The user references something from before ("like we discussed", "that thing last week").
- You need a decision, preference, or fact established in a past session.
- A question would be better answered with history than a fresh guess.

Do **not** use it for the current thread (you already have that) or for general knowledge.

## Tools (MCP, preferred)

The server is wired as the `qmd` MCP server (`http://host.docker.internal:8182/mcp`).
It is scoped to **your group only** — the host runs a separate, isolated qmd instance
per group, and your bearer token routes you to yours. You cannot see, and don't need
to name, any other group's history. Just search; there's only one collection (yours).

- `mcp__qmd__query` — hybrid search. Pass typed sub-queries and an `intent`:
  ```json
  {
    "searches": [
      { "type": "lex", "query": "exit node country" },
      { "type": "vec", "query": "switching the VPN exit node to another country" }
    ],
    "intent": "find when we set up or changed the Tailscale exit node",
    "limit": 10
  }
  ```
  - `lex` = exact keywords (supports `"phrases"` and `-negation`)
  - `vec` = semantic meaning
  - `hyde` = write what the ideal answer looks like
- `mcp__qmd__get` — fetch a document by path or `#docid` (supports `path.md:120` line offset).
- `mcp__qmd__multi_get` — batch fetch by glob or comma-separated list.
- `mcp__qmd__status` — index health + the (single) collection's doc count.

## Fallback: direct file search

If the MCP server is unreachable, conversation transcripts are on disk:

```bash
grep -ril "term" /workspace/agent/conversations/
ls -lt /workspace/agent/conversations/ | head
```

These are slower and keyword-only (no semantic match), but always available.

## Notes

- Results' file paths are relative to the collection; pass them to `mcp__qmd__get`.
- Use `minScore: 0.5` to drop low-confidence hits.
- The index refreshes periodically on the host, so very recent turns may not be searchable
  for up to an hour — fall back to file grep for the latest session.
