/**
 * Pi command registration (Milestone 4).
 *
 * Six human-facing slash commands that wrap the services and render output via
 * `ctx.ui.setWidget`. Lifecycle-mutating commands also refresh the persistent
 * status widget (active ticket, or ready/blocked counts).
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { Priority } from "../domain/ticket.js";
import { WorkboardError } from "../domain/errors.js";
import { renderTicket } from "./render-ticket.js";
import { renderBoard } from "./render-board.js";
import { updateStatusWidget } from "./status-widget.js";
import type { WorkboardContext } from "./register-tools.js";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BOARD_WIDGET = "workboard-board";
const TICKET_WIDGET = "workboard-ticket";

export function registerCommands(pi: ExtensionAPI, ctx: WorkboardContext): void {
  pi.registerCommand("board", {
    description: "Render the workboard: Ready, In Progress, Blocked, and Done.",
    handler: async (_args, c) => {
      const tickets = await ctx.ticketService.list();
      c.ui.setWidget(BOARD_WIDGET, renderBoard(tickets));
      await updateStatusWidget(c, ctx);
    },
  });

  pi.registerCommand("ticket", {
    description: "Render a full ticket. Usage: /ticket WB-0001",
    handler: async (args, c) => {
      const id = args.trim();
      if (!id) {
        c.ui.notify("Usage: /ticket WB-0001", "warning");
        return;
      }
      try {
        const t = await ctx.ticketService.get(id);
        c.ui.setWidget(TICKET_WIDGET, renderTicket(t));
      } catch (err) {
        c.ui.notify(friendly(err), "error");
      }
    },
  });

  pi.registerCommand("ticket-new", {
    description: "Interactively create a ticket (minimum required fields only).",
    handler: async (_args, c) => {
      const title = (await c.ui.input("Ticket title"))?.trim();
      if (!title) {
        c.ui.notify("Cancelled: a title is required.", "info");
        return;
      }
      const objective = (await c.ui.input("Objective (outcome, not implementation)"))?.trim() ?? "";
      const background = (await c.ui.input("Background / reasoning"))?.trim() ?? "";
      const scope = await collectLines(c, "Scope item (empty to finish)");
      const acceptance = await collectLines(c, "Acceptance criterion (empty to finish)");
      const prerequisites = await collectLines(c, "Prerequisite / setup step (empty to finish)");
      const priorityRaw = await c.ui.select("Priority", ["low", "medium", "high", "critical"]);
      const priority: Priority = (priorityRaw as Priority) ?? "medium";

      const result = await ctx.ticketService.create({
        title,
        objective,
        background,
        scope,
        acceptanceCriteria: acceptance.map((a, i) => ({
          id: `AC-${i + 1}`,
          description: a,
          completed: false,
        })),
        priority,
        prerequisites,
      });
      const note = result.missing.length
        ? ` Missing refinement fields: ${result.missing.join(", ")} (status is "${result.status}").`
        : "";
      c.ui.notify(`Created ${result.id} (status: ${result.status}).${note}`, "info");
      await updateStatusWidget(c, ctx);
    },
  });

  pi.registerCommand("ticket-next", {
    description: "Show the best next actionable ticket without starting it.",
    handler: async (_args, c) => {
      const next = await ctx.selection.next();
      if (!next) {
        c.ui.notify("No actionable ticket: no active and no ready ticket without blockers.", "info");
        return;
      }
      c.ui.setWidget(TICKET_WIDGET, renderTicket(next));
    },
  });

  pi.registerCommand("ticket-start", {
    description: "Start a ready ticket and make it active. Usage: /ticket-start WB-0001",
    handler: async (args, c) => {
      const id = args.trim();
      if (!id) {
        c.ui.notify("Usage: /ticket-start WB-0001", "warning");
        return;
      }
      try {
        const t = await ctx.lifecycle.start(id);
        const count = (await ctx.ticketService.list()).filter((x) => x.status === "in_progress").length;
        c.ui.notify(
          `${t.id} started (${count} active). Parallel work is allowed; blockers still gate starting.`,
          "info",
        );
        await updateStatusWidget(c, ctx);
      } catch (err) {
        c.ui.notify(friendly(err), "error");
      }
    },
  });

  pi.registerCommand("ticket-work", {
    description:
      "Tell the agent to start working on a ticket in a fresh git worktree and move it to in_progress. Usage: /ticket-work WB-0001",
    handler: async (args, c) => {
      const id = args.trim();
      if (!id) {
        c.ui.notify("Usage: /ticket-work WB-0001", "warning");
        return;
      }
      // Verify the ticket exists, but do not mutate it — hand off to the agent.
      let ticket;
      try {
        ticket = await ctx.ticketService.get(id);
      } catch (err) {
        c.ui.notify(friendly(err), "error");
        return;
      }
      // Backlog tickets are not ready to be worked on. Every other status
      // (ready, in_progress, in_review, blocked, done, cancelled) is allowed
      // to be picked up — the agent will transition it as appropriate.
      if (ticket.status === "backlog") {
        c.ui.notify(
          `${id} is in backlog — refine and move it to ready (use /ticket-new completeness or workboard tools) before working on it.`,
          "warning",
        );
        return;
      }
      const message =
        `Start working on ticket ${id}. ` +
        `Move it to in_progress and implement the work in an isolated git worktree. ` +
        `Use the workboard tools: \`workboard_start\` (or \`/ticket-start ${id}\`) to mark it active, ` +
        `create the git worktree yourself under the project's \`.worktrees/\` folder (e.g. \`git worktree add .worktrees/${id} -b wb/${id}\`), ` +
        `then call \`workboard_set_worktree\` with the worktree path you created so it shows in the dashboard. ` +
        `Keep the active ticket as the source of truth and record progress as you go. Mark the ticket as done only when the work is merge in main.`;
      await pi.sendUserMessage(message);
      await ctx.sessionActive.set(c.sessionManager.getSessionId(), id);
      c.ui.notify(
        `Handed off to the agent: start working on ${id} (move to in_progress + new worktree).`,
        "info",
      );
    },
  });

  pi.registerCommand("ticket-block", {
    description: "Block a ticket with a reason (and optional blocker). Usage: /ticket-block WB-0001 [WB-0002]",
    handler: async (args, c) => {
      const [id, blockedBy] = args.trim().split(/\s+/);
      if (!id) {
        c.ui.notify("Usage: /ticket-block WB-0001 [WB-0002]", "warning");
        return;
      }
      const reason = (await c.ui.input("Block reason"))?.trim();
      if (!reason) {
        c.ui.notify("Cancelled: a reason is required to block.", "info");
        return;
      }
      try {
        const t = await ctx.lifecycle.block(id, reason, blockedBy);
        c.ui.notify(`${t.id} blocked: ${t.blockedReason}`, "info");
        await updateStatusWidget(c, ctx);
      } catch (err) {
        c.ui.notify(friendly(err), "error");
      }
    },
  });

  pi.registerCommand("ticket-review", {
    description:
      "Submit an in_progress ticket for review (move to in_review). Usage: /ticket-review WB-0001",
    handler: async (args, c) => {
      const id = args.trim();
      if (!id) {
        c.ui.notify("Usage: /ticket-review WB-0001", "warning");
        return;
      }
      try {
        const t = await ctx.lifecycle.submitForReview(id);
        c.ui.notify(`${t.id} submitted for review (status: in_review).`, "info");
        await updateStatusWidget(c, ctx, c.sessionManager.getSessionId());
      } catch (err) {
        c.ui.notify(friendly(err), "error");
      }
    },
  });

  pi.registerCommand("ticket-changes", {
    description:
      "Return an in_review ticket to in_progress when review requests changes. Usage: /ticket-changes WB-0001",
    handler: async (args, c) => {
      const id = args.trim();
      if (!id) {
        c.ui.notify("Usage: /ticket-changes WB-0001", "warning");
        return;
      }
      try {
        const t = await ctx.lifecycle.requestChanges(id);
        c.ui.notify(`${t.id} back to in_progress; changes requested.`, "info");
        await updateStatusWidget(c, ctx, c.sessionManager.getSessionId());
      } catch (err) {
        c.ui.notify(friendly(err), "error");
      }
    },
  });

  pi.registerCommand("workboard-dashboard", {
    description: "Launch the live, auto-refreshing workboard dashboard in your browser.",
    handler: async (_args, c) => {
      const serverPath = fileURLToPath(new URL("../dashboard/server.mjs", import.meta.url));
      const workboardDir = path.join(c.cwd, ".pi", "workboard");
      // Fixed port so re-running this command restarts the same server instead
      // of spawning a new one each time.
      const port = Number(process.env.WORKBOARD_PORT) || 8777;
      const url = `http://localhost:${port}/`;

      // Restart cleanly: stop any dashboard already listening on this port
      // before spawning a fresh one.
      await killPort(port).catch(() => undefined);

      const child = spawn(process.execPath, [serverPath], {
        env: { ...process.env, WORKBOARD_DIR: workboardDir, PORT: String(port) },
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      openBrowser(url);

      // Footer status is scoped to THIS session's UI, so only the session that
      // ran /workboard-dashboard shows "wbdash running". Other sessions are
      // unaffected, and /reload (which re-registers the extension in the same
      // process) does not tear down the detached server.
      c.ui.setStatus("wbdash", `running · ${url}`);

      const where = existsSync(workboardDir)
        ? `"${workboardDir}"`
        : `"${workboardDir}" (not found yet — it will appear once tickets exist)`;
      c.ui.notify(
        `Workboard dashboard opened at ${url} (server pid ${child.pid}, reading ${where}).`,
        "info",
      );
    },
  });
}

async function collectLines(
  ctx: ExtensionCommandContext,
  prompt: string,
): Promise<string[]> {
  const out: string[] = [];
  for (;;) {
    const line = (await ctx.ui.input(prompt))?.trim();
    if (!line) break;
    out.push(line);
  }
  return out;
}

function friendly(err: unknown): string {
  if (err instanceof WorkboardError) return `Workboard error: ${err.message}`;
  return `Workboard error: ${err instanceof Error ? err.message : String(err)}`;
}

/** Stop any process currently listening on `port` (best-effort), so the
 * dashboard can restart on the same port. No-op if nothing is listening. */
function killPort(port: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      // Windows: find the PID via netstat, then terminate it.
      const find = spawn("cmd", ["/c", "netstat", "-ano", "|", "findstr", `:${port}`], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let out = "";
      find.stdout.on("data", (d) => (out += d.toString()));
      find.on("close", () => {
        const m = out.match(/\s+(\d+)\s*$/m);
        if (m) {
          try {
            spawn("taskkill", ["/F", "/PID", m[1]], { stdio: "ignore" });
          } catch {
            /* ignore */
          }
        }
        resolve();
      });
      return;
    }
    // macOS / Linux: lsof gives the listening PID directly.
    const p = spawn("lsof", ["-ti", `:${port}`], { stdio: ["ignore", "pipe", "ignore"] });
    let pidOut = "";
    p.stdout.on("data", (d) => (pidOut += d.toString()));
    p.on("close", () => {
      const pids = pidOut.split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        try {
          process.kill(Number(pid), "SIGTERM");
        } catch {
          /* already gone */
        }
      }
      resolve();
    });
  });
}

/** Open a URL in the OS default browser (best-effort, platform aware). */
function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  try {
    const p = spawn(cmd, args, { stdio: "ignore", detached: true });
    p.unref();
  } catch {
    // Browser launch is best-effort; the URL is shown in the notification.
  }
}
