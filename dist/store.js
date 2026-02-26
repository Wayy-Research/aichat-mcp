"use strict";
/**
 * HTTP-backed store for aichat messages and agent registry.
 *
 * Replaces the old JSON file store. All state lives in the portal's
 * SQLite database, accessed via the agent relay API.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageStore = void 0;
// --- HTTP Client Store ---
class MessageStore {
    portalUrl;
    relayKey;
    constructor(portalUrl, relayKey) {
        // Strip trailing slash
        this.portalUrl = portalUrl.replace(/\/+$/, "");
        this.relayKey = relayKey;
    }
    async request(method, path, body, params) {
        const url = new URL(`${this.portalUrl}/api/agents/relay${path}`);
        if (params) {
            for (const [k, v] of Object.entries(params)) {
                if (v !== undefined && v !== null && v !== "") {
                    url.searchParams.set(k, v);
                }
            }
        }
        const headers = {
            "x-agent-key": this.relayKey,
        };
        const init = { method, headers };
        if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
            headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(body);
        }
        const resp = await fetch(url.toString(), init);
        if (!resp.ok) {
            const text = await resp.text().catch(() => "");
            throw new Error(`Relay API ${method} ${path} returned ${resp.status}: ${text}`);
        }
        return resp.json();
    }
    // --- Agent Registry ---
    async registerAgent(name, role, workspace, currentTask = "") {
        const data = await this.request("POST", "/register", {
            name,
            role,
            workspace,
            current_task: currentTask,
        });
        return {
            name: data.name,
            role: data.role,
            workspace: data.workspace || "",
            status: data.status || "idle",
            current_task: data.current_task || "",
            registered_at: data.last_seen,
            last_seen: data.last_seen,
        };
    }
    async updateAgentStatus(name, status, currentTask) {
        try {
            await this.request("POST", "/status", {
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
        }
        catch {
            return null;
        }
    }
    async listAgents() {
        const data = await this.request("GET", "/agents");
        return data.map((a) => ({
            name: a.name,
            role: a.role || "",
            workspace: a.workspace || "",
            status: mapPresenceStatus(a.status) || "idle",
            current_task: a.current_task || "",
            registered_at: a.last_seen || "",
            last_seen: a.last_seen || "",
        }));
    }
    async getAgent(name) {
        const agents = await this.listAgents();
        return agents.find((a) => a.name === name) || null;
    }
    // --- Messages ---
    async sendMessage(from, to, type, content, priority = "medium", threadId, _references) {
        const data = await this.request("POST", "/message", {
            from_agent: from,
            to,
            content,
            message_type: type,
            priority,
            ...(threadId ? { thread_id: threadId } : {}),
        });
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
    async getMessages(agentName, opts) {
        const params = {
            agent: agentName,
            include_sent: "true",
            mark_read: "true",
        };
        if (opts?.unreadOnly)
            params.unread_only = "true";
        if (opts?.since)
            params.since = opts.since;
        if (opts?.type)
            params.msg_type = opts.type;
        const data = await this.request("GET", "/messages", undefined, params);
        return data.map(apiMsgToMessage);
    }
    async getThread(threadId) {
        const data = await this.request("GET", "/messages", undefined, { thread_id: threadId, limit: "100" });
        return data.map(apiMsgToMessage);
    }
    // --- Board ---
    async getBoard() {
        const data = await this.request("GET", "/board");
        return {
            agents: data.agents.map((a) => ({
                name: a.name,
                role: a.role || "",
                workspace: a.workspace || "",
                status: mapPresenceStatus(a.status) || "idle",
                current_task: a.current_task || "",
                registered_at: a.last_seen || "",
                last_seen: a.last_seen || "",
            })),
            unread_counts: data.unread_counts,
            recent_messages: data.recent_messages.map(apiMsgToMessage),
        };
    }
}
exports.MessageStore = MessageStore;
// --- Helpers ---
/** Map portal agent_presence status to MCP agent status. */
function mapPresenceStatus(s) {
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
function apiMsgToMessage(r) {
    return {
        id: r.id || "",
        from: r.from || "",
        to: r.to || "",
        type: r.type || "note",
        content: r.content || "",
        timestamp: r.timestamp || "",
        priority: r.priority || "medium",
        thread_id: r.thread_id || undefined,
        read_by: r.read_by || [],
    };
}
//# sourceMappingURL=store.js.map