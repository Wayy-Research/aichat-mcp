#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MessageStore } from "./store.js";

// Resolve portal URL and relay key from CLI args or env
const portalUrl =
  process.argv[2] ||
  process.env.AICHAT_PORTAL_URL ||
  "https://portal.wayyresearch.com";

const relayKey =
  process.argv[3] ||
  process.env.AICHAT_RELAY_KEY ||
  "";

if (!relayKey) {
  console.error(
    "aichat MCP: relay key required. Set AICHAT_RELAY_KEY env var or pass as second CLI arg."
  );
  process.exit(1);
}

const store = new MessageStore(portalUrl, relayKey);

const server = new McpServer({
  name: "aichat",
  version: "2.0.0",
});

// --- Tool: register_agent ---
server.tool(
  "register_agent",
  "Register this agent with the message board. Call this first when starting a session.",
  {
    name: z.string().describe("Agent name (e.g. 'crux', 'devops', 'rick')"),
    role: z.string().describe("Agent role (e.g. 'backend-engineer', 'orchestrator', 'devops')"),
    workspace: z.string().describe("Absolute path to the agent's working repository"),
    current_task: z.string().optional().describe("What the agent is currently working on"),
  },
  async ({ name, role, workspace, current_task }) => {
    const agent = await store.registerAgent(name, role, workspace, current_task || "");
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(agent, null, 2),
        },
      ],
    };
  }
);

// --- Tool: send_message ---
server.tool(
  "send_message",
  "Send a message to another agent or broadcast to all agents. Messages are persisted in the shared portal database.",
  {
    from: z.string().describe("Sender agent name"),
    to: z.string().describe("Recipient agent name, or 'all' for broadcast"),
    type: z
      .enum(["instruction", "status", "question", "response", "alert", "note"])
      .describe("Message type"),
    content: z.string().describe("Message content (markdown supported)"),
    priority: z
      .enum(["low", "medium", "high", "critical"])
      .optional()
      .describe("Message priority (default: medium)"),
    thread_id: z.string().optional().describe("Thread ID for threaded conversations"),
  },
  async ({ from, to, type, content, priority, thread_id }) => {
    const msg = await store.sendMessage(
      from,
      to,
      type,
      content,
      priority || "medium",
      thread_id
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `Message sent (id: ${msg.id}).\n\n${JSON.stringify(msg, null, 2)}`,
        },
      ],
    };
  }
);

// --- Tool: read_messages ---
server.tool(
  "read_messages",
  "Read messages for an agent. Returns messages addressed to this agent or broadcast to all. Marks them as read.",
  {
    agent_name: z.string().describe("The agent reading messages"),
    unread_only: z
      .boolean()
      .optional()
      .describe("Only return unread messages (default: false)"),
    since: z
      .string()
      .optional()
      .describe("Only messages after this ISO timestamp"),
    type: z
      .enum(["instruction", "status", "question", "response", "alert", "note"])
      .optional()
      .describe("Filter by message type"),
  },
  async ({ agent_name, unread_only, since, type }) => {
    const msgs = await store.getMessages(agent_name, {
      unreadOnly: unread_only,
      since,
      type,
    });

    if (msgs.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No messages found.",
          },
        ],
      };
    }

    const formatted = msgs
      .map(
        (m) =>
          `[${m.priority.toUpperCase()}] ${m.from} → ${m.to} (${m.type}) @ ${m.timestamp}\n${m.content}`
      )
      .join("\n\n---\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `${msgs.length} message(s):\n\n${formatted}`,
        },
      ],
    };
  }
);

// --- Tool: poll ---
server.tool(
  "poll",
  "Check for new instructions or messages. Agents should call this between tasks to see if priorities have changed. Returns unread messages addressed to this agent.",
  {
    agent_name: z.string().describe("The polling agent's name"),
  },
  async ({ agent_name }) => {
    const msgs = await store.getMessages(agent_name, { unreadOnly: true });
    const agent = await store.getAgent(agent_name);

    if (msgs.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `No new messages for ${agent_name}. Continue with current tasks.${agent ? `\nCurrent status: ${agent.status} | Task: ${agent.current_task}` : ""}`,
          },
        ],
      };
    }

    // Separate instructions from other messages
    const instructions = msgs.filter((m) => m.type === "instruction");
    const alerts = msgs.filter((m) => m.type === "alert");
    const others = msgs.filter(
      (m) => m.type !== "instruction" && m.type !== "alert"
    );

    let text = `${msgs.length} new message(s) for ${agent_name}:\n\n`;

    if (alerts.length > 0) {
      text += `## ALERTS (${alerts.length})\n`;
      for (const a of alerts) {
        text += `[${a.priority.toUpperCase()}] from ${a.from}: ${a.content}\n\n`;
      }
    }

    if (instructions.length > 0) {
      text += `## NEW INSTRUCTIONS (${instructions.length})\n`;
      for (const i of instructions) {
        text += `[${i.priority.toUpperCase()}] from ${i.from}: ${i.content}\n\n`;
      }
    }

    if (others.length > 0) {
      text += `## OTHER MESSAGES (${others.length})\n`;
      for (const o of others) {
        text += `[${o.type}] ${o.from}: ${o.content}\n\n`;
      }
    }

    return {
      content: [{ type: "text" as const, text }],
    };
  }
);

// --- Tool: update_status ---
server.tool(
  "update_status",
  "Update this agent's status and current task. Call this when starting a new task, getting blocked, or completing work.",
  {
    agent_name: z.string().describe("Agent name"),
    status: z
      .enum(["idle", "working", "blocked", "completed"])
      .describe("New status"),
    current_task: z
      .string()
      .optional()
      .describe("Description of current task"),
  },
  async ({ agent_name, status, current_task }) => {
    const agent = await store.updateAgentStatus(agent_name, status, current_task);
    if (!agent) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Agent '${agent_name}' not found. Register first with register_agent.`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: "text" as const,
          text: `Status updated: ${agent.name} → ${agent.status} | Task: ${agent.current_task}`,
        },
      ],
    };
  }
);

// --- Tool: list_agents ---
server.tool(
  "list_agents",
  "List all registered agents with their current status, role, and last seen time.",
  {},
  async () => {
    const agents = await store.listAgents();
    if (agents.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "No agents registered yet." },
        ],
      };
    }

    const lines = agents.map(
      (a) =>
        `${a.status === "working" ? "🔵" : a.status === "blocked" ? "🔴" : a.status === "completed" ? "🟢" : "⚪"} **${a.name}** (${a.role})\n  Status: ${a.status} | Task: ${a.current_task || "none"}\n  Workspace: ${a.workspace}\n  Last seen: ${a.last_seen}`
    );

    return {
      content: [
        {
          type: "text" as const,
          text: `${agents.length} agent(s) registered:\n\n${lines.join("\n\n")}`,
        },
      ],
    };
  }
);

// --- Tool: get_board ---
server.tool(
  "get_board",
  "Get the full orchestration board: all agents, their statuses, unread message counts, and recent messages. Use this for a birds-eye view.",
  {},
  async () => {
    const board = await store.getBoard();

    let text = "# Orchestration Board\n\n";

    // Agent status table
    text += "## Agents\n";
    text += "| Agent | Role | Status | Current Task | Unread |\n";
    text += "|-------|------|--------|--------------|--------|\n";
    for (const a of board.agents) {
      const unread = board.unread_counts[a.name] || 0;
      text += `| ${a.name} | ${a.role} | ${a.status} | ${a.current_task || "-"} | ${unread} |\n`;
    }

    // Recent messages
    text += "\n## Recent Messages (last 20)\n";
    for (const m of board.recent_messages.slice(-10)) {
      text += `\n**${m.from} → ${m.to}** [${m.type}] @ ${m.timestamp}\n${m.content.substring(0, 200)}${m.content.length > 200 ? "..." : ""}\n`;
    }

    return {
      content: [{ type: "text" as const, text }],
    };
  }
);

// --- Tool: get_thread ---
server.tool(
  "get_thread",
  "Get all messages in a conversation thread by thread ID.",
  {
    thread_id: z.string().describe("The thread ID to retrieve"),
  },
  async ({ thread_id }) => {
    const msgs = await store.getThread(thread_id);
    if (msgs.length === 0) {
      return {
        content: [
          { type: "text" as const, text: `No messages found for thread ${thread_id}.` },
        ],
      };
    }

    const formatted = msgs
      .map(
        (m) => `**${m.from} → ${m.to}** (${m.type}) @ ${m.timestamp}\n${m.content}`
      )
      .join("\n\n---\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `Thread ${thread_id} (${msgs.length} messages):\n\n${formatted}`,
        },
      ],
    };
  }
);

// --- Start ---

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("aichat MCP server error:", err);
  process.exit(1);
});
