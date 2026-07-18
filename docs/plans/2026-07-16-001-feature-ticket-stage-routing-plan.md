---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
title: Ticket Stage Routing (worker → reviewer → merger) - Plan
created: 2026-07-16
---

# Ticket Stage Routing (worker → reviewer → merger) - Plan

## Goal Capsule

**Objective.** Add a per-ticket *stage machine* to pi-workboard so that, once a
ticket is started, it flows automatically between agent roles — worker implements,
reviewer approves or sends back, merger completes — with each handoff spawning the
correct agent. The dispatch brain (`SelectionService.next()`) and the ticket
lifecycle already exist; this feature adds the role layer and the router on top.

**Product authority.** Single feature owner (this repo). Scope is pi-workboard
only; multi-agent-v2 is explicitly out of scope as the execution backend for v1.

**Open blockers.** None blocking the requirements. Outstanding design details are
captured in Outstanding Questions and resolved during `/ce-plan`.

## Context (verified against the codebase)

- `domain/status.ts` defines the ticket lifecycle:
  `backlog → ready → in_progress → in_review → done`, plus `blocked`/`cancelled`.
  `in_review` today may only go to `in_progress` (changes), `done`, or `cancelled`.
- `services/lifecycle-service.ts` already implements: `start` (`ready→in_progress`),
  `submitForReview` (`in_progress→in_review`, requires all acceptance criteria
  complete), `requestChanges` (`in_review→in_progress`), `complete`
  (`in_review→done`, requires `in_review` + verified criteria + verification summary).
  There is **no `approve`** distinct from `complete`.
- `services/selection-service.ts` (`SelectionService.next()`) already returns the
  best `ready` ticket with no unresolved `blocked_by` dependencies, priority-sorted.
- Tools in `pi/register-tools.ts` expose all of the above as `workboard_*` tools,
  plus `block`/`unblock`/`update`/`progress`/`acceptance`.
- multi-agent-v2 (`/Users/tejasghutade/Projects/multi-agent-v2`) owns a *separate*
  runtime lifecycle (`TaskStatus`: created/queued/assigned/running/completing/
  completed) for spawning/leasing/releasing agents. It has zero ticket awareness and
  is Milestone 0 (in-memory shell). It is the future *execution backend*, not the
  policy owner.

**Conclusion.** The policy belongs in pi-workboard. The state machine and most verbs
already exist. The feature adds: (1) a distinct `approve`/merge stage, (2) a
`stage`/`currentRole`/`reviewRounds` model, and (3) a transition-driven stage router
that spawns the correct agent per stage via a swappable `RuntimeAdapter`.

## Product Contract

### What we are building

1. **A three-role ticket stage machine** layered on the existing status lifecycle:
   - `implement` (worker) — status `in_progress`
   - `review` (reviewer) — status `in_review`
   - `approved` (merger) — **new status**, reached via a new `approve` transition
   - `done` — reached via `complete`, now gated on `approved` (not `in_review`)
   - `changes` loop — `in_review → in_progress` (existing `requestChanges`),
     returning to the worker with reviewer notes.
2. **A new `approve` transition and tool** (`workboard_approve`): `in_review → approved`.
   It records the reviewer's approval and clears the review gate. `complete` is
   repointed to require `approved` instead of `in_review` (review becomes a required
   pre-gate to merge, matching today's intent that review precedes completion).
3. **A `StageRouter`** (extends the dispatch concept) that watches ticket stage
   transitions and, on each transition, spawns the next role's agent through the
   `RuntimeAdapter`. It is transition-driven, not just "next ready ticket."
4. **A `RuntimeAdapter` interface** with a v1 backend that spawns a **real Pi
   agent/subagent** to perform the role. multi-agent-v2 is a future alternative
   backend behind the same interface; no coupling to it in v1.
5. **Stage ownership fields on the ticket:** `currentRole` (which role owns it now),
   `stage` (denormalized current stage for dashboard/routing), and `reviewRounds`
   (count of change-request cycles).
6. **Rework guard:** when `requestChanges` pushes `reviewRounds` past a configured
   maximum, the ticket is `blocked` (or flagged for human) instead of looping
   forever.
7. **Dependency cascade reuse:** on `done`, existing `blocked_by` resolution makes
   newly-unblocked dependent tickets appear in the next `selection.next()` — no new
   work needed there.

### User-facing behavior

- Starting a ready ticket (deps clear) spawns a **worker** agent automatically.
- When the worker finishes and submits for review, a **reviewer** agent is spawned.
- The reviewer either requests changes (ticket returns to the worker, `reviewRounds++`)
  or approves (ticket moves to `approved`, a **merger** agent is spawned).
- The merger completes the ticket (`done`); dependents unblock automatically.
- The dashboard/footer shows the current `stage` and `currentRole` for each ticket.

### In scope

- New `approved` status + `approve` transition/tool; repoint `complete` to `approved`.
- `StageRouter` transition-driven dispatch.
- `RuntimeAdapter` interface + Pi-subagent v1 backend.
- Ticket fields: `currentRole`, `stage`, `reviewRounds`.
- Rework guard (`reviewRounds` cap → block).
- Reuse of `SelectionService.next()`, existing lifecycle tools, dependency model.

### Out of scope (v1)

- Making multi-agent-v2 the execution backend (deferred; interface only).
- Parallel multi-ticket scheduling beyond what `selection.next()` already supports.
- Human-in-the-loop approval UI beyond the existing block/flag.
- Persistence/durability of the router itself (in-memory loop for v1).

### Success criteria / acceptance signals

- A ticket started from `ready` (deps clear) auto-spawns a worker; on submit-for-review
  a reviewer is auto-spawned; on approve a merger is auto-spawned; on complete the
  ticket is `done` and dependents unblock.
- `approve` is impossible from any status other than `in_review`; `complete` is
  impossible from any status other than `approved`.
- `requestChanges` increments `reviewRounds`; exceeding the cap blocks the ticket.
- Each stage transition is recorded in the ticket's progress history with the acting
  role.
- The router can be run against a fake `RuntimeAdapter` in tests (no real agent spawn).

### Key Decisions (session-settled)

- `session-settled:` **Policy lives in pi-workboard**, not multi-agent-v2. The
  workboard owns ticket assignment; multi-agent-v2 is the execution mechanism.
- `session-settled:` **Option A chosen for approval** — distinct `approve` gate →
  `approved` stage → `complete` (merger) → `done`. Three explicit routable stages;
  review and merge are separate gates.
- `session-settled:` **Option Y chosen for execution** — v1 spawns a real Pi
  agent/subagent behind a `RuntimeAdapter`; multi-agent-v2 is a future swappable
  backend.

## Outstanding Questions (resolve in /ce-plan)

- Exact max `reviewRounds` default and whether the cap blocks vs. flags for human.
- Whether `stage` is a separate enum or derived from `status` + `currentRole`.
- How the router is triggered (event hook on lifecycle vs. a polling tick).
- What context/artifact (ticket id, diff, reviewer notes) is passed to each role spawn.
- Whether `approved` needs its own tool surfaced in the dashboard or reuses `complete`.
- Naming: `StageRouter` vs `DispatchService` vs `TicketConductor`.
