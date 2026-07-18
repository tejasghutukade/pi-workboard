import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkTicket } from "../domain/ticket.js";
import { UnresolvedDependencyError } from "../domain/errors.js";
import { setup, makeTicket, type TestEnv } from "./helpers.js";

let env: TestEnv;

beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.cleanup();
});

const READY = {
  title: "Ready",
  objective: "Do it",
  background: "Because",
  scope: ["Build it"] as string[],
  acceptanceCriteria: [{ id: "AC-1", description: "Works", completed: false }],
};

async function createReadyTicket(deps?: WorkTicket["dependencies"]): Promise<string> {
  const result = await env.ticketService.create({ status: "ready", ...READY, dependencies: deps });
  return result.id;
}

describe("self-dependency rejection", () => {
  it("rejects an update that makes a ticket depend on itself", async () => {
    const id = await createReadyTicket();
    await expect(
      env.ticketService.update(id, { dependencies: [{ ticketId: id, type: "blocked_by" }] }),
    ).rejects.toBeInstanceOf(UnresolvedDependencyError);
  });
});

describe("direct dependency cycle", () => {
  it("rejects A->B->A", async () => {
    const a = await createReadyTicket();
    const b = await createReadyTicket();
    await env.ticketService.update(a, { dependencies: [{ ticketId: b, type: "blocked_by" }] });
    await expect(
      env.ticketService.update(b, { dependencies: [{ ticketId: a, type: "blocked_by" }] }),
    ).rejects.toThrow(/Circular dependency/);
  });
});

describe("transitive dependency cycle", () => {
  it("rejects A->B->C->A", async () => {
    const a = await createReadyTicket();
    const b = await createReadyTicket();
    const c = await createReadyTicket();
    await env.ticketService.update(a, { dependencies: [{ ticketId: b, type: "blocked_by" }] });
    await env.ticketService.update(b, { dependencies: [{ ticketId: c, type: "blocked_by" }] });
    await expect(
      env.ticketService.update(c, { dependencies: [{ ticketId: a, type: "blocked_by" }] }),
    ).rejects.toThrow(/Circular dependency/);
  });
});

describe("unresolved blockers", () => {
  it("start is blocked while a blocked_by dependency is not done", async () => {
    const blocker = await createReadyTicket();
    const dependent = await createReadyTicket([{ ticketId: blocker, type: "blocked_by" }]);
    await expect(env.lifecycle.start(dependent)).rejects.toBeInstanceOf(
      UnresolvedDependencyError,
    );
  });

  it("unblock requires blocked_by dependencies to be done", async () => {
    // Pin ids directly for a controlled graph.
    await env.tickets.create(makeTicket("WB-0001", { status: "backlog" }));
    await env.tickets.create(
      makeTicket("WB-0002", {
        status: "blocked",
        blockedReason: "waiting",
        dependencies: [{ ticketId: "WB-0001", type: "blocked_by" }],
      }),
    );

    await expect(env.lifecycle.unblock("WB-0002")).rejects.toBeInstanceOf(
      UnresolvedDependencyError,
    );

    await env.tickets.update(makeTicket("WB-0001", { status: "done" }));
    const result = await env.lifecycle.unblock("WB-0002");
    expect(result.status).toBe("ready");
    expect(result.blockedReason).toBeUndefined();
  });

  it("related_to dependencies do not block start", async () => {
    const related = await createReadyTicket();
    const dependent = await createReadyTicket([{ ticketId: related, type: "related_to" }]);
    const started = await env.lifecycle.start(dependent);
    expect(started.status).toBe("in_progress");
  });
});
