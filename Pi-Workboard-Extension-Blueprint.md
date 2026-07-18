# Pi Workboard Extension

## Implementation Blueprint

### Purpose

Build a lightweight Pi extension that provides Jira-style work tracking for coding-agent sessions. Its primary purpose is to preserve finalized requirements, decisions, scope, dependencies, acceptance criteria, and implementation progress outside the conversation history so they survive compaction and session replacement.

> Conversation is temporary context. Work tickets are durable project state.

This is a local developer tool—not a Jira replacement, project-management platform, or multi-user system.

---

## 1. Required outcomes

The extension must allow Pi to:

1. Capture agreed work as structured tickets.
2. Preserve relevant context and decisions outside session history.
3. Select the next actionable ticket.
4. Work on only one ticket at a time.
5. Record material progress and implementation evidence.
6. Block tickets on unresolved dependencies.
7. Resume an active ticket after compaction or session restart.
8. Close tickets only after their acceptance criteria are verified.

Important information that must be preserved includes:

- Why the work is needed
- Decisions already made
- Rejected or prohibited approaches
- Exact scope and explicit exclusions
- Acceptance criteria
- Dependencies and blockers
- Constraints and affected components
- Testing expectations
- Material work completed before compaction

---

## 2. Strict MVP scope

Build only:

- Local file-based ticket storage
- Structured work tickets
- Ticket lifecycle management
- Dependencies and blocking
- Exactly one active ticket at a time
- Progress and decision notes
- Acceptance-criteria tracking
- Automatic active-ticket context restoration
- Pi tools for agent use
- Slash commands for human use
- A compact terminal board
- Unit and adapter-level tests

Do **not** build:

- Browser UI
- Server or REST API
- Authentication or multiple users
- Remote synchronization
- Jira, GitHub, or Linear integration
- Automatic branches or commits
- Time tracking, sprints, epics, or story points
- Notifications or analytics
- Embeddings or vector search
- Background agents or message brokers
- General-purpose workflow engine
- Database
- Persisted autopilot mode

If something is not explicitly included here, do not add it without asking.

---

## 3. Ticket domain model

```ts
type TicketStatus =
  | "backlog"
  | "ready"
  | "in_progress"
  | "blocked"
  | "done"
  | "cancelled";

type Priority = "low" | "medium" | "high" | "critical";

interface AcceptanceCriterion {
  id: string;
  description: string;
  completed: boolean;
  evidence?: string;
}

interface TicketDependency {
  ticketId: string;
  type: "blocked_by" | "related_to";
}

interface ProgressEntry {
  id: string;
  timestamp: string;
  type:
    | "note"
    | "decision"
    | "implementation"
    | "verification"
    | "blocker"
    | "status_change";
  content: string;
}

interface WorkTicket {
  schemaVersion: 1;
  id: string;
  title: string;
  status: TicketStatus;
  priority: Priority;

  objective: string;
  background: string;
  scope: string[];
  outOfScope: string[];
  acceptanceCriteria: AcceptanceCriterion[];

  constraints: string[];
  decisions: string[];
  references: string[];
  affectedAreas: string[];

  dependencies: TicketDependency[];
  blockedReason?: string;

  implementationNotes: string[];
  verificationSummary?: string;
  progress: ProgressEntry[];

  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}
```

### Required refinement fields

A ticket cannot become `ready` unless it has:

- Title
- Objective
- Background/context
- At least one scope item
- At least one acceptance criterion

An incomplete ticket may be stored as `backlog`.

### Content rules

The ticket is a compact implementation contract.

- **Objective:** Describe the outcome, not the implementation.
- **Background:** Summarize only the reasoning needed to implement correctly. Do not copy the entire conversation.
- **Scope:** State exactly what must be built. Each item should be independently verifiable.
- **Out of scope:** Record tempting adjacent work that must not be added. This field is mandatory.
- **Acceptance criteria:** Make every criterion observable and testable.
- **Decisions:** Preserve decisions that should not be reopened without new evidence.
- **Implementation notes:** Record discoveries made during implementation without silently expanding scope.

---

## 4. Storage design

Store project-local workboard data here:

```text
.pi/
└── workboard/
    ├── board.json
    └── tickets/
        ├── WB-0001.json
        ├── WB-0002.json
        └── WB-0003.json
```

```ts
interface BoardMetadata {
  schemaVersion: 1;
  nextTicketNumber: number;
  activeTicketId?: string;
}
```

Storage rules:

- One JSON file per ticket.
- JSON is the only source of truth; do not maintain duplicate Markdown tickets.
- Use UTF-8 and two-space indentation.
- Make writes atomic by writing a temporary file in the same directory and renaming it over the destination.
- Validate every ticket after reading it.
- Never silently discard or repair malformed data.
- Preserve unknown future fields where practical.
- Use ISO 8601 UTC timestamps.
- Generate sequential IDs: `WB-0001`, `WB-0002`, and so on.
- Tickets must live outside Pi session persistence so they survive compaction, branching, and session replacement.

---

## 5. Lifecycle and invariants

Allowed transitions:

```text
backlog -> ready -> in_progress -> done
                       |
                       v
                    blocked -> ready

backlog | ready | blocked -> cancelled
```

### `backlog -> ready`

Allow only when every required refinement field is present.

### `ready -> in_progress`

Allow only when:

- No unresolved `blocked_by` dependency exists.
- No other ticket is currently `in_progress`.

Starting a ticket sets `board.activeTicketId`.

### `in_progress -> blocked`

Require a blocked reason and preferably a `blocked_by` dependency when another ticket is responsible. Clear `board.activeTicketId`.

### `blocked -> ready`

Allow only when the blocked reason has been cleared and every `blocked_by` ticket is done or the dependency was explicitly removed. Do not automatically start it.

### `in_progress -> done`

Allow only when every acceptance criterion is completed, every criterion contains verification evidence, and a verification summary is supplied. Clear `board.activeTicketId`.

### `cancelled`

Cancelled tickets are terminal in the MVP. Do not implement reopening.

Additional invariants:

- Reject self-dependencies.
- Reject direct and transitive dependency cycles.
- Never permit more than one active ticket.
- Status changes must use lifecycle operations, not generic field updates.

---

## 6. Pi tools

Use several small, purpose-specific tools instead of one oversized action tool.

### `workboard_create`

Create a backlog or ready ticket. Accept all ticket-refinement fields and return its ID, status, and missing fields if incomplete.

### `workboard_get`

Return the complete specified ticket.

### `workboard_list`

Support optional filters for status, priority, dependency, and text. Return compact summaries rather than full bodies.

### `workboard_next`

Return the best actionable ticket without starting it:

1. Return the active ticket if one exists.
2. Otherwise consider only `ready` tickets.
3. Exclude unresolved blockers.
4. Sort by priority.
5. For equal priority, select the oldest ticket.

### `workboard_start`

Validate and start a ready ticket, making it the sole active ticket.

### `workboard_update`

Update only explicitly supplied fields. It must not replace unspecified fields, change status, alter acceptance completion, or delete progress history.

### `workboard_progress`

Append a timestamped progress entry for a note, decision, implementation, verification, blocker, or status change. Record only material information.

### `workboard_acceptance`

Mark one criterion complete or incomplete. Completing it requires evidence.

### `workboard_block`

Block a ticket with a required reason and optional blocking ticket ID.

### `workboard_unblock`

Return a blocked ticket to `ready` after validating dependencies.

### `workboard_complete`

Complete a ticket after validating all acceptance criteria and requiring a verification summary.

Do not add a ticket-deletion tool in the MVP.

---

## 7. Human-facing commands

Implement:

```text
/board
/ticket WB-0001
/ticket-new
/ticket-next
/ticket-start WB-0001
/ticket-block WB-0001
```

`/board` should render a compact Jira-style board grouped into Ready, In Progress, Blocked, and Done. Show ID, priority, title, and dependency indicator. Limit Done to the five most recent tickets.

`/ticket` should render the complete ticket readably.

`/ticket-new` should use Pi's interactive UI to collect only minimum required information. Do not build a complex full-screen TUI.

---

## 8. Durable context restoration

This is the most important feature.

Before the agent begins work on a user turn, inject a concise active-ticket context:

```text
ACTIVE WORK TICKET: WB-0007

Title:
Objective:
Background:
Scope:
Out of scope:
Constraints:
Decisions already made:
Incomplete acceptance criteria:
Dependencies:
Recent progress:
```

Include:

- Complete objective
- Relevant background
- Complete scope and out-of-scope lists
- Constraints
- Decisions
- Incomplete acceptance criteria
- Dependencies
- Latest 10 progress entries

Do not inject completed tickets, the full board, full historical progress, or unrelated backlog tickets.

The injected instruction must state:

1. The ticket is the durable source of truth.
2. Do not expand its scope.
3. Record material discoveries and decisions.
4. Verify acceptance criteria before completion.
5. If the request conflicts with the ticket, ask whether the ticket should be updated.

Use the lifecycle hook supported by the locally installed Pi version that runs before agent execution or allows system-context augmentation. Inspect the installed Pi types and official examples before coding; do not guess the event name or return shape.

### Session startup

On `session_start`:

- Load and validate board metadata.
- Verify that `activeTicketId` references an existing `in_progress` ticket.
- Report inconsistencies without silently changing files.
- Display the active ticket in a small status indicator or widget.
- If none is active, display ready and blocked counts.

Do not depend on intercepting or modifying Pi's compaction summary. Recovery works by reloading durable ticket context from disk on subsequent turns.

---

## 9. Agent operating rules

Inject these rules when relevant:

> When substantial work is requested, first check the workboard. If an active ticket exists, continue it unless the user explicitly changes direction. Do not start another ticket while one is in progress. Before implementation, read the complete active ticket. During implementation, record only material progress. If blocked, stop, record the blocker, and mark the ticket blocked. Do not mark a ticket done until every acceptance criterion has evidence.

Also enforce:

- Never invent verification evidence.
- Do not mark criteria complete merely because code was written.
- Never update scope implicitly.
- Create a separate backlog ticket for discovered work not required by current acceptance criteria.
- Small incidental work required by the active ticket may be captured in implementation notes.
- Do not automatically work through the entire backlog.
- After completion, report the result and identify the next ticket.
- Start the next ticket only when the user explicitly directs continuous execution for that run.

---

## 10. Code organization

```text
.pi/extensions/workboard/
├── index.ts
├── domain/
│   ├── ticket.ts
│   ├── board.ts
│   ├── status.ts
│   └── errors.ts
├── storage/
│   ├── ticket-repository.ts
│   ├── board-repository.ts
│   ├── json-file-store.ts
│   └── validation.ts
├── services/
│   ├── ticket-service.ts
│   ├── lifecycle-service.ts
│   ├── dependency-service.ts
│   ├── selection-service.ts
│   └── context-service.ts
├── pi/
│   ├── register-tools.ts
│   ├── register-commands.ts
│   ├── register-lifecycle.ts
│   ├── render-board.ts
│   └── render-ticket.ts
└── tests/
    ├── ticket-service.test.ts
    ├── lifecycle-service.test.ts
    ├── dependency-service.test.ts
    ├── selection-service.test.ts
    ├── context-service.test.ts
    ├── storage.test.ts
    └── extension.test.ts
```

Boundaries:

- `domain`: types and pure domain rules
- `storage`: filesystem access only
- `services`: use cases and lifecycle decisions
- `pi`: adapters between Pi APIs and services
- `index.ts`: composition and registration only—no business logic

If a production file approaches 250–300 lines, reassess its responsibilities. Do not split files arbitrarily or build generic abstraction layers.

Define interfaces before implementations:

```ts
interface TicketRepository {
  create(ticket: WorkTicket): Promise<void>;
  get(id: string): Promise<WorkTicket | null>;
  update(ticket: WorkTicket): Promise<void>;
  list(): Promise<WorkTicket[]>;
}

interface BoardRepository {
  get(): Promise<BoardMetadata>;
  update(board: BoardMetadata): Promise<void>;
}

interface Clock {
  now(): string;
}

interface IdGenerator {
  nextId(): Promise<string>;
}
```

Use an injected clock and temporary test directories for deterministic tests. Avoid abstractions beyond repositories, clock, ID generation, and focused services unless a concrete need appears.

---

## 11. Errors and validation

Use typed domain errors such as:

- `TicketNotFoundError`
- `InvalidTransitionError`
- `IncompleteTicketError`
- `UnresolvedDependencyError`
- `ActiveTicketExistsError`
- `AcceptanceCriteriaIncompleteError`
- `CorruptWorkboardError`

Tool errors must explain what failed, why, and how to resolve it. Do not expose raw stack traces in normal Pi UI output.

Example:

> Cannot start WB-0012 because WB-0009 is still blocking it. Complete WB-0009 or explicitly remove the dependency.

---

## 12. Testing requirements

Use the repository's test framework; use Vitest only if none exists.

Required tests:

- Sequential ticket IDs
- Refusal to make incomplete tickets ready
- Valid and invalid lifecycle transitions
- Prevention of two active tickets
- Prevention of starting blocked tickets
- Direct and transitive unresolved dependencies
- Self-dependency rejection
- Dependency-cycle rejection
- Correct next-ticket selection
- Evidence required for completed criteria
- Completion rejected with incomplete criteria
- Active ticket cleared after blocking
- Active ticket cleared after completion
- Active-ticket context restoration
- Injected progress limited to latest 10 entries
- Atomic file writes
- Malformed ticket reporting
- Partial updates do not overwrite unspecified fields
- Expected Pi tools and commands are registered

Do not use snapshot tests for core lifecycle behaviour. Assert exact domain results.

---

## 13. Milestones and mandatory pauses

The implementation agent must stop after every milestone and wait for approval.

### Milestone 1: Domain and storage

Build domain types, validation, repositories, atomic JSON storage, ID generation, and tests. No Pi integration.

### Milestone 2: Lifecycle services

Build creation/refinement, transitions, dependencies, blocking, acceptance handling, selection, and tests. No UI polishing.

### Milestone 3: Pi tools

Register all agent-callable tools and verify them with mocked Pi integration tests.

### Milestone 4: Commands and rendering

Build commands, compact board/ticket rendering, and the small widget/status display.

### Milestone 5: Durable context restoration

Build startup restoration, context generation, pre-agent injection, and recovery tests. Demonstrate recovery in a fresh Pi session with an existing active ticket.

### Milestone 6: Documentation and final verification

Provide installation instructions, command and tool references, example workflow, test results, and known MVP limitations. Add no new features.

At the end of every milestone report:

- Files created or changed
- Functionality completed
- Tests added and results
- Decisions made
- Deviations from this blueprint
- Risks or unresolved questions
- Recommended next milestone

---

## 14. Definition of done

The extension is complete only when this scenario works:

1. User and agent discuss a feature.
2. Agent creates a detailed ticket containing the finalized context.
3. Ticket becomes ready and is started.
4. Agent records material implementation progress.
5. Session is compacted or replaced.
6. A new session automatically recovers the active ticket's critical context.
7. Agent continues without the original conversation.
8. A dependency can block the ticket.
9. The ticket cannot resume until that dependency is resolved.
10. Every acceptance criterion receives verification evidence.
11. Ticket is completed.
12. The next actionable ticket can be identified.

---

## 15. Initial instruction for the development agent

Copy the following as the instruction accompanying this blueprint:

```text
Build the Pi Workboard extension exactly as described in the linked blueprint.

Treat the blueprint as the complete product scope. Do not introduce features, architectural layers, integrations, or infrastructure not explicitly requested.

Working rules:

1. Inspect the locally installed Pi extension types and official examples first. Confirm the exact APIs for tool registration, commands, session startup, UI rendering, and pre-agent/system-context injection. Do not guess signatures.

2. Before writing code, present:
   - Your understanding of the MVP
   - Proposed file structure
   - Conflicts between the blueprint and installed Pi version
   - Exact scope of Milestone 1

3. Implement only Milestone 1 initially.

4. Keep domain, storage, services, and Pi adapters separate. index.ts is only the composition root. Do not build the extension in one large file.

5. Use explicit TypeScript interfaces and small, readable modules. Avoid speculative abstractions and generic frameworks.

6. Write tests alongside each component. A milestone is incomplete until its relevant tests pass.

7. Do not change scope silently. If a discovery requires a meaningful design or scope change, stop and ask.

8. Do not proceed to another milestone automatically. Provide the required milestone report and wait for approval.

The primary goal is durable task context across Pi compaction and session replacement. It is not a complete Jira clone.
```
