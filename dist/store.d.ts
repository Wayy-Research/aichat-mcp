/**
 * HTTP-backed store for aichat messages and agent registry.
 *
 * Replaces the old JSON file store. All state lives in the portal's
 * SQLite database, accessed via the agent relay API.
 */
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
export declare class MessageStore {
    private portalUrl;
    private relayKey;
    constructor(portalUrl: string, relayKey: string);
    private request;
    registerAgent(name: string, role: string, workspace: string, currentTask?: string): Promise<Agent>;
    updateAgentStatus(name: string, status: Agent["status"], currentTask?: string): Promise<Agent | null>;
    listAgents(): Promise<Agent[]>;
    getAgent(name: string): Promise<Agent | null>;
    sendMessage(from: string, to: string, type: Message["type"], content: string, priority?: Message["priority"], threadId?: string, _references?: MessageReference[]): Promise<Message>;
    getMessages(agentName: string, opts?: {
        unreadOnly?: boolean;
        since?: string;
        type?: Message["type"];
    }): Promise<Message[]>;
    getThread(threadId: string): Promise<Message[]>;
    getBoard(): Promise<{
        agents: Agent[];
        unread_counts: Record<string, number>;
        recent_messages: Message[];
    }>;
}
//# sourceMappingURL=store.d.ts.map