---
name: capabilities
description: Show what this NanoClaw instance can do — installed skills, available tools, and system info. Read-only. Use when the user asks what the bot can do, what's installed, or runs /capabilities.
---

# /capabilities — System Capabilities Report

Generate a structured read-only report of what this NanoClaw instance can do.

## How to gather the information

Run these commands and compile the results into the report format below.

### 1. Installed skills

List skill directories available to you:

```bash
ls -1 /home/node/.claude/skills/ 2>/dev/null || echo "No skills found"
```

Each directory is an installed skill. The directory name is the skill name (e.g., `agent-browser` → `/agent-browser`).

### 2. Available tools

You always have access to:
- **Core:** Bash, Read, Write, Edit, Glob, Grep
- **Web:** WebSearch, WebFetch
- **Orchestration:** Task, TaskOutput, TaskStop, SendMessage (agent teams)
- **Other:** TodoWrite, ToolSearch, Skill, NotebookEdit

### 3. MCP server tools

The NanoClaw MCP server exposes these tools (via `mcp__nanoclaw__*` prefix):
- `send_message` — send a message to the user/group
- `send_file` — send a file/image to the user/group
- `edit_message` — edit a message already sent
- `add_reaction` — react to a message
- `ask_user_question` — ask the user a multiple-choice question
- `send_card` — send a rich card
- `ncl tasks list/get/create/update/cancel/pause/resume/delete` — scheduling (CLI, not MCP)
- `create_agent` — create a new agent group / wire a chat
- `install_packages` — request apt/npm packages for this container (admin-approved)
- `add_mcp_server` — wire an external MCP server (admin-approved)

### 4. Container skills (Bash tools)

Check for executable tools in the container:

```bash
which agent-browser 2>/dev/null && echo "agent-browser: available" || echo "agent-browser: not found"
```

### 5. Group info

```bash
# Shared memory tree (OKF bundle) + standing instructions. Both are optional.
ls /workspace/agent/memory/ 2>/dev/null | head -5 && echo "Group memory: yes" || echo "Group memory: none yet"
ls /workspace/agent/instructions.prepend.md 2>/dev/null >/dev/null && echo "Standing instructions: yes" || echo "Standing instructions: no"
# Any additional host directories mounted for this group appear under /workspace/ (e.g. /workspace/gcloud)
ls -d /workspace/*/ 2>/dev/null | grep -vE '/agent/$' || true
```

## Report format

Present the report as a clean, readable message. Example:

```
📋 *NanoClaw Capabilities*

*Installed Skills:*
• /agent-browser — Browse the web, fill forms, extract data
• /capabilities — This report
(list all found skills)

*Tools:*
• Core: Bash, Read, Write, Edit, Glob, Grep
• Web: WebSearch, WebFetch
• Orchestration: Task, SendMessage (agent teams)
• MCP: send_message, send_file, edit_message, add_reaction, ask_user_question, send_card, create_agent, install_packages, add_mcp_server (scheduling: `ncl tasks`)

*Container Tools:*
• agent-browser: ✓

*Workspace:*
• Group memory (/workspace/agent/memory): yes/none yet
• Standing instructions: yes/no
• Additional mounts: (list any /workspace/<name> dirs)
```

Adapt the output based on what you actually find — don't list things that aren't installed.

**See also:** `/status` for a quick health check of session, workspace, and tasks.
