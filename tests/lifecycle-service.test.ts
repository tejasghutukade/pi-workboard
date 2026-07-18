import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkTicket } from "../domain/ticket.js";
import {
  AcceptanceCriteriaIncompleteError,
  IncompleteTicketError,
  InvalidTransitionError,
  UnresolvedDependencyError,
} from "../domain/errors.js";
import { setup, type TestEnv } from "./helpers.js";

let env: TestEnv;

beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.cleanup();
});

async function readyTicket(deps?: WorkTicket["dependencies"]): Promise<string> {
  const result = await env.ticketService.create({
    status: "ready",
    title: "Ready",
    objective: "Do it",
    background: "Because",
    scope: ["Build it"],
    acceptanceCriteria: [{ id: "AC-1", description: "Works", completed: false }],
    dependencies: deps,
  });
  return result.id;
}

describe("refinement gate (backlog -> ready)", () => {
  it("refuses to mark an incomplete backlog ticket ready", async () => {
    const id = await env.ticketService.create({ title: "", objective: "", background: "" }).then((r) => r.id);
    await expect(env.lifecycle.markReady(id)).rejects.toBeInstanceOf(IncompleteTicketError);
  });

  it("marks a complete backlog ticket ready", async () => {
    const id = await env.ticketService
      .create({
        title: "Backlog",
        objective: "Do it",
        background: "Because",
        scope: ["Build it"],
        acceptanceCriteria: [{ id: "AC-1", description: "Works", completed: false }],
      })
      .then((r) => r.id);
    const ready = await env.lifecycle.markReady(id);
    expect(ready.status).toBe("ready");
  });

  it("create downgrades an incomplete ticket to backlog and reports missing", async () => {
    const result = await env.ticketService.create({
      status: "ready",
      title: "No scope",
      objective: "o",
      background: "b",
      scope: [],
      acceptanceCriteria: [],
    });
    expect(result.status).toBe("backlog");
    expect(result.missing).toContain("scope");
    expect(result.missing).toContain("acceptanceCriteria");
  });
});

describe("valid and invalid transitions", () => {
  it("ready -> in_progress -> in_review -> done is allowed", async () => {
    const id = await readyTicket();
    const started = await env.lifecycle.start(id);
    expect(started.status).toBe("in_progress");
    await env.ticketService.setAcceptance(id, "AC-1", true, "evidence");
    const reviewed = await env.lifecycle.submitForReview(id);
    expect(reviewed.status).toBe("in_review");
    const done = await env.lifecycle.complete(id, "Verified by test");
    expect(done.status).toBe("done");
  });

  it("rejects start from backlog", async () => {
    const id = await env.ticketService.create({ title: "t", objective: "o", background: "b" }).then((r) => r.id);
    await expect(env.lifecycle.start(id)).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("rejects block from a non-in_progress ticket", async () => {
    const id = await readyTicket();
    await expect(env.lifecycle.block(id, "reason")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("rejects complete from in_progress (must review first)", async () => {
    const id = await readyTicket();
    await env.lifecycle.start(id);
    await env.ticketService.setAcceptance(id, "AC-1", true, "evidence");
    await expect(env.lifecycle.complete(id, "summary")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("rejects complete with a missing verification summary", async () => {
    const id = await readyTicket();
    await env.lifecycle.start(id);
    await env.ticketService.setAcceptance(id, "AC-1", true, "evidence");
    await env.lifecycle.submitForReview(id);
    await expect(env.lifecycle.complete(id, "")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("rejects cancel from a terminal status", async () => {
    const id = await readyTicket();
    await env.lifecycle.start(id);
    await env.ticketService.setAcceptance(id, "AC-1", true, "evidence");
    await env.lifecycle.submitForReview(id);
    await env.lifecycle.complete(id, "done");
    await expect(env.lifecycle.cancel(id)).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe("parallel active tickets", () => {
  it("allows starting a second ticket while another is in progress", async () => {
    const a = await readyTicket();
    const b = await readyTicket();
    await env.lifecycle.start(a);
    const started = await env.lifecycle.start(b);
    expect(started.status).toBe("in_progress");
    const active = await env.lifecycle.getActive();
    expect(active.map((t) => t.id).sort()).toEqual([a, b].sort());
  });

  it("still prevents starting a ticket with unresolved blockers", async () => {
    const blocker = await readyTicket();
    const id = await readyTicket([{ ticketId: blocker, type: "blocked_by" }]);
    await expect(env.lifecycle.start(id)).rejects.toBeInstanceOf(UnresolvedDependencyError);
  });
});

describe("blocking", () => {
  it("requires a reason to block", async () => {
    const id = await readyTicket();
    await env.lifecycle.start(id);
    await expect(env.lifecycle.block(id, "")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("records a blocked_by dependency", async () => {
    const blocker = await readyTicket();
    const id = await readyTicket();
    await env.lifecycle.start(id);
    const blocked = await env.lifecycle.block(id, "needs blocker", blocker);
    expect(blocked.status).toBe("blocked");
    expect(blocked.blockedReason).toBe("needs blocker");
    expect(blocked.dependencies.some((d) => d.ticketId === blocker && d.type === "blocked_by")).toBe(true);
    expect((await env.lifecycle.getActive()).map((t) => t.id)).not.toContain(id);
  });
});

describe("completion requires verified acceptance criteria", () => {
  it("rejects review when a criterion lacks completion", async () => {
    const id = await readyTicket();
    await env.lifecycle.start(id);
    await expect(env.lifecycle.submitForReview(id)).rejects.toBeInstanceOf(
      AcceptanceCriteriaIncompleteError,
    );
  });

  it("rejects completion when a criterion lacks evidence", async () => {
    const id = await readyTicket();
    await env.lifecycle.start(id);
    const ticket = await env.ticketService.get(id);
    ticket.acceptanceCriteria[0].completed = true;
    ticket.acceptanceCriteria[0].evidence = "";
    await env.tickets.update(ticket);
    await env.lifecycle.submitForReview(id);
    await expect(env.lifecycle.complete(id, "summary")).rejects.toBeInstanceOf(
      AcceptanceCriteriaIncompleteError,
    );
  });

  it("completes once every criterion is completed with evidence", async () => {
    const id = await readyTicket();
    await env.lifecycle.start(id);
    await env.ticketService.setAcceptance(id, "AC-1", true, "passed e2e");
    await env.lifecycle.submitForReview(id);
    const done = await env.lifecycle.complete(id, "All green");
    expect(done.status).toBe("done");
    expect(done.verificationSummary).toBe("All green");
    expect(done.completedAt).toBeDefined();
    const meta = await env.board.get();
    expect(meta.activeTicketId).toBeUndefined();
  });
});

describe("review gate (in_progress -> in_review -> done)", () => {
  it("in_progress -> in_review requires all criteria completed", async () => {
    const id = await readyTicket();
    await env.lifecycle.start(id);
    await expect(env.lifecycle.submitForReview(id)).rejects.toBeInstanceOf(
      AcceptanceCriteriaIncompleteError,
    );
  });

  it("in_review -> in_progress returns work for changes", async () => {
    const id = await readyTicket();
    await env.lifecycle.start(id);
    await env.ticketService.setAcceptance(id, "AC-1", true, "proof");
    const reviewed = await env.lifecycle.submitForReview(id);
    expect(reviewed.status).toBe("in_review");
    const back = await env.lifecycle.requestChanges(id);
    expect(back.status).toBe("in_progress");
  });

  it("rejects review from a non-in_progress ticket", async () => {
    const id = await readyTicket();
    await expect(env.lifecycle.submitForReview(id)).rejects.toBeInstanceOf(
      InvalidTransitionError,
    );
  });
});

describe("acceptance handling", () => {
  it("requires evidence to mark a criterion complete", async () => {
    const id = await readyTicket();
    await expect(env.ticketService.setAcceptance(id, "AC-1", true)).rejects.toBeInstanceOf(
      AcceptanceCriteriaIncompleteError,
    );
  });

  it("clears evidence when marked incomplete", async () => {
    const id = await readyTicket();
    await env.ticketService.setAcceptance(id, "AC-1", true, "proof");
    const incomplete = await env.ticketService.setAcceptance(id, "AC-1", false);
    const crit = incomplete.acceptanceCriteria.find((c) => c.id === "AC-1");
    expect(crit?.completed).toBe(false);
    expect(crit?.evidence).toBeUndefined();
  });

  it("throws for an unknown criterion", async () => {
    const id = await readyTicket();
    await expect(
      env.ticketService.setAcceptance(id, "AC-999", true, "proof"),
    ).rejects.toThrow(/not found/);
  });
});
