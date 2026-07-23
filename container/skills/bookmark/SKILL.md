---
name: bookmark
description: Save a URL to the bookmark list at /workspace/agent/bookmarks.md. Fetches the page/repo, writes a summary paragraph, and adds tags. Use when the user sends a link and says "bookmark this" or similar.
---

# /bookmark — Save a URL to Bookmarks

Save a URL to `/workspace/agent/bookmarks.md` with a title, tags, and a short summary paragraph written at save time.

## When to trigger

Trigger when the user:
- Sends a URL and says "bookmark this" / "save this" / "add to bookmarks"
- Sends one or more URLs without explicit instruction but in context of saving for later

## Steps

### 1. Extract URLs

Parse all URLs from the user's message.

### 2. Fetch metadata for each URL

**GitHub repos** — use the GitHub API:
```bash
curl -s "https://api.github.com/repos/{owner}/{repo}" | node -e "
const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
console.log('desc:', j.description);
console.log('stars:', j.stargazers_count);
console.log('lang:', j.language);
console.log('topics:', j.topics?.join(', '));
"
```

**Blog posts / web pages** — fetch the page and extract:
- `<title>` tag
- `<meta name="description">` or `<meta property="og:description">`
- Strip HTML and read a few hundred characters of body text for context

### 3. Write the bookmark entry

Append to `/workspace/agent/bookmarks.md`:

```markdown

### {Title}
**URL:** {url}
**Tags:** {auto-generated tags like #ai #tools #productivity #self-hosted etc.}
{One paragraph summary — what it is, what problem it solves, why it's interesting. 2-4 sentences.}

---
```

Use today's date as a section header if it doesn't already exist for today.

### 4. Confirm to the user

Send a short confirmation: title + one-line description of what was saved. No need to repeat the full summary.

## Bookmarks file location

`/workspace/agent/bookmarks.md`

Create it if it doesn't exist with a `# Bookmarks` header.

## Tag guidelines

Auto-generate 2-5 relevant tags. Common tags:
- `#ai`, `#llm`, `#claude`, `#mcp`, `#agents`
- `#tools`, `#cli`, `#productivity`
- `#self-hosted`, `#open-source`
- `#travel`, `#finance`, `#health`
- `#design`, `#frontend`, `#backend`
- `#education`, `#research`

## Searching bookmarks

When the user asks "do you have anything on X?" or "find me bookmarks about Y":
- Read `/workspace/agent/bookmarks.md`
- Search tags and summary text for the topic
- Return matching entries with title, URL, and the summary paragraph
