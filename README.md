# Pi Workboard

**Durable, Jira-style work tracking for [Pi](https://github.com/earendil-works/pi-coding-agent) coding-agent sessions.**

Conversations are temporary. Your tickets are durable project state.

Pi Workboard is a Pi extension that lets the agent (and you) capture agreed
requirements, decisions, scope, dependencies, acceptance criteria, and progress
as structured tickets stored locally on disk. They survive context compaction,
session restarts, and model switches — so the agent never forgets what it was
doing or why.

> This is a local developer tool, not a Jira replacement or a multi-user
> project-management platform. No server, no database, no accounts.

---

## Why

- **Preserve context outside the chat.** Finalized requirements, rejected
  approaches, and decisions live in a ticket, not buried in history.
- **One active ticket at a time.** The active ticket is the source of truth for
  the current work; blockers gate what you start.
- **Evidence-based completion.** A ticket can only be marked done when every
  acceptance criterion is verified — with evidence.
- **Resumable.** After compaction or a session restart, Pi reloads the active
  ticket automatically.

---

## Features

- 🎫 Structured work tickets (`backlog → ready → in_progress → in_review → done`)
- 🔗 Dependencies & blocking (`blocked_by`, `related_to`) with cycle detection
- ✅ Acceptance-criteria tracking with required verification evidence
- 🧭 Next-ticket selection that respects blockers
- 💬 Progress & decision log (notes, decisions, implementation, verification)
- 🖥️ Slash commands for humans and tools for the agent
- 📊 A zero-dependency live dashboard you can open in your browser
- 💾 Local file storage under `.pi/workboard/` — nothing leaves your machine

---

## Install

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Pi](https://github.com/earendil-works/pi-coding-agent) installed and on your `PATH`

### 1. Install the package

From the project you want to track work in:

```bash
npm install pi-workboard
```

Or clone it directly:

```bash
git clone https://github.com/tejasghutukade/pi-workboard.git
cd pi-workboard
npm install
```

### 2. Register the extension with Pi

Add `pi-workboard` to your Pi `extensions` config (usually in
`pi.config.json` or your project's `.pi/` settings). For example:

```json
{
  "extensions": ["pi-workboard"]
}
```

If you installed it from git instead of npm, point Pi at the local folder:

```json
{
  "extensions": ["./pi-workboard"]
}
```

### 3. Verify it loaded

Start Pi in your project and run:

```
/board
```

You should see an (empty) workboard. That's it — you're ready to track work.

---

## Quick start

Capture a piece of work so it survives compaction:

```
/ticket-new
```

Pi will ask for a title, objective, scope, and acceptance criteria, then create
a backlog/ready ticket like `WB-0001`.

Work on the next actionable ticket:

```
/ticket-work WB-0001
```

This tells Pi to start the ticket, move it to `in_progress`, and implement it
inside an isolated git worktree it creates for you.

See the whole board any time:

```
/board
```

Open the live dashboard:

```
/workboard-dashboard
```

A browser tab opens at `http://localhost:8777` showing tickets that auto-refresh
as you work.

---

## Commands (for humans)

| Command               | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `/board`              | Render the workboard (Ready, In Progress, Blocked, Done).           |
| `/ticket WB-0001`     | Show a full ticket.                                                 |
| `/ticket-new`         | Interactively create a ticket (required fields only).               |
| `/ticket-next`        | Show the best next actionable ticket without starting it.          |
| `/ticket-start WB-…`  | Start a ready ticket and make it active.                            |
| `/ticket-work WB-…`   | Have the agent work the ticket in a fresh git worktree.             |
| `/ticket-block WB-…`  | Block a ticket with a reason (and optional blocker).                |
| `/ticket-review WB-…` | Submit an in_progress ticket for review (`in_review`).              |
| `/ticket-changes WB-…`| Return an in_review ticket to in_progress (changes requested).      |
| `/workboard-prefix TSK`| Set the prefix for new ticket ids (e.g. `TSK-0001`).              |
| `/workboard-dashboard`| Launch the live, auto-refreshing dashboard in your browser.        |
| `/workboard-dashboard 9000`| Same, but on port 9000 (overrides `WORKBOARD_PORT`).          |

## Tools (for the agent)

The extension also registers `workboard_*` tools the agent calls directly:
`workboard_create`, `workboard_get`, `workboard_list`, `workboard_next`,
`workboard_start`, `workboard_set_worktree`, `workboard_update`,
`workboard_progress`, `workboard_acceptance`, `workboard_block`,
`workboard_unblock`, `workboard_complete`, `workboard_review`,
`workboard_changes`, `workboard_ready`, and `workboard_set_prefix`.

---

## Where data lives

All state is stored locally under your project:

```
.pi/workboard/
  board.json            # id counter + active ticket id
  tickets/WB-0001.json  # one file per ticket
```

Nothing is sent over the network. Delete the folder to reset.

---

## Development

```bash
npm install
npm test          # run the 100+ unit/adapter tests
npm run typecheck # type-check with tsc --noEmit
npm run dashboard # serve the dashboard against the cwd's workboard
```

Project layout:

```
domain/      # pure ticket/board/status types (no I/O)
storage/     # file-backed repositories, id generator, validation
services/    # ticket, lifecycle, dependency, selection, session services
pi/          # Pi tool/command/lifecycle registration + rendering
dashboard/   # zero-dependency live viewer (server.mjs + index.html)
tests/       # vitest unit + adapter tests
```

---

## How it stays safe

- No ticket mutation happens through generic field writes — every state change
  goes through the lifecycle service, which enforces valid transitions.
- A ticket can only become `ready` once it has a title, objective, background,
  at least one scope item, and at least one acceptance criterion.
- A ticket can only be `done` once all acceptance criteria are verified.
- Dependency graphs are checked for cycles before they are saved.

---

## License

[MIT](./LICENSE) — see the file for details.

---

## Status

Early preview (`0.1.0`). The core domain, storage, services, tools, commands,
and dashboard are implemented and covered by tests. See
[`Pi-Workboard-Extension-Blueprint.md`](./Pi-Workboard-Extension-Blueprint.md)
for the full design blueprint.
