---
name: wiki
description: Maintain a persistent, structured knowledge wiki for this group — a compiled, interlinked markdown knowledge base built from curated sources. Use when the user shares a source to file (URL, PDF, paper, note, transcript), asks a question that should be answered from accumulated knowledge, or asks to review/clean the wiki. Based on Karpathy's LLM Wiki pattern.
allowed-tools: Read, Write, Edit, Glob, Bash(grep:*), Bash(ls:*), Bash(curl:*), mcp__qmd__query
---

# Wiki — structured knowledge base

You maintain a **persistent, compiled wiki** for this group: a structured, interlinked
collection of markdown pages that sits between the user and raw sources. This is **not**
RAG over raw documents — you *integrate* knowledge once into durable pages and keep them
current, rather than re-deriving answers from scratch each time.

> The human curates sources and asks good questions. You do the bookkeeping: summarizing,
> cross-referencing, filing, flagging contradictions, keeping pages consistent.

## Layout (persistent, under `/workspace/agent/`)

| Path | What it is | Who owns it |
|------|-----------|-------------|
| `sources/` | Immutable raw material the user gives you (PDFs, saved articles, notes). | User curates; you **read, never modify**. |
| `wiki/` | Your synthesized pages: topics, concepts, entities, comparisons. | **You own entirely** — create & revise freely. |
| `wiki/index.md` | Catalog of every page (one line each, by category). | You, on **every** ingest. |
| `wiki/log.md` | Append-only timeline of ingests/queries/lints. | You append, never rewrite. |

Suggested page folders (create as needed, don't over-structure up front):
`wiki/topics/` · `wiki/concepts/` · `wiki/entities/` · `wiki/syntheses/`. Use
relative markdown links between pages so cross-references resolve in any viewer/Obsidian.

## The three operations

### 1. Ingest (a new source arrives)

**Process sources ONE AT A TIME — this is the most important rule.** If the user
drops several files or points at a folder, do them sequentially: fully finish one
before touching the next. Never batch-read everything and write pages at the end —
that produces shallow, generic pages instead of deep integration. For each source:

1. **Get the full text** (not a summary):
   - **PDF:** `Read` the file directly — PDF content (text + figures) is ingested
     natively, no conversion needed. For long papers, read in page ranges so nothing
     is truncated.
   - **URL:** download the real content — `curl -sLo sources/<name>.<ext> "<url>"` for
     files, or use `agent-browser` to open a page and extract full text. Do **not** rely
     on `WebFetch` (it returns a summary, which makes weak pages).
   - Save the raw artifact into `sources/` so it's reproducible.
2. **Read it fully and discuss takeaways** with the user.
3. **Integrate** — a single source typically touches 10–15 pages:
   - update/create concept & entity pages with what's new,
   - revise affected summaries,
   - add cross-references both directions,
   - **flag contradictions** with existing pages (note them on both pages, don't silently overwrite),
   - update `wiki/index.md`,
   - append a `## [YYYY-MM-DD] ingest | <title>` entry to `wiki/log.md`.

### 2. Query (a question against the wiki)

1. Read `wiki/index.md` first to locate relevant pages, then drill in.
   At scale (hundreds of pages), use `mcp__qmd__query` if the wiki is indexed (see below).
2. Synthesize an answer **with citations** to the wiki pages (and through them, sources).
3. If the answer is a meaningful new synthesis, **file it back** as a new `wiki/` page and
   index it — explorations should compound in the wiki, not vanish into chat history.

### 3. Lint (periodic health check)

Scan for: contradictions, stale claims superseded by newer sources, orphan pages (no
inbound links), important concepts lacking a dedicated page, missing cross-references,
data gaps. Report findings and suggest sources/investigations to pursue. Append a
`## [YYYY-MM-DD] lint` entry to `wiki/log.md`.

## Conventions

- Pages are markdown, kebab-case filenames. Add YAML frontmatter (e.g. `tags`, `updated`,
  `sources:`) when useful — it stays Obsidian/Dataview-friendly.
- Keep `index.md` and `log.md` accurate; they're how you (and the user) navigate.
- Prefer revising an existing page over creating a near-duplicate.
- The pattern is intentionally open — evolve structure as the wiki's domain becomes clear.

## Search at scale (optional)

While the wiki is small, `index.md` is enough. Once it grows past a few hundred pages,
it can be indexed by qmd as its own collection (hybrid BM25 + vector + rerank), and you
query it via `mcp__qmd__query`. Ask the operator to add `wiki/` as a qmd collection when
you reach that point.
