/**
 * Milestone 5 tests: durable context restoration and pre-agent context
 * injection. Uses a temp workboard dir and a mock Pi that records `on`
 * handlers so the session_start / context / before_agent_start wiring can be
 * invoked directly.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { createWorkboardEnvironment, type WorkboardEnvironment } from "../services/workboard.js";
import { registerLifecycle } from "../pi/register-lifecycle.js";
import { generateContextBlock } from "../pi/context-block.js";

function mockPi() {
  const handlers: Record<string, Function[]> = {};
  const pi = {
    on: (event: string, handler: Function) => {
      (handlers[event] ??= []).push(handler);
    },
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

function mockCtx(sessionId = "sess-test") {
  const notifications: { msg: string; level?: string }[] = [];
  const widgets = new Map<string, string[]>();
  const ui = {
    setWidget: (key: string, content: string[]) => widgets.set(key, content),
    notify: (msg: string, level?: string) => notifications.push({ msg, level }),
  } as unknown as ExtensionUIContext;
  const sessionManager = {
    getSessionId: () => sessionId,
    getSessionDir: () => "/tmp/sess",
    getSessionFile: () => "/tmp/sess/session.jsonl",
    getCwd: () => "/tmp",
  } as unknown as ExtensionContext["sessionManager"];
  return { ctx: { ui, sessionManager } as unknown as ExtensionContext, notifications, widgets };
}

const CTX = () => ({
  ticketService: env.ticketService,
  lifecycle: env.lifecycle,
  selection: env.selection,
  sessionActive: env.sessionActive,
});

let root: string;
let dir: string;
let env: WorkboardEnvironment;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "wb-life-"));
  dir = path.join(root, ".pi", "workboard");
  env = await createWorkboardEnvironment(dir);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("session_start restoration", () => {
  it("warns when an in_progress ticket has unresolved blockers and leaves files unchanged", async () => {
    const blocker = await env.ticketService.create({
      title: "Blocker", objective: "o", background: "b",
      scope: ["s"], acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    const { id } = await env.ticketService.create({
      status: "ready", title: "Blocked-active", objective: "o", background: "b",
      scope: ["s"], acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
      dependencies: [{ ticketId: blocker.id, type: "blocked_by" }],
    });
    // Simulate drift: bypass lifecycle to mark it in_progress while blocked.
    const drifted = await env.ticketRepo.get(id);
    drifted!.status = "in_progress";
    await env.ticketRepo.update(drifted!);

    const { pi, handlers } = mockPi();
    registerLifecycle(pi, CTX());
    const { ctx, notifications, widgets } = mockCtx();
    await handlers["session_start"][0]({ type: "session_start", reason: "startup" }, ctx);

    const warn = notifications.find((n) => n.level === "warning");
    expect(warn).toBeDefined();
    expect(warn!.msg).toMatch(new RegExp(id));
    expect(warn!.msg).toMatch(/unresolved blockers/);

    const raw = JSON.parse(await readFile(path.join(dir, "board.json"), "utf8"));
    expect(raw).not.toHaveProperty("activeTicketId"); // no single-pointer field

    expect(widgets.get("workboard-status")!.join("\n")).toMatch(/Active/);
  });

  it("warns when an in_progress ticket still carries a blocked reason", async () => {
    const { id } = await env.ticketService.create({
      status: "ready",
      title: "Ready",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    await env.lifecycle.start(id);
    const drifted = await env.ticketRepo.get(id);
    drifted!.blockedReason = "forgotten reason";
    await env.ticketRepo.update(drifted!);

    const { pi, handlers } = mockPi();
    registerLifecycle(pi, CTX());
    const { ctx, notifications } = mockCtx();
    await handlers["session_start"][0]({ type: "session_start", reason: "startup" }, ctx);

    const warn = notifications.find((n) => n.level === "warning");
    expect(warn).toBeDefined();
    expect(warn!.msg).toMatch(new RegExp(id));
    expect(warn!.msg).toMatch(/blocked reason/);
  });

  it("does not warn when the active ticket is a valid in_progress ticket", async () => {
    const { id } = await env.ticketService.create({
      status: "ready",
      title: "Ready",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    await env.lifecycle.start(id);
    const { pi, handlers } = mockPi();
    registerLifecycle(pi, CTX());
    const { ctx, notifications } = mockCtx();
    await handlers["session_start"][0]({ type: "session_start", reason: "startup" }, ctx);

    expect(notifications.find((n) => n.level === "warning")).toBeUndefined();
  });
});

describe("pre-agent context injection", () => {
  it("before_agent_start injects the active ticket context block", async () => {
    const { id } = await env.ticketService.create({
      status: "ready",
      title: "Active work",
      objective: "Ship it",
      background: "Because",
      scope: ["Build"],
      acceptanceCriteria: [{ id: "AC-1", description: "Works", completed: false }],
    });
    await env.lifecycle.start(id);
    const { pi, handlers } = mockPi();
    registerLifecycle(pi, CTX());
    const { ctx } = mockCtx();
    const result = (await handlers["before_agent_start"][0]({}, ctx)) as {
      message?: { customType: string; content: string };
    };
    expect(result.message?.customType).toBe("workboard-context");
    expect(result.message?.content).toMatch(new RegExp(id));
    expect(result.message?.content).toMatch(/Objective: Ship it/);
    expect(result.message?.content).toMatch(/Remaining acceptance criteria: AC-1/);
  });

  it("context handler strips stale injected blocks before rebuild", async () => {
    const { pi, handlers } = mockPi();
    registerLifecycle(pi, CTX());
    const event = {
      type: "context" as const,
      messages: [
        { role: "user" as const, content: "keep me" },
        { role: "user" as const, content: "stale", customType: "workboard-context" },
      ],
    };
    const res = (await handlers["context"][0](event)) as { messages: unknown[] };
    expect(res.messages).toHaveLength(1);
    expect((res.messages[0] as { content: string }).content).toBe("keep me");
  });
});

describe("live status widget refresh after tool use", () => {
  it("refreshes the status widget after a workboard_* tool runs", async () => {
    const { pi, handlers } = mockPi();
    registerLifecycle(pi, CTX());
    const { ctx, widgets } = mockCtx();

    // No widget rendered yet.
    expect(widgets.get("workboard-status")).toBeUndefined();

    // Agent creates a ticket through the tool (board state changes on disk).
    await env.ticketService.create({
      status: "ready",
      title: "R",
      objective: "o",
      background: "b",
      scope: ["s"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });

    await handlers["tool_execution_end"][0](
      {
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "workboard_create",
        result: {},
        isError: false,
      },
      ctx,
    );

    const lines = widgets.get("workboard-status");
    expect(lines).toBeDefined();
    expect(lines!.join("\n")).toMatch(/Ready: 1/); // re-reads fresh state
  });

  it("does not refresh for non-workboard tools", async () => {
    const { pi, handlers } = mockPi();
    registerLifecycle(pi, CTX());
    const { ctx, widgets } = mockCtx();

    await handlers["tool_execution_end"][0](
      {
        type: "tool_execution_end",
        toolCallId: "t2",
        toolName: "bash",
        result: {},
        isError: false,
      },
      ctx,
    );

    expect(widgets.get("workboard-status")).toBeUndefined();
  });
});

describe("generateContextBlock", () => {
  it("summarizes the active ticket and recent progress", async () => {
    const { id } = await env.ticketService.create({
      status: "ready",
      title: "Active",
      objective: "Obj",
      background: "Bg",
      scope: ["S"],
      acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
    });
    await env.lifecycle.start(id);
    await env.ticketService.recordProgress(id, "implementation", "wired it up");
    const block = await generateContextBlock(CTX());
    expect(block).toMatch(new RegExp(id));
    expect(block).toMatch(/Objective: Obj/);
    expect(block).toMatch(/\[implementation\] wired it up/);
  });

  it("reports counts when there is no active ticket", async () => {
    const block = await generateContextBlock(CTX());
    expect(block).toMatch(/No active ticket/);
    expect(block).toMatch(/Ready: 0/);
  });
});
