import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup, type TestEnv } from "./helpers.js";

let env: TestEnv;

beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.cleanup();
});

describe("create", () => {
  it("assigns sequential ids and timestamps", async () => {
    const a = await env.ticketService.create({
      title: "A",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    const b = await env.ticketService.create({
      title: "B",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    expect(a.id).toBe("WB-0001");
    expect(b.id).toBe("WB-0002");
    expect(a.status).toBe("backlog");
    expect((await env.ticketService.get(a.id)).createdAt).toBe(env.clock.nowStr);
  });

  it("creates a ready ticket when refinement is complete", async () => {
    const result = await env.ticketService.create({
      status: "ready",
      title: "Ready",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    expect(result.status).toBe("ready");
    expect(result.missing).toEqual([]);
  });
});

describe("get and list", () => {
  it("throws TicketNotFoundError for a missing ticket", async () => {
    await expect(env.ticketService.get("WB-9999")).rejects.toThrow(/not found/);
  });

  it("filters by status and priority", async () => {
    const ready = await env.ticketService.create({
      status: "ready",
      title: "Ready",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
      priority: "critical",
    });
    await env.ticketService.create({
      title: "Backlog",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    const readyOnly = await env.ticketService.list({ status: "ready" });
    expect(readyOnly.map((t) => t.id)).toEqual([ready.id]);
    const criticalOnly = await env.ticketService.list({ priority: "critical" });
    expect(criticalOnly.map((t) => t.id)).toEqual([ready.id]);
  });

  it("filters by dependency and text", async () => {
    const blocker = await env.ticketService.create({
      title: "Blocker",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    const dependent = await env.ticketService.create({
      status: "ready",
      title: "Dependent feature",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
      dependencies: [{ ticketId: blocker.id, type: "blocked_by" }],
    });
    const byDep = await env.ticketService.list({ dependency: blocker.id });
    expect(byDep.map((t) => t.id)).toEqual([dependent.id]);
    const byText = await env.ticketService.list({ text: "dependent" });
    expect(byText.map((t) => t.id)).toEqual([dependent.id]);
  });
});

describe("partial update must not overwrite unspecified fields", () => {
  it("changes only the supplied field", async () => {
    const id = await env.ticketService
      .create({
        status: "ready",
        title: "Original",
        objective: "Objective",
        background: "Background",
        scope: ["Scope A"],
        outOfScope: ["Scope Z"],
        acceptanceCriteria: [{ id: "AC-1", description: "Works", completed: false }],
        constraints: ["C1"],
        decisions: ["D1"],
      })
      .then((r) => r.id);

    const started = await env.lifecycle.start(id); // in_progress to also prove status is untouched by update
    const updated = await env.ticketService.update(id, { title: "Renamed" });

    expect(updated.title).toBe("Renamed");
    expect(updated.objective).toBe("Objective");
    expect(updated.background).toBe("Background");
    expect(updated.scope).toEqual(["Scope A"]);
    expect(updated.outOfScope).toEqual(["Scope Z"]);
    expect(updated.constraints).toEqual(["C1"]);
    expect(updated.decisions).toEqual(["D1"]);
    expect(updated.status).toBe("in_progress"); // unchanged by update
    expect(updated.acceptanceCriteria).toHaveLength(1); // history untouched
    expect(updated.progress).toEqual(started.progress); // progress untouched
  });
});

describe("progress notes", () => {
  it("appends timestamped progress entries", async () => {
    const id = await env.ticketService
      .create({
        title: "T",
        objective: "o",
        background: "b",
        scope: ["s"],
        acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
      })
      .then((r) => r.id);
    await env.ticketService.recordProgress(id, "implementation", "wired up the parser");
    await env.ticketService.recordProgress(id, "decision", "chose option B");
    const ticket = await env.ticketService.get(id);
    expect(ticket.progress).toHaveLength(2);
    expect(ticket.progress[0]).toMatchObject({
      id: "PE-1",
      type: "implementation",
      content: "wired up the parser",
      timestamp: env.clock.nowStr,
    });
    expect(ticket.progress[1].id).toBe("PE-2");
  });
});

describe("progress authorship + prerequisites", () => {
  it("records the author when provided and omits it otherwise", async () => {
    const id = await env.ticketService
      .create({
        title: "T",
        objective: "o",
        background: "b",
        scope: ["s"],
        acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
      })
      .then((r) => r.id);
    await env.ticketService.recordProgress(id, "note", "from agent", "anthropic/claude-sonnet-4");
    await env.ticketService.recordProgress(id, "note", "system transition");
    const ticket = await env.ticketService.get(id);
    expect(ticket.progress[0].author).toBe("anthropic/claude-sonnet-4");
    expect(ticket.progress[1].author).toBeUndefined();
  });

  it("persists prerequisites through create and update", async () => {
    const { id } = await env.ticketService.create({
      title: "T",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
      prerequisites: ["Move to in_progress", "Confirm design"],
    });
    const created = await env.ticketService.get(id);
    expect(created.prerequisites).toEqual(["Move to in_progress", "Confirm design"]);

    const updated = await env.ticketService.update(id, {
      prerequisites: ["Move to in_progress"],
    });
    expect(updated.prerequisites).toEqual(["Move to in_progress"]);
  });

  it("stores the worktree path via update", async () => {
    const { id } = await env.ticketService.create({
      title: "T",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    const updated = await env.ticketService.update(id, { worktree: "/tmp/wt/WB-0001" });
    expect(updated.worktree).toBe("/tmp/wt/WB-0001");
  });
});
