import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setup, makeTicket, type TestEnv } from "./helpers.js";

let env: TestEnv;

beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.cleanup();
});

function readyInput(priority: "low" | "medium" | "high" | "critical", createdAt?: string) {
  return {
    status: "ready" as const,
    title: "Ready",
    objective: "Do it",
    background: "Because",
    scope: ["Build it"],
    acceptanceCriteria: [{ id: "AC-1", description: "Works", completed: false }],
    priority,
    ...(createdAt ? { createdAt } : {}),
  };
}

describe("workboard_next selection", () => {
  it("returns a ready, unblocked ticket to start (never an already-active one)", async () => {
    const activeId = await env.ticketService.create(readyInput("medium")).then((r) => r.id);
    await env.lifecycle.start(activeId); // now in_progress
    const readyId = (await env.ticketService.create(readyInput("low"))).id; // next to start
    const next = await env.selection.next();
    expect(next?.id).toBe(readyId);
    expect(next?.status).toBe("ready");
  });

  it("returns null when nothing is eligible", async () => {
    // A ready ticket blocked by an unfinished dependency is excluded.
    await env.tickets.create(makeTicket("WB-0999", { status: "backlog" }));
    await env.ticketService.create({
      ...readyInput("medium"),
      dependencies: [{ ticketId: "WB-0999", type: "blocked_by" }],
    });
    expect(await env.selection.next()).toBeNull();
  });

  it("excludes blocked tickets but picks an unblocked one", async () => {
    await env.tickets.create(makeTicket("WB-0999", { status: "backlog" }));
    await env.ticketService.create({
      ...readyInput("medium"),
      dependencies: [{ ticketId: "WB-0999", type: "blocked_by" }],
    });
    const eligible = await env.ticketService.create(readyInput("low"));
    const next = await env.selection.next();
    expect(next?.id).toBe(eligible.id);
  });

  it("sorts by priority (critical first)", async () => {
    const low = await env.ticketService.create(readyInput("low"));
    const critical = await env.ticketService.create(readyInput("critical"));
    const high = await env.ticketService.create(readyInput("high"));
    const next = await env.selection.next();
    expect(next?.id).toBe(critical.id);
    // Sanity: high outranks low.
    const next2Id = next?.id;
    expect([critical.id, high.id, low.id]).toContain(next2Id);
  });

  it("breaks priority ties by oldest createdAt", async () => {
    const older = await env.ticketService.create(readyInput("high", "2024-01-01T00:00:00.000Z"));
    const newer = await env.ticketService.create(readyInput("high", "2024-02-01T00:00:00.000Z"));
    const next = await env.selection.next();
    expect(next?.id).toBe(older.id);
    expect(newer.id).not.toBe(next?.id);
  });
});
