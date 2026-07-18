---
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
title: Parallel workboard_create ID Safety - Plan
created: 2026-07-16
---

# Parallel workboard_create ID Safety - Plan

## Goal Capsule

**Objective.** Guarantee that concurrent `workboard_create` calls (and any
parallel agents the stage router spawns) never produce duplicate or colliding
ticket IDs, and never silently overwrite an existing ticket file.

**Product authority.** Single feature owner (this repo). Scope is pi-workboard
ID generation and ticket persistence only.

**Open blockers.** None. This is an independent correctness fix; it is a
prerequisite for, but not blocked by, the stage-routing feature.

## Context (verified against the codebase)

- `storage/id-generator.ts` (`SequentialIdGenerator.nextId()`) does a
  **non-atomic read-modify-write** on `board.json`: it reads `nextTicketNumber`,
  formats `WB-####`, then writes `nextTicketNumber + 1`. The file comment admits
  concurrent generation is "not expected" and a lock "can be added later."
- `storage/board-repository.ts` (`FileBoardRepository`) exposes only `get()` and
  `update()`; `update()` is a plain `JsonFileStore.writeJson` with no compare or
  guard.
- `storage/json-file-store.ts` writes are atomic per-file (temp + `rename`), but
  that only protects each individual write — it does nothing for the counter race.
- `storage/ticket-repository.ts` `create()` has **no duplicate-ID guard**:
  `await this.store.writeJson(this.fileFor(ticket.id), ticket)`. A second ticket
  with the same ID silently overwrites the first → data loss, no error.
- `domain/validation.ts` enforces ticket IDs match `^WB-\d{4}$`; code relies on
  sequential, sortable IDs (`ticket-repository.ts` sorts by `id`).
- `services/workboard.ts:41` constructs **one shared** `SequentialIdGenerator`
  instance per workboard directory. This is the single chokepoint for all ID
  generation, so serializing `nextId()` there closes the race process-wide.
- `services/ticket-service.ts:83` is the sole caller of `nextId()`.

**Conclusion.** The bug is a read-modify-write race on the counter, compounded by
a missing overwrite guard in `create()`. The fix is (1) serialize `nextId()` with
an in-instance promise-chain mutex, and (2) refuse to overwrite an existing
ticket file. Sequential `WB-####` IDs are preserved.

## Product Contract

### What we are building

1. **In-generator mutex (L1).** `SequentialIdGenerator` serializes `nextId()` via
   a promise-chain lock (single in-flight `nextId()` at a time). All callers — the
   create tool, commands, and future stage-router-spawned agents — share the one
   instance, so the mutex makes ID allocation process-wide exclusive. No new
   dependency; no change to the `WB-####` format.
2. **Duplicate-ID guard in `FileTicketRepository.create()`.** If
   `fileFor(ticket.id)` already exists, throw a new `DuplicateTicketIdError`
   instead of overwriting. Defense-in-depth: even if the lock is bypassed, a
   residual collision fails loud rather than losing data.
3. **New `DuplicateTicketIdError`** in `domain/errors.ts`, following the existing
   error style.

### User-facing behavior

- Two or more `workboard_create` calls issued in parallel each receive a unique
  `WB-####` ID; none overwrite another.
- If a ticket file for an ID already exists, `create` throws a clear
  duplicate-ID error instead of silently replacing the ticket.
- IDs remain sequential, readable, and sortable (`WB-0007`, `WB-0008`, …).

### In scope

- Mutex/serialization inside `SequentialIdGenerator.nextId()`.
- `DuplicateTicketIdError` + guard in `FileTicketRepository.create()`.
- Preserving the `WB-\d{4}` format and deterministic sort order.

### Out of scope (v1)

- Multi-process / multi-host ID safety (a future atomic-CAS on `board.update`
  would cover that; not needed while one generator instance serves the board).
- Changing the ID scheme to timestamp/random (would break validation regex and
  sort order).
- Retry-on-collision logic (unnecessary once generation is serialized).

### Success criteria / acceptance signals

- A test that fires N concurrent `ticketService.create()` calls yields N distinct
  IDs with no duplicates and no overwrites (use an in-memory or temp board).
- A test that calls `create()` twice with the same ID throws
  `DuplicateTicketIdError` and leaves the first ticket intact.
- Existing sequential formatting and `^WB-\d{4}$` validation remain unchanged.
- No new runtime dependency introduced for the mutex.

### Key Decisions (session-settled)

- `session-settled:` **Standalone plan (A)** — captured independently of the
  stage-routing feature, because parallel creates can collide today.
- `session-settled:` **In-generator promise-chain mutex (L1)** — no new
  dependency; leverages the single shared generator instance to serialize
  `nextId()` across all in-process callers.
- `session-settled:` Preserve sequential `WB-####` IDs; do not switch to
  timestamp/random schemes.

## Outstanding Questions (resolve in /ce-plan)

- Exact mutex mechanism: a tiny promise-chain lock vs. importing `async-mutex`
  (recommend the former — zero-dependency, ~6 lines).
- Whether `board.update` should also gain an optional compare-and-swap for future
  multi-process safety, or stay simple for v1.
- Whether `DuplicateTicketIdError` should be retried upstream or surfaced to the
  caller as a hard failure (recommend hard failure; collisions should not occur
  once serialized).
- Test concurrency approach: how many concurrent creates, and whether to assert
  ordering or only uniqueness.
