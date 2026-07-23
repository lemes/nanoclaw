# Permission Model

An agent group's effective permissions come from six independent layers, stacked from "can it even be reached" down to "where can it send output." Each layer is enforced by a different mechanism and a different table/file — there is no single "permission level" per group.

## 1. Who can reach it

Messaging-group wiring plus `unknown_sender_policy` decide which chats route into a given agent group at all, and whether a new/unknown sender auto-registers, gets held for approval, or is dropped. This is upstream of everything else — a gate on whether the container ever gets woken for a given message. See [isolation-model.md](isolation-model.md) for how channels map to agent groups, and [setup-wiring.md](setup-wiring.md) for what's wired by default.

## 2. Who can administer it

Human privilege lives in `user_roles` + `agent_group_members` (central DB), resolved by `canAccessAgentGroup` in `src/modules/permissions/access.ts`:

- **owner** — always global (`agent_group_id` is always `null`), full control everywhere.
- **admin** — global or scoped to one agent group; admin at a group implies membership in it.
- **member** (`agent_group_members`, no role) — allowed to use the group, no admin power.

Resolution order: owner → global admin → scoped admin → member.

In practice a global admin has the same reach as owner — no code path checks `role === 'owner'` specifically. The two asymmetries: owner can never be scoped (the roles CLI rejects `--group` on an owner grant), and approval routing (`pickApprover`) prefers scoped admins → global admins → owner last, so the owner is the fallback approver, not the first pick.

## 3. What it can access inside the container

Per-agent-group container config (`container_configs` table, materialized to `groups/<folder>/container.json` at spawn):

- **Mounts** — `additionalMounts`, host folders exposed read-only or read-write.
- **Packages** — apt/npm packages baked into that group's own image tag.
- **Skills** — `skills` field (`"all"` or a subset list) controls which `container/skills/` instructions get loaded into that group's CLAUDE.md.
- **MCP servers** — `mcpServers`, which external tool integrations exist for this agent at all — independent of whether it holds credentials for them.
- **OneCLI secret access** — two separate knobs: `secretMode` (`all` vs `selective`, whether any matching secret gets injected at all) and host-pattern matching (which secret applies to which outbound request). Raw credentials never reach the container either way — see the Secrets section of the root `CLAUDE.md`.

## 4. What it can do to NanoClaw itself

`cli_scope` on the container config, enforced by `ncl` / host dispatch (`src/cli/dispatch.ts`):

| Value | Behavior |
|-------|----------|
| `disabled` | Agent doesn't even know `ncl` exists (instructions excluded from CLAUDE.md). |
| `group` (default) | Can touch only `groups`, `sessions`, `destinations`, `members`, scoped to its own agent group. Cross-group access and `cli_scope` changes are rejected. |
| `global` | Unrestricted. Auto-set for the owner's own agent group by `init-first-agent`. |

## 5. What still needs a human, regardless of scope

Even at `cli_scope: global`, sensitive actions gate through an approval card (`requestApproval` / `pickApprover`, `src/modules/approvals/primitive.ts`): self-mod actions (`install_packages`, `add_mcp_server`), role grants/revokes, and credentialed OneCLI calls if the gateway has an approval rule configured server-side. Scope decides *reach*; approval decides whether an in-scope action fires without asking a human first.

## 6. Where it can send output

A `destinations` entry is what lets an agent group send a message anywhere — a channel, or another agent group. No destination row means the agent can compute all day but can't reply or message a sibling agent. This is separate from every read/access permission above; see the note on wiring vs. destinations in memory/`wiring-is-inbound-only-destinations-are-the-reply-path.md` for the failure mode when this is missed.

---

Summary: **reach** (wiring/unknown-sender-policy) → **administration** (owner/admin/member) → **access** (mounts, packages, skills, MCP servers, secret mode) → **self-management power** (cli_scope) → **human-in-the-loop gates** (approvals) → **output** (destinations).
