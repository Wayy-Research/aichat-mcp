"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageStore = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
// --- Store ---
class MessageStore {
    data;
    filePath;
    constructor(workspace) {
        const dir = path.join(workspace, ".wayy-ops");
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        this.filePath = path.join(dir, "aichat-store.json");
        this.data = this.load();
    }
    load() {
        if (fs.existsSync(this.filePath)) {
            const raw = fs.readFileSync(this.filePath, "utf-8");
            return JSON.parse(raw);
        }
        return { messages: [], agents: {}, version: "1.0.0" };
    }
    save() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
    }
    // --- Agent Registry ---
    registerAgent(name, role, workspace, currentTask = "") {
        const now = new Date().toISOString();
        const agent = {
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
    updateAgentStatus(name, status, currentTask) {
        const agent = this.data.agents[name];
        if (!agent)
            return null;
        agent.status = status;
        agent.last_seen = new Date().toISOString();
        if (currentTask !== undefined)
            agent.current_task = currentTask;
        this.save();
        return agent;
    }
    listAgents() {
        return Object.values(this.data.agents);
    }
    getAgent(name) {
        return this.data.agents[name] || null;
    }
    // --- Messages ---
    sendMessage(from, to, type, content, priority = "medium", threadId) {
        // Touch sender's last_seen
        if (this.data.agents[from]) {
            this.data.agents[from].last_seen = new Date().toISOString();
        }
        const msg = {
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
    appendToMarkdown(msg) {
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
    getMessages(agentName, opts) {
        // Touch agent's last_seen
        if (this.data.agents[agentName]) {
            this.data.agents[agentName].last_seen = new Date().toISOString();
        }
        let msgs = this.data.messages.filter((m) => m.to === agentName || m.to === "all" || m.from === agentName);
        if (opts?.unreadOnly) {
            msgs = msgs.filter((m) => !m.read_by.includes(agentName));
        }
        if (opts?.since) {
            msgs = msgs.filter((m) => m.timestamp > opts.since);
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
    getThread(threadId) {
        return this.data.messages.filter((m) => m.thread_id === threadId);
    }
    // --- Board ---
    getBoard() {
        const agents = this.listAgents();
        const unread = {};
        for (const agent of agents) {
            unread[agent.name] = this.data.messages.filter((m) => (m.to === agent.name || m.to === "all") &&
                !m.read_by.includes(agent.name)).length;
        }
        const recent = this.data.messages.slice(-20);
        return { agents, unread_counts: unread, recent_messages: recent };
    }
}
exports.MessageStore = MessageStore;
//# sourceMappingURL=store.js.map