import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// --- Types ---

export interface Message {
  id: string;
  from: string;
  to: string; // agent name or "all" for broadcast
  type: "instruction" | "status" | "question" | "response" | "alert" | "note";
  content: string;
  timestamp: string;
  priority: "low" | "medium" | "high" | "critical";
  thread_id?: string;
  read_by: string[];
}

export interface Agent {
  name: string;
  role: string;
  workspace: string;
  status: "idle" | "working" | "blocked" | "completed";
  current_task: string;
  registered_at: string;
  last_seen: string;
}

export interface StoreData {
  messages: Message[];
  agents: Record<string, Agent>;
  version: string;
}

// --- Store ---

export class MessageStore {
  private data: StoreData;
  private filePath: string;

  constructor(workspace: string) {
    const dir = path.join(workspace, ".wayy-ops");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.filePath = path.join(dir, "aichat-store.json");
    this.data = this.load();
  }

  private load(): StoreData {
    if (fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as StoreData;
    }
    return { messages: [], agents: {}, version: "1.0.0" };
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // --- Agent Registry ---

  registerAgent(
    name: string,
    role: string,
    workspace: string,
    currentTask: string = ""
  ): Agent {
    const now = new Date().toISOString();
    const agent: Agent = {
      name,
      role,
      workspace,
      status: "idle",
      current_task: currentTask,
      registered_at: this.data.agents[name]?.registered_at || now,
      last_seen: now,
    };
    this.data.agents[name] = agent;
    this.save();
    return agent;
  }

  updateAgentStatus(
    name: string,
    status: Agent["status"],
    currentTask?: string
  ): Agent | null {
    const agent = this.data.agents[name];
    if (!agent) return null;
    agent.status = status;
    agent.last_seen = new Date().toISOString();
    if (currentTask !== undefined) agent.current_task = currentTask;
    this.save();
    return agent;
  }

  listAgents(): Agent[] {
    return Object.values(this.data.agents);
  }

  getAgent(name: string): Agent | null {
    return this.data.agents[name] || null;
  }

  // --- Messages ---

  sendMessage(
    from: string,
    to: string,
    type: Message["type"],
    content: string,
    priority: Message["priority"] = "medium",
    threadId?: string
  ): Message {
    // Touch sender's last_seen
    if (this.data.agents[from]) {
      this.data.agents[from].last_seen = new Date().toISOString();
    }

    const msg: Message = {
      id: crypto.randomUUID(),
      from,
      to,
      type,
      content,
      timestamp: new Date().toISOString(),
      priority,
      thread_id: threadId,
      read_by: [],
    };
    this.data.messages.push(msg);
    this.save();

    // Also append to human-readable messages.md in recipient's workspace
    this.appendToMarkdown(msg);

    return msg;
  }

  private appendToMarkdown(msg: Message): void {
    // Find recipient workspace
    const recipient = this.data.agents[msg.to];
    if (recipient) {
      const mdPath = path.join(recipient.workspace, ".wayy-ops", "messages.md");
      if (fs.existsSync(mdPath)) {
        const entry = `\n### [${msg.from} → ${msg.to}] ${msg.timestamp}\nPriority: ${msg.priority} | Type: ${msg.type}\n${msg.content}\n---\n`;
        fs.appendFileSync(mdPath, entry, "utf-8");
      }
    }
    // Broadcast: append to all agent workspaces
    if (msg.to === "all") {
      for (const agent of Object.values(this.data.agents)) {
        const mdPath = path.join(agent.workspace, ".wayy-ops", "messages.md");
        if (fs.existsSync(mdPath)) {
          const entry = `\n### [${msg.from} → all] ${msg.timestamp}\nPriority: ${msg.priority} | Type: ${msg.type}\n${msg.content}\n---\n`;
          fs.appendFileSync(mdPath, entry, "utf-8");
        }
      }
    }
  }

  getMessages(
    agentName: string,
    opts?: { unreadOnly?: boolean; since?: string; type?: Message["type"] }
  ): Message[] {
    // Touch agent's last_seen
    if (this.data.agents[agentName]) {
      this.data.agents[agentName].last_seen = new Date().toISOString();
    }

    let msgs = this.data.messages.filter(
      (m) => m.to === agentName || m.to === "all" || m.from === agentName
    );

    if (opts?.unreadOnly) {
      msgs = msgs.filter((m) => !m.read_by.includes(agentName));
    }
    if (opts?.since) {
      msgs = msgs.filter((m) => m.timestamp > opts.since!);
    }
    if (opts?.type) {
      msgs = msgs.filter((m) => m.type === opts.type);
    }

    // Mark as read
    for (const m of msgs) {
      if (!m.read_by.includes(agentName)) {
        m.read_by.push(agentName);
      }
    }
    this.save();

    return msgs;
  }

  getThread(threadId: string): Message[] {
    return this.data.messages.filter((m) => m.thread_id === threadId);
  }

  // --- Board ---

  getBoard(): {
    agents: Agent[];
    unread_counts: Record<string, number>;
    recent_messages: Message[];
  } {
    const agents = this.listAgents();
    const unread: Record<string, number> = {};

    for (const agent of agents) {
      unread[agent.name] = this.data.messages.filter(
        (m) =>
          (m.to === agent.name || m.to === "all") &&
          !m.read_by.includes(agent.name)
      ).length;
    }

    const recent = this.data.messages.slice(-20);

    return { agents, unread_counts: unread, recent_messages: recent };
  }
}
