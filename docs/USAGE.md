# Pi Workboard — Usage

A short, practical guide to getting value out of the workboard in a real
coding session.

## Mental model

- **Conversation is temporary. Tickets are durable.**
  Capture agreed scope and decisions in a ticket so they survive compaction.
- **One active ticket at a time.** The active ticket is the source of truth.
  Blockers can still gate what you start, but parallel work is allowed.
- **Close only when verified.** A ticket is `done` only after every acceptance
  criterion is marked complete *with evidence*.

## A typical flow

### 1. Capture work

```
/ticket-new
```

Answer the prompts. Pi creates a ticket, e.g. `WB-0001`. If the required
refinement fields are missing, it lands in `backlog`; once complete, promote it:

```
/workboard_ready   # (via the workboard_ready tool)
# or /ticket-new completeness path
```

### 2. Start working

```
/ticket-work WB-0001
```

The agent will:
1. Move `WB-0001` to `in_progress`.
2. Create an isolated git worktree under `.worktrees/WB-0001`.
3. Record the worktree path (`workboard_set_worktree`) so it shows in the
   dashboard.
4. Implement, logging progress as it goes.

### 3. Log progress

As material work happens, the agent records entries:

- `note` — context worth keeping
- `decision` — a choice that should not be reopened without new evidence
- `implementation` — what was built
- `verification` — how something was checked
- `blocker` — something stopping progress
- `status_change` — lifecycle movement

### 4. Verify and complete

Each acceptance criterion needs evidence before it can be marked complete:

```
/workboard_acceptance  WB-0001  AC-1  true  "vitest passes: npm test"
```

When all criteria are verified, complete the ticket:

```
/workboard_complete  WB-0001  "All ACs verified; merged to main."
```

### 5. Review loop

- `/ticket-review WB-0001` → moves to `in_review`
- `/ticket-changes WB-0001` → back to `in_progress` if changes are requested

## Dependencies & blocking

```
/workboard_create  --dependencies WB-0002:blocked_by
/workboard_block   WB-0001  "Waiting on WB-0002 auth refactor"
/workboard_unblock WB-0001   # after WB-0002 lands
```

Cycles (`A→B→C→A`) are rejected before they are saved.

## Dashboard

```
/workboard-dashboard
```

Opens `http://localhost:8777`, a read-only viewer that polls the ticket files
and auto-refreshes. The server is a standalone, zero-dependency Node process;
kill it by killing the port.

## Data & reset

Everything lives in `.pi/workboard/`. To reset, delete that folder.
No network calls, no accounts, no secrets.
