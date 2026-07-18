/**
 * Pi tool registration (Milestone 3).
 *
 * Each `workboard_*` tool is a thin adapter: it validates/normalizes arguments
 * with a TypeBox schema, calls the appropriate service, and returns a friendly
 * text result. Domain errors are caught and rendered as actionable messages
 * (no raw stack traces). The agent never mutates tickets by generic field
 * writes — every state change goes through the lifecycle service.
 */

import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { WorkboardError } from "../domain/errors.js";
import type {
  AcceptanceCriterion,
  Priority,
  ProgressType,
  TicketDependency,
} from "../domain/ticket.js";
import { renderTicket, ticketSummary } from "./render-ticket.js";
import type { TicketService } from "../services/ticket-service.js";
import type { LifecycleService } from "../services/lifecycle-service.js";
import type { SelectionService } from "../services/selection-service.js";
import type { SessionActiveService } from "../services/session-active.js";

export interface WorkboardContext {
  ticketService: TicketService;
  lifecycle: LifecycleService;
  selection: SelectionService;
  sessionActive: SessionActiveService;
  boardRepo?: import("../storage/board-repository.js").FileBoardRepository;
}

const DEP_TYPES = Type.Union([
  Type.Literal("blocked_by"),
  Type.Literal("related_to"),
]);

const PRIORITIES = Type.Union([
  Type.Literal("low"),
  Type.Literal("medium"),
  Type.Literal("high"),
  Type.Literal("critical"),
]);

const PROGRESS_TYPES = Type.Union([
  Type.Literal("note"),
  Type.Literal("decision"),
  Type.Literal("implementation"),
  Type.Literal("verification"),
  Type.Literal("blocker"),
  Type.Literal("status_change"),
]);

const dependencySchema = Type.Object({
  ticketId: Type.String({ description: "Ticket id this depends on, e.g. WB-0003" }),
  type: DEP_TYPES,
});

const acceptanceSchema = Type.Object({
  id: Type.String({ description: "Stable criterion id, e.g. AC-1" }),
  description: Type.String(),
  completed: Type.Optional(Type.Boolean()),
});

function ok(text: string, details: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: details ?? {} };
}

function fail(err: unknown): AgentToolResult<unknown> {
  const message =
    err instanceof WorkboardError
      ? err.message
      : `Unexpected error: ${err instanceof Error ? err.message : String(err)}`;
  return {
    content: [{ type: "text", text: `Workboard error: ${message}` }],
    details: { error: message },
  };
}

// Ticket/board rendering lives in pi/render-ticket.ts and pi/render-board.ts
// so the tools and commands share one readable formatter.

const READY_RULES = [
  "The active ticket is the durable source of truth; do not expand its scope.",
  "Record only material progress and decisions on the ticket.",
  "Verify every acceptance criterion (with evidence) before completing.",
];

export function buildAllTools(ctx: WorkboardContext): ToolDefinition[] {
  return [
    // workboard_create -------------------------------------------------------
    defineTool({
      name: "workboard_create",
      label: "Create ticket",
      description:
        "Create a work ticket (backlog or ready). Capture finalized requirements, scope, and acceptance criteria.",
      promptSnippet: "workboard_create: create work tickets",
      promptGuidelines: [
        "Create a ticket to preserve agreed context outside the conversation history.",
      ],
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union([Type.Literal("backlog"), Type.Literal("ready")]),
        ),
        title: Type.Optional(Type.String()),
        objective: Type.Optional(Type.String()),
        background: Type.Optional(Type.String()),
        scope: Type.Optional(Type.Array(Type.String())),
        outOfScope: Type.Optional(Type.Array(Type.String())),
        acceptanceCriteria: Type.Optional(Type.Array(acceptanceSchema)),
        priority: Type.Optional(PRIORITIES),
        constraints: Type.Optional(Type.Array(Type.String())),
        decisions: Type.Optional(Type.Array(Type.String())),
        references: Type.Optional(Type.Array(Type.String())),
        affectedAreas: Type.Optional(Type.Array(Type.String())),
        dependencies: Type.Optional(Type.Array(dependencySchema)),
        prerequisites: Type.Optional(Type.Array(Type.String())),
      }),
      async execute(_id, p) {
        try {
          const result = await ctx.ticketService.create({
            status: p.status,
            title: p.title,
            objective: p.objective,
            background: p.background,
            scope: p.scope,
            outOfScope: p.outOfScope,
            acceptanceCriteria: p.acceptanceCriteria?.map(
              (c): AcceptanceCriterion => ({
                id: c.id,
                description: c.description,
                completed: c.completed ?? false,
              }),
            ),
            priority: p.priority as Priority | undefined,
            constraints: p.constraints,
            decisions: p.decisions,
            references: p.references,
            affectedAreas: p.affectedAreas,
            dependencies: p.dependencies as TicketDependency[] | undefined,
            prerequisites: p.prerequisites,
          });
          const note = result.missing.length
            ? ` Missing refinement fields: ${result.missing.join(", ")}.`
            : "";
          return ok(`Created ${result.id} (status: ${result.status}).${note}`, result);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_get ----------------------------------------------------------
    defineTool({
      name: "workboard_get",
      label: "Get ticket",
      description: "Return the complete specified ticket.",
      promptSnippet: "workboard_get: read a ticket",
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id, p) {
        try {
          const t = await ctx.ticketService.get(p.id);
          return ok(renderTicket(t).join("\n"), t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_list ---------------------------------------------------------
    defineTool({
      name: "workboard_list",
      label: "List tickets",
      description:
        "List tickets with optional filters. Returns compact summaries, not full bodies.",
      promptSnippet: "workboard_list: list/filter tickets",
      parameters: Type.Object({
        status: Type.Optional(
          Type.Union([
            Type.Literal("backlog"),
            Type.Literal("ready"),
            Type.Literal("in_progress"),
            Type.Literal("in_review"),
            Type.Literal("blocked"),
            Type.Literal("done"),
            Type.Literal("cancelled"),
          ]),
        ),
        priority: Type.Optional(PRIORITIES),
        dependency: Type.Optional(Type.String()),
        text: Type.Optional(Type.String()),
      }),
      async execute(_id, p) {
        try {
          const list = await ctx.ticketService.list({
            status: p.status,
            priority: p.priority as Priority | undefined,
            dependency: p.dependency,
            text: p.text,
          });
          const text = list.length
            ? list.map(ticketSummary).join("\n")
            : "No tickets match.";
          return ok(text, list);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_next ---------------------------------------------------------
    defineTool({
      name: "workboard_next",
      label: "Next ticket",
      description:
        "Return the best actionable ticket without starting it. Prefers the active ticket, then the highest-priority ready ticket with no unresolved blockers.",
      promptSnippet: "workboard_next: pick the next ticket",
      parameters: Type.Object({}),
      async execute() {
        try {
          const next = await ctx.selection.next();
          if (!next) {
            return ok(
              "No actionable ticket: no active ticket and no ready ticket without unresolved blockers.",
              null,
            );
          }
          return ok(
            `Next actionable ticket:\n${renderTicket(next).join("\n")}\n\nNot started. Use workboard_start to begin it.`,
            next,
          );
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_start --------------------------------------------------------
    defineTool({
      name: "workboard_start",
      label: "Start ticket",
      description:
        "Validate and start a ready ticket, making it the sole active ticket.",
      promptSnippet: "workboard_start: begin the active ticket",
      promptGuidelines: READY_RULES,
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id, p, _signal, _onUpdate, extCtx) {
        try {
          const t = await ctx.lifecycle.start(p.id);
          const sessionId = extCtx.sessionManager.getSessionId();
          await ctx.sessionActive.set(sessionId, p.id);
          return ok(`${t.id} is now in progress and is this session's active ticket.`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_set_worktree ------------------------------------------------
    defineTool({
      name: "workboard_set_worktree",
      label: "Record worktree path",
      description:
        "Record the path to the git worktree the agent created for this ticket's work, so it shows in the dashboard and footer.",
      promptSnippet: "workboard_set_worktree: record the worktree path you created",
      parameters: Type.Object({
        id: Type.String(),
        path: Type.String({ description: "Absolute path to the git worktree you created" }),
      }),
      async execute(_id, p, _signal, _onUpdate, extCtx) {
        try {
          const t = await ctx.ticketService.update(p.id, { worktree: p.path });
          await ctx.ticketService.recordProgress(
            p.id,
            "status_change",
            `Worktree at ${p.path}`,
            "system",
          );
          const sessionId = extCtx.sessionManager.getSessionId();
          await ctx.sessionActive.set(sessionId, p.id);
          return ok(`Recorded worktree at ${p.path} for ${t.id}.`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_update -------------------------------------------------------
    defineTool({
      name: "workboard_update",
      label: "Update ticket",
      description:
        "Update only explicitly supplied fields. Never changes status, alters acceptance completion, or deletes progress history.",
      promptSnippet: "workboard_update: edit ticket fields",
      parameters: Type.Object({
        id: Type.String(),
        title: Type.Optional(Type.String()),
        objective: Type.Optional(Type.String()),
        background: Type.Optional(Type.String()),
        scope: Type.Optional(Type.Array(Type.String())),
        outOfScope: Type.Optional(Type.Array(Type.String())),
        constraints: Type.Optional(Type.Array(Type.String())),
        decisions: Type.Optional(Type.Array(Type.String())),
        references: Type.Optional(Type.Array(Type.String())),
        affectedAreas: Type.Optional(Type.Array(Type.String())),
        dependencies: Type.Optional(Type.Array(dependencySchema)),
        prerequisites: Type.Optional(Type.Array(Type.String())),
      }),
      async execute(_id, p) {
        try {
          const t = await ctx.ticketService.update(p.id, {
            title: p.title,
            objective: p.objective,
            background: p.background,
            scope: p.scope,
            outOfScope: p.outOfScope,
            constraints: p.constraints,
            decisions: p.decisions,
            references: p.references,
            affectedAreas: p.affectedAreas,
            dependencies: p.dependencies as TicketDependency[] | undefined,
            prerequisites: p.prerequisites,
          });
          return ok(`Updated ${t.id}. Unspecified fields were left unchanged.`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_progress -----------------------------------------------------
    defineTool({
      name: "workboard_progress",
      label: "Record progress",
      description:
        "Append a timestamped progress entry: note, decision, implementation, verification, blocker, or status_change.",
      promptSnippet: "workboard_progress: log material progress",
      parameters: Type.Object({
        id: Type.String(),
        type: PROGRESS_TYPES,
        content: Type.String(),
        author: Type.Optional(
          Type.String({ description: "Who is logging this (defaults to the current model)." }),
        ),
      }),
      promptGuidelines: [
        "Notes are attributed to author (auto-set to the current model); pass author only to override.",
      ],
      async execute(_id, p, _signal, _onUpdate, extCtx) {
        try {
          const before = await ctx.ticketService.get(p.id);
          const author =
            p.author ?? (extCtx.model as { id?: string } | undefined)?.id ?? "agent";
          const t = await ctx.ticketService.recordProgress(
            p.id,
            p.type as ProgressType,
            p.content,
            author,
          );
          const reminder =
            before.status !== "in_progress"
              ? ` Reminder: ${t.id} is "${before.status}", not in_progress — start it with /ticket-start (or workboard_start) before logging work.`
              : "";
          return ok(`Recorded ${p.type} on ${t.id} (by ${author}).${reminder}`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_acceptance ---------------------------------------------------
    defineTool({
      name: "workboard_acceptance",
      label: "Mark acceptance",
      description:
        "Mark one acceptance criterion complete or incomplete. Completing requires evidence.",
      promptSnippet: "workboard_acceptance: verify a criterion",
      parameters: Type.Object({
        id: Type.String(),
        criterionId: Type.String(),
        completed: Type.Boolean(),
        evidence: Type.Optional(Type.String()),
      }),
      async execute(_id, p) {
        try {
          const t = await ctx.ticketService.setAcceptance(
            p.id,
            p.criterionId,
            p.completed,
            p.evidence,
          );
          return ok(
            `Criterion ${p.criterionId} on ${t.id} marked ${p.completed ? "complete" : "incomplete"}.`,
            t,
          );
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_block --------------------------------------------------------
    defineTool({
      name: "workboard_block",
      label: "Block ticket",
      description:
        "Block the active ticket with a required reason and optional blocking ticket id.",
      promptSnippet: "workboard_block: record a blocker",
      promptGuidelines: [
        "If blocked, stop, record the blocker, and mark the ticket blocked.",
      ],
      parameters: Type.Object({
        id: Type.String(),
        reason: Type.String(),
        blockedBy: Type.Optional(Type.String()),
      }),
      async execute(_id, p) {
        try {
          const t = await ctx.lifecycle.block(p.id, p.reason, p.blockedBy);
          return ok(`${t.id} blocked: ${t.blockedReason}`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_unblock ------------------------------------------------------
    defineTool({
      name: "workboard_unblock",
      label: "Unblock ticket",
      description:
        "Return a blocked ticket to ready after validating its dependencies are resolved.",
      promptSnippet: "workboard_unblock: resume a blocked ticket",
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id, p) {
        try {
          const t = await ctx.lifecycle.unblock(p.id);
          return ok(`${t.id} unblocked; status is now "${t.status}".`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_complete -----------------------------------------------------
    defineTool({
      name: "workboard_complete",
      label: "Complete ticket",
      description:
        "Complete a ticket after validating all acceptance criteria and supplying a verification summary.",
      promptSnippet: "workboard_complete: finish the active ticket",
      promptGuidelines: READY_RULES,
      parameters: Type.Object({
        id: Type.String(),
        verificationSummary: Type.String(),
      }),
      async execute(_id, p) {
        try {
          const t = await ctx.lifecycle.complete(p.id, p.verificationSummary);
          return ok(`${t.id} completed.`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_review ------------------------------------------------------
    defineTool({
      name: "workboard_review",
      label: "Submit for review",
      description:
        "Move an in_progress ticket into in_review once implementation is done (all acceptance criteria marked complete).",
      promptSnippet: "workboard_review: submit the ticket for review",
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id, p) {
        try {
          const t = await ctx.lifecycle.submitForReview(p.id);
          return ok(`${t.id} submitted for review (status: in_review).`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_changes -----------------------------------------------------
    defineTool({
      name: "workboard_changes",
      label: "Request changes",
      description:
        "Return an in_review ticket to in_progress when review requests changes.",
      promptSnippet: "workboard_changes: send the ticket back to implementation",
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id, p) {
        try {
          const t = await ctx.lifecycle.requestChanges(p.id);
          return ok(`${t.id} back to in_progress; changes requested.`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_ready --------------------------------------------------------
    defineTool({
      name: "workboard_ready",
      label: "Mark ready",
      description:
        "Promote a backlog ticket to ready once its required refinement fields are complete.",
      promptSnippet: "workboard_ready: mark a ticket ready",
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id, p) {
        try {
          const t = await ctx.lifecycle.markReady(p.id);
          return ok(`${t.id} is now ready.`, t);
        } catch (err) {
          return fail(err);
        }
      },
    }),

    // workboard_set_prefix --------------------------------------------------
    defineTool({
      name: "workboard_set_prefix",
      label: "Set ticket id prefix",
      description:
        "Set the prefix used for new ticket ids (e.g. 'WB' -> 'WB-0001'). Defaults to 'WB' when unset. Changing it does not rename existing tickets.",
      promptSnippet: "workboard_set_prefix: change the ticket id prefix",
      parameters: Type.Object({
        prefix: Type.String({ description: "Prefix for new ticket ids, 1-4 letters/digits (e.g. WB, TSK, JIRA)." }),
      }),
      async execute(_id, p) {
        try {
          if (!ctx.boardRepo) {
            return fail(
              new WorkboardError(
                "INVALID_TRANSITION",
                "Board repository is not available in this context, so the prefix cannot be set.",
              ),
            );
          }
          if (!/^[A-Za-z0-9]{1,4}$/.test(p.prefix)) {
            return fail(
              new WorkboardError(
                "INVALID_TRANSITION",
                "Prefix must be 1-4 letters or digits (e.g. WB, TSK). Received: " +
                  JSON.stringify(p.prefix),
              ),
            );
          }
          const meta = await ctx.boardRepo.get();
          await ctx.boardRepo.update({ ...meta, idPrefix: p.prefix });
          return ok(
            `Ticket id prefix set to '${p.prefix}'. New tickets will be '${p.prefix}-####'. Existing tickets keep their original prefix.`,
            { idPrefix: p.prefix },
          );
        } catch (err) {
          return fail(err);
        }
      },
    }),
  ];
}

export function registerTools(pi: ExtensionAPI, ctx: WorkboardContext): void {
  for (const tool of buildAllTools(ctx)) {
    pi.registerTool(tool);
  }
}
