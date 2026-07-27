#!/usr/bin/env node
// Render OpenCode transcripts into each group's conversations/ dir so qmd can
// index them.
//
// The claude provider archives transcripts itself (PreCompact hook); OpenCode
// has no equivalent hook, but it does persist every session in its own
// opencode.db under the per-session XDG mount. This reads those databases on
// the host and writes the markdown qmd expects. Nothing runs in the container.
//
// Run by refresh.sh before indexing; also safe to run by hand.
// Self-test: node export-opencode.mjs --self-check
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const GROUPS_DIR = path.join(REPO, 'groups');
const SESSIONS_DIR = path.join(REPO, 'data', 'v2-sessions');

// Matches formatTranscriptMarkdown in the claude provider, so both providers'
// archives read the same.
const MAX_CHARS = 2000;

// Top-level sessions only: `parent_id` is set on subagent sessions, whose
// outcome already lands in the parent transcript.
const SQL = `
  SELECT s.id, s.title, s.time_updated,
         m.id AS message_id, json_extract(m.data, '$.role') AS role,
         json_extract(p.data, '$.text') AS text
  FROM session s
  JOIN message m ON m.session_id = s.id
  JOIN part p    ON p.message_id = m.id
  WHERE s.parent_id IS NULL
    AND json_extract(p.data, '$.type') = 'text'
  ORDER BY s.time_created, m.time_created, p.time_created
`;

/**
 * Every user turn is wrapped by the provider's wrapPromptWithContext with the
 * full persona. Without stripping it the index is the same system prompt
 * repeated once per turn.
 *
 * Repeated on purpose: a delivery-retry nag is itself a <system> block, so the
 * wrapper makes that turn two consecutive blocks and nothing else. Stripping
 * only the first would leave the nag as the whole message.
 */
function stripSystem(text) {
  return text.replace(/^(?:<system>[\s\S]*?<\/system>\s*)+/, '').trim();
}

function slug(title) {
  return (
    (title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'conversation'
  );
}

/**
 * Stamped from the session's own last-update time, never from `now` — the file
 * has to be byte-identical across runs or every hourly pass re-embeds the whole
 * corpus.
 */
function renderMarkdown(session, turns, assistantName) {
  const stamp = new Date(session.time_updated).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const lines = [`# ${session.title || 'Conversation'}`, '', `Updated: ${stamp}`, '', '---', ''];
  for (const turn of turns) {
    const sender = turn.role === 'user' ? 'User' : assistantName || 'Assistant';
    const content = turn.text.length > MAX_CHARS ? `${turn.text.slice(0, MAX_CHARS)}...` : turn.text;
    lines.push(`**${sender}**: ${content}`, '');
  }
  return lines.join('\n');
}

/** Collapse the flat row set into one entry per session, one turn per message. */
function groupSessions(rows) {
  const sessions = new Map();
  for (const row of rows) {
    let session = sessions.get(row.id);
    if (!session) {
      session = { id: row.id, title: row.title, time_updated: row.time_updated, turns: new Map() };
      sessions.set(row.id, session);
    }
    const prev = session.turns.get(row.message_id);
    if (prev) prev.text += row.text ?? '';
    else session.turns.set(row.message_id, { role: row.role, text: row.text ?? '' });
  }
  return sessions;
}

function writeSession(dir, session, assistantName) {
  const turns = [...session.turns.values()]
    .map((t) => ({ role: t.role, text: stripSystem(t.text) }))
    .filter((t) => t.text);
  if (turns.length === 0) return false;

  // The id suffix keeps same-day sessions apart and lets us clear the previous
  // filename when OpenCode retitles a session mid-flight.
  const suffix = `-${session.id.slice(-6)}.md`;
  const date = new Date(session.time_updated).toLocaleDateString('sv-SE');
  const filename = `${date}-${slug(session.title)}${suffix}`;
  for (const existing of fs.readdirSync(dir)) {
    if (existing.endsWith(suffix) && existing !== filename) fs.unlinkSync(path.join(dir, existing));
  }

  const file = path.join(dir, filename);
  const body = renderMarkdown(session, turns, assistantName);
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === body) return false;
  fs.writeFileSync(file, body);
  return true;
}

function exportDb(dbPath, folder, assistantName) {
  let db;
  try {
    // Live WAL database: a readonly open can fail transiently while a container
    // is mid-write. Skip and let the next run pick it up.
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch (err) {
    console.error(`[qmd-export] skip ${dbPath}: ${err.message}`);
    return 0;
  }

  try {
    const sessions = groupSessions(db.prepare(SQL).all());
    if (sessions.size === 0) return 0;
    const dir = path.join(GROUPS_DIR, folder, 'conversations');
    fs.mkdirSync(dir, { recursive: true });
    let written = 0;
    for (const session of sessions.values()) {
      if (writeSession(dir, session, assistantName)) written++;
    }
    return written;
  } catch (err) {
    console.error(`[qmd-export] failed ${dbPath}: ${err.message}`);
    return 0;
  } finally {
    db.close();
  }
}

/** Groups running the opencode provider, from the container.json spawn writes. */
function opencodeGroups() {
  if (!fs.existsSync(GROUPS_DIR)) return [];
  const groups = [];
  for (const folder of fs.readdirSync(GROUPS_DIR)) {
    const configPath = path.join(GROUPS_DIR, folder, 'container.json');
    if (!fs.existsSync(configPath)) continue;
    let config;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {
      continue;
    }
    if (config.provider !== 'opencode' || !config.agentGroupId) continue;
    groups.push({ folder, agentGroupId: config.agentGroupId, assistantName: config.assistantName });
  }
  return groups;
}

function dbPaths(agentGroupId) {
  const base = path.join(SESSIONS_DIR, agentGroupId);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base)
    .map((session) => path.join(base, session, 'opencode-xdg', 'opencode', 'opencode.db'))
    .filter((p) => fs.existsSync(p));
}

function selfCheck() {
  assert.equal(stripSystem('<system>\npersona\n</system>\n\nhello'), 'hello');
  assert.equal(stripSystem('<system>re-send with wrapping</system>'), '', 'pure-system nags drop out');
  assert.equal(
    stripSystem('<system>persona</system>\n\n<system>re-send with wrapping</system>'),
    '',
    'a wrapped nag is two blocks and nothing else',
  );
  assert.equal(
    stripSystem('<system>persona</system>\n\n<context tz="x" />\n<message>hi</message>'),
    '<context tz="x" />\n<message>hi</message>',
    'repetition stops at the first non-system content',
  );
  assert.equal(stripSystem('plain text'), 'plain text');
  assert.equal(
    stripSystem('<system>a</system>\n\nbefore </system> after'),
    'before </system> after',
    'a stray closing tag in the body must not eat the message',
  );

  assert.equal(slug('Free phone number options'), 'free-phone-number-options');
  assert.equal(slug(''), 'conversation');

  const session = { title: 'Ping test', time_updated: Date.UTC(2026, 6, 26, 12, 0) };
  const md = renderMarkdown(session, [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'yo' }], 'Greg');
  assert.match(md, /^# Ping test\n/);
  assert.match(md, /\*\*User\*\*: hi/);
  assert.match(md, /\*\*Greg\*\*: yo/);
  assert.equal(renderMarkdown(session, [], 'Greg'), md.split('---')[0] + '---\n', 'header is stable');

  const long = { role: 'user', text: 'x'.repeat(MAX_CHARS + 50) };
  assert.ok(renderMarkdown(session, [long], 'Greg').includes(`${'x'.repeat(MAX_CHARS)}...`));

  const grouped = groupSessions([
    { id: 's1', title: 'T', time_updated: 1, message_id: 'm1', role: 'assistant', text: 'part-a ' },
    { id: 's1', title: 'T', time_updated: 1, message_id: 'm1', role: 'assistant', text: 'part-b' },
    { id: 's1', title: 'T', time_updated: 1, message_id: 'm2', role: 'user', text: 'next' },
  ]);
  assert.equal(grouped.size, 1);
  assert.deepEqual(
    [...grouped.get('s1').turns.values()].map((t) => t.text),
    ['part-a part-b', 'next'],
    'multi-part messages join into one turn',
  );

  console.log('[qmd-export] self-check ok');
}

if (process.argv.includes('--self-check')) {
  selfCheck();
} else {
  let total = 0;
  for (const group of opencodeGroups()) {
    for (const dbPath of dbPaths(group.agentGroupId)) {
      total += exportDb(dbPath, group.folder, group.assistantName);
    }
  }
  console.log(`[qmd-export] wrote ${total} transcript(s)`);
}
