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
export declare class MessageStore {
    private data;
    private filePath;
    constructor(workspace: string);
    private load;
    private save;
    registerAgent(name: string, role: string, workspace: string, currentTask?: string): Agent;
    updateAgentStatus(name: string, status: Agent["status"], currentTask?: string): Agent | null;
    listAgents(): Agent[];
    getAgent(name: string): Agent | null;
    sendMessage(from: string, to: string, type: Message["type"], content: string, priority?: Message["priority"], threadId?: string): Message;
    private appendToMarkdown;
    getMessages(agentName: string, opts?: {
        unreadOnly?: boolean;
        since?: string;
        type?: Message["type"];
    }): Message[];
    getThread(threadId: string): Message[];
    getBoard(): {
        agents: Agent[];
        unread_counts: Record<string, number>;
        recent_messages: Message[];
    };
}
//# sourceMappingURL=store.d.ts.map