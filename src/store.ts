/**
 * HTTP-backed store for aichat messages and agent registry.
 *
 * Replaces the old JSON file store. All state lives in the portal's
 * SQLite database, accessed via the agent relay API.
 */

// --- Types ---

export interface MessageReference {
  seedvault_path?: string;
  notion_page_id?: string;
  file_path?: string;
}

export interface Message {
  id: string;
  from: string;
  to: string;
  type: "instruction" | "status" | "question" | "response" | "alert" | "note";
  content: string;
  timestamp: string;
  priority: "low" | "medium" | "high" | "critical";
  thread_id?: string;
  read_by: string[];
  references?: MessageReference[];
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

// --- HTTP Client Store ---

export class MessageStore {
  private portalUrl: string;
  private relayKey: string;

  constructor(portalUrl: string, relayKey: string) {
    // Strip trailing slash
    this.portalUrl = portalUrl.replace(/\/+$/, "");
    this.relayKey = relayKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${this.portalUrl}/api/agents/relay${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== "") {
          url.searchParams.set(k, v);
        }
      }
    }

    const headers: Record<string, string> = {
      "x-agent-key": this.relayKey,
    };

    const init: RequestInit = { method, headers };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    const resp = await fetch(url.toString(), init);
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Relay API ${method} ${path} returned ${resp.status}: ${text}`);
    }
    return resp.json() as Promise<T>;
  }

  // --- Agent Registry ---

  async registerAgent(
    name: string,
    role: string,
    workspace: string,
    currentTask: string = ""
  ): Promise<Agent> {
    const data = await this.request<Record<string, string>>("POST", "/register", {
      name,
      role,
      workspace,
      current_task: currentTask,
    });
    return {
      name: data.name,
      role: data.role,
      workspace: data.workspace || "",
      status: (data.status as Agent["status"]) || "idle",
      current_task: data.current_task || "",
      registered_at: data.last_seen,
      last_seen: data.last_seen,
    };
  }

  async updateAgentStatus(
    name: string,
    status: Agent["status"],
    currentTask?: string
  ): Promise<Agent | null> {
    try {
      await this.request<Record<string, string>>("POST", "/status", {
        agent_name: name,
        status,
        ...(currentTask !== undefined ? { current_task: currentTask } : {}),
      });
      // Return a synthetic agent object (status endpoint doesn't return full agent)
      return {
        name,
        role: "",
        workspace: "",
        status,
        current_task: currentTask || "",
        registered_at: "",
        last_seen: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  async listAgents(): Promise<Agent[]> {
    const data = await this.request<Array<Record<string, string>>>("GET", "/agents");
    return data.map((a) => ({
      name: a.name,
      role: a.role || "",
      workspace: a.workspace || "",
      status: (mapPresenceStatus(a.status) as Agent["status"]) || "idle",
      current_task: a.current_task || "",
      registered_at: a.last_seen || "",
      last_seen: a.last_seen || "",
    }));
  }

  async getAgent(name: string): Promise<Agent | null> {
    const agents = await this.listAgents();
    return agents.find((a) => a.name === name) || null;
  }

  // --- Messages ---

  async sendMessage(
    from: string,
    to: string,
    type: Message["type"],
    content: string,
    priority: Message["priority"] = "medium",
    threadId?: string,
    _references?: MessageReference[]
  ): Promise<Message> {
    const data = await this.request<{ status: string; id: string }>(
      "POST",
      "/message",
      {
        from_agent: from,
        to,
        content,
        message_type: type,
        priority,
        ...(threadId ? { thread_id: threadId } : {}),
      }
    );
    return {
      id: data.id,
      from,
      to,
      type,
      content,
      timestamp: new Date().toISOString(),
      priority,
      thread_id: threadId,
      read_by: [],
    };
  }

  async getMessages(
    agentName: string,
    opts?: {
      unreadOnly?: boolean;
      since?: string;
      type?: Message["type"];
    }
  ): Promise<Message[]> {
    const params: Record<string, string> = {
      agent: agentName,
      include_sent: "true",
      mark_read: "true",
    };
    if (opts?.unreadOnly) params.unread_only = "true";
    if (opts?.since) params.since = opts.since;
    if (opts?.type) params.msg_type = opts.type;

    const data = await this.request<Array<Record<string, unknown>>>(
      "GET",
      "/messages",
      undefined,
      params
    );

    return data.map(apiMsgToMessage);
  }

  async getThread(threadId: string): Promise<Message[]> {
    const data = await this.request<Array<Record<string, unknown>>>(
      "GET",
      "/messages",
      undefined,
      { thread_id: threadId, limit: "100" }
    );
    return data.map(apiMsgToMessage);
  }

  // --- Board ---

  async getBoard(): Promise<{
    agents: Agent[];
    unread_counts: Record<string, number>;
    recent_messages: Message[];
  }> {
    const data = await this.request<{
      agents: Array<Record<string, string>>;
      unread_counts: Record<string, number>;
      recent_messages: Array<Record<string, unknown>>;
    }>("GET", "/board");

    return {
      agents: data.agents.map((a) => ({
        name: a.name,
        role: a.role || "",
        workspace: a.workspace || "",
        status: (mapPresenceStatus(a.status) as Agent["status"]) || "idle",
        current_task: a.current_task || "",
        registered_at: a.last_seen || "",
        last_seen: a.last_seen || "",
      })),
      unread_counts: data.unread_counts,
      recent_messages: data.recent_messages.map(apiMsgToMessage),
    };
  }
}

// --- Helpers ---

/** Map portal agent_presence status to MCP agent status. */
function mapPresenceStatus(
  s: string
): "idle" | "working" | "blocked" | "completed" {
  switch (s) {
    case "working":
      return "working";
    case "error":
      return "blocked";
    case "offline":
      return "idle";
    case "available":
    default:
      return "idle";
  }
}

/** Convert a relay API message dict to our Message interface. */
function apiMsgToMessage(r: Record<string, unknown>): Message {
  return {
    id: (r.id as string) || "",
    from: (r.from as string) || "",
    to: (r.to as string) || "",
    type: (r.type as Message["type"]) || "note",
    content: (r.content as string) || "",
    timestamp: (r.timestamp as string) || "",
    priority: (r.priority as Message["priority"]) || "medium",
    thread_id: (r.thread_id as string) || undefined,
    read_by: (r.read_by as string[]) || [],
  };
}
