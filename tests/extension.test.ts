/**
 * Milestone 3/4 integration test: tools and commands register against a mocked
 * Pi API and wire through to the real services (using a temp workboard dir).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionUIContext,
  RegisteredCommand,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { registerTools, buildAllTools, type WorkboardContext } from "../pi/register-tools.js";
import { registerCommands } from "../pi/register-commands.js";
import { setup, type TestEnv } from "./helpers.js";

const EXPECTED_TOOLS = [
  "workboard_create",
  "workboard_get",
  "workboard_list",
  "workboard_next",
  "workboard_start",
  "workboard_set_worktree",
  "workboard_update",
  "workboard_progress",
  "workboard_acceptance",
  "workboard_block",
  "workboard_unblock",
  "workboard_review",
  "workboard_changes",
  "workboard_complete",
  "workboard_ready",
  "workboard_set_prefix",
];

const EXPECTED_COMMANDS = [
  "board",
  "ticket",
  "ticket-new",
  "ticket-next",
  "ticket-start",
  "ticket-work",
  "ticket-block",
  "ticket-review",
  "ticket-changes",
  "workboard-dashboard",
  "workboard-prefix",
];

function makeMockPi(): {
  api: ExtensionAPI;
  tools: ToolDefinition[];
  commands: RegisteredCommand[];
  sentMessages: string[];
} {
  const tools: ToolDefinition[] = [];
  const commands: RegisteredCommand[] = [];
  const sentMessages: string[] = [];
  const api = {
    registerTool: (t: ToolDefinition) => tools.push(t),
    registerCommand: (name: string, opts: Omit<RegisteredCommand, "name">) =>
      commands.push({ name, ...opts }),
    on: () => undefined,
    sendUserMessage: async (msg: string) => {
      sentMessages.push(msg);
    },
  } as unknown as ExtensionAPI;
  return { api, tools, commands, sentMessages };
}

function ctxFor(env: TestEnv): WorkboardContext {
  return {
    ticketService: env.ticketService,
    lifecycle: env.lifecycle,
    selection: env.selection,
    sessionActive: env.sessionActive,
    boardRepo: env.board,
  };
}

/** Invoke a tool's execute with the Pi-context args filled in. */
function exec(
  tool: ToolDefinition,
  params: Record<string, unknown>,
): Promise<AgentToolResult<unknown>> {
  return tool.execute(
    "call",
    params as never,
    undefined,
    undefined,
    undefined as unknown as ExtensionCommandContext,
  ) as Promise<AgentToolResult<unknown>>;
}

function textOf(result: AgentToolResult<unknown>): string {
  return String((result.content[0] as { text: string }).text);
}

/** Build a mock command context whose ui records widgets/notifications. */
function makeMockCtx(inputs: string[], selectValue: string | undefined) {
  const widgets = new Map<string, string[]>();
  const notifications: string[] = [];
  let i = 0;
  const ui = {
    setWidget: (key: string, content: string[]) => widgets.set(key, content),
    notify: (msg: string) => notifications.push(msg),
    input: async () => (i < inputs.length ? inputs[i++] : ""),
    select: async () => selectValue,
    confirm: async () => true,
  } as unknown as ExtensionUIContext;
  return { ui, widgets, notifications };
}

let env: TestEnv;

beforeEach(async () => {
  env = await setup();
});
afterEach(async () => {
  await env.cleanup();
});

describe("tool registration", () => {
  it("registers exactly the expected tools", () => {
    const { api, tools } = makeMockPi();
    registerTools(api, ctxFor(env));
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    expect(tools).toHaveLength(EXPECTED_TOOLS.length);
  });

  it("buildAllTools returns all tools without a Pi instance", () => {
    const tools = buildAllTools(ctxFor(env));
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });
});

describe("command registration", () => {
  it("registers exactly the expected commands", () => {
    const { api, commands } = makeMockPi();
    registerCommands(api, ctxFor(env));
    const names = commands.map((c) => c.name).sort();
    expect(names).toEqual([...EXPECTED_COMMANDS].sort());
    expect(commands).toHaveLength(EXPECTED_COMMANDS.length);
  });

  it("ticket-work hands off to the agent instead of starting the ticket", async () => {
    const { api, commands, sentMessages } = makeMockPi();
    registerCommands(api, ctxFor(env));
    const cmd = commands.find((c) => c.name === "ticket-work")!;

    const id = await env.ticketService
      .create({
        status: "ready",
        title: "T",
        objective: "o",
        background: "b",
        scope: ["s"],
        acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
      })
      .then((r) => r.id);
    expect((await env.ticketService.get(id)).status).toBe("ready");

    const notifications: string[] = [];
    const c = {
      ui: { notify: (m: string) => notifications.push(m) },
      sessionManager: { getSessionId: () => "test-session" },
    } as unknown as ExtensionCommandContext;
    await cmd.handler(id, c);

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain(id);
    expect(sentMessages[0]).toContain("in_progress");
    expect(sentMessages[0]).toContain("worktree");
    // The command must NOT mutate the ticket itself.
    const after = await env.ticketService.get(id);
    expect(after.status).toBe("ready");
  });

  it("ticket-work errors for an unknown ticket and sends no message", async () => {
    const { api, commands, sentMessages } = makeMockPi();
    registerCommands(api, ctxFor(env));
    const cmd = commands.find((c) => c.name === "ticket-work")!;

    const notifications: string[] = [];
    const c = {
      ui: { notify: (m: string) => notifications.push(m) },
    } as unknown as ExtensionCommandContext;
    await cmd.handler("WB-9999", c);

    expect(sentMessages).toHaveLength(0);
    expect(notifications.join(" ")).toMatch(/error/i);
  });

  it("ticket-work rejects a backlog ticket (not ready to be worked on)", async () => {
    const { api, commands, sentMessages } = makeMockPi();
    registerCommands(api, ctxFor(env));
    const cmd = commands.find((c) => c.name === "ticket-work")!;

    const id = await env.ticketService
      .create({
        status: "backlog",
        title: "T",
        objective: "o",
        background: "b",
        scope: ["s"],
        acceptanceCriteria: [{ id: "AC-1", description: "d", completed: false }],
      })
      .then((r) => r.id);
    expect((await env.ticketService.get(id)).status).toBe("backlog");

    const notifications: string[] = [];
    const c = {
      ui: { notify: (m: string) => notifications.push(m) },
    } as unknown as ExtensionCommandContext;
    await cmd.handler(id, c);

    // No handoff to the agent, and the ticket is left untouched.
    expect(sentMessages).toHaveLength(0);
    expect(notifications.join(" ")).toMatch(/backlog/i);
    expect((await env.ticketService.get(id)).status).toBe("backlog");
  });
});

describe("tool behavior (wired to real services)", () => {
  it("create then get returns the full ticket", async () => {
    const { api, tools } = makeMockPi();
    registerTools(api, ctxFor(env));

    const create = tools.find((t) => t.name === "workboard_create")!;
    const get = tools.find((t) => t.name === "workboard_get")!;

    const created = await exec(create, {
      status: "ready",
      title: "Feature X",
      objective: "Ship X",
      background: "Needed",
      scope: ["Build X"],
      acceptanceCriteria: [{ id: "AC-1", description: "X works" }],
    });
    expect(textOf(created)).toMatch(/WB-0001/);

    const fetched = await exec(get, { id: "WB-0001" });
    expect(textOf(fetched)).toContain("Feature X");
    expect(textOf(fetched)).toContain("Ship X");
  });

  it("returns a friendly error (no stack trace) when starting a non-ready ticket", async () => {
    const { api, tools } = makeMockPi();
    registerTools(api, ctxFor(env));

    const create = tools.find((t) => t.name === "workboard_create")!;
    await exec(create, { title: "Incomplete", objective: "o", background: "b" });

    const start = tools.find((t) => t.name === "workboard_start")!;
    const result = await exec(start, { id: "WB-0001" });
    const text = textOf(result);
    expect(text).toMatch(/Workboard error:/);
    expect(text).toMatch(/ready/);
    expect(text).not.toMatch(/at Object|TypeError|stack/i);
  });

  it("workboard_next finds the next ready, unblocked ticket to start (not an already-active one)", async () => {
    const { api, tools } = makeMockPi();
    registerTools(api, ctxFor(env));

    const create = tools.find((t) => t.name === "workboard_create")!;
    // An in_progress ticket being worked on.
    await exec(create, {
      status: "ready", title: "Active", objective: "o", background: "b",
      scope: ["s"], acceptanceCriteria: [{ id: "AC-1", description: "d" }],
    });
    const start = tools.find((t) => t.name === "workboard_start")!;
    await exec(start, { id: "WB-0001" });

    // A separate ready ticket that should be "next".
    await exec(create, {
      status: "ready", title: "Next", objective: "o", background: "b",
      scope: ["s"], acceptanceCriteria: [{ id: "AC-1", description: "d" }],
    });

    const next = tools.find((t) => t.name === "workboard_next")!;
    const result = await exec(next, {});
    expect(textOf(result)).toContain("WB-0002");
    expect(textOf(result)).not.toMatch(/WB-0001/);
  });
});

describe("command behavior (wired to real services)", () => {
  it("/board renders a grouped board and a status widget", async () => {
    const { api, commands } = makeMockPi();
    registerCommands(api, ctxFor(env));

    // Seed a ready ticket via the create tool so the board has content.
    const tools = buildAllTools(ctxFor(env));
    const created = await exec(
      tools.find((t) => t.name === "workboard_create")!,
      {
        status: "ready",
        title: "Board item",
        objective: "o",
        background: "b",
        scope: ["s"],
        acceptanceCriteria: [{ id: "AC-1", description: "d" }],
      },
    );
    expect(textOf(created)).toMatch(/WB-0001/);

    const board = commands.find((c) => c.name === "board")!;
    const ctx = makeMockCtx([], undefined);
    await board.handler("", ctx as unknown as ExtensionCommandContext);

    const boardLines = ctx.widgets.get("workboard-board");
    expect(boardLines).toBeDefined();
    expect(boardLines!.join("\n")).toMatch(/Ready/);
    expect(boardLines!.join("\n")).toContain("WB-0001");

    const statusLines = ctx.widgets.get("workboard-status");
    expect(statusLines).toBeDefined();
    expect(statusLines!.join("\n")).toMatch(/Ready:|Blocked:/);
  });

  it("/ticket-new creates a ticket via interactive input", async () => {
    const { api, commands } = makeMockPi();
    registerCommands(api, ctxFor(env));

    const cmd = commands.find((c) => c.name === "ticket-new")!;
    const inputs = [
      "New from command",
      "Outcome",
      "Because",
      "scope item one",
      "scope item two",
      "", // finish scope
      "criterion one",
      "", // finish acceptance
    ];
    const ctx = makeMockCtx(inputs, "high");
    await cmd.handler("", ctx as unknown as ExtensionCommandContext);

    const notify = ctx.notifications.join("\n");
    expect(notify).toMatch(/Created WB-0001/);

    const created = await env.ticketService.get("WB-0001");
    expect(created.title).toBe("New from command");
    expect(created.priority).toBe("high");
    expect(created.scope).toEqual(["scope item one", "scope item two"]);
    expect(created.acceptanceCriteria.map((a) => a.id)).toEqual(["AC-1"]);
  });

  it("/workboard-prefix sets a valid prefix and rejects invalid ones", async () => {
    const { api, commands } = makeMockPi();
    registerCommands(api, ctxFor(env));

    const cmd = commands.find((c) => c.name === "workboard-prefix")!;

    // Invalid prefix -> warning, prefix unchanged.
    const badCtx = makeMockCtx([], undefined);
    await cmd.handler("WAYTOOLONG", badCtx as unknown as ExtensionCommandContext);
    expect(badCtx.notifications.join(" ")).toMatch(/1-4 letters or digits/i);
    expect((await env.boardRepo.get()).idPrefix ?? "WB").toBe("WB");

    // Valid prefix -> info, prefix persisted.
    const okCtx = makeMockCtx([], undefined);
    await cmd.handler("TSK", okCtx as unknown as ExtensionCommandContext);
    expect(okCtx.notifications.join(" ")).toMatch(/prefix set to 'TSK'/i);
    expect((await env.boardRepo.get()).idPrefix).toBe("TSK");

    // New ticket now uses the new prefix.
    const tools = buildAllTools(ctxFor(env));
    const created = await exec(
      tools.find((t) => t.name === "workboard_create")!,
      {
        status: "ready",
        title: "Prefixed",
        objective: "o",
        background: "b",
        scope: ["s"],
        acceptanceCriteria: [{ id: "AC-1", description: "d" }],
      },
    );
    expect(textOf(created)).toMatch(/TSK-0001/);
  });
});
