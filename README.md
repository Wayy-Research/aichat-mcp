# aichat-mcp

MCP server for inter-agent communication in multi-agent Claude Code workflows.

Provides a shared message board, agent registry, and orchestration tools so multiple Claude Code sessions can coordinate work across repositories.

## Install

### From Claude Code (recommended)

```bash
# Install globally for all sessions
claude mcp add aichat -s user -- node /path/to/aichat/dist/index.js /path/to/workspace

# Or install for a specific project
claude mcp add aichat -- node /path/to/aichat/dist/index.js /path/to/workspace
```

### From npm (coming soon)

```bash
claude mcp add aichat -s user -- npx aichat-mcp /path/to/workspace
```

## Tools

| Tool | Description |
|------|-------------|
| `register_agent` | Register an agent with name, role, and workspace path |
| `send_message` | Send a message to another agent or broadcast to all |
| `read_messages` | Read messages addressed to this agent (marks as read) |
| `poll` | Check for new unread instructions — call between tasks |
| `update_status` | Update agent status (idle/working/blocked/completed) |
| `list_agents` | List all registered agents and their current state |
| `get_board` | Full orchestration board: agents, unread counts, recent messages |
| `get_thread` | Get all messages in a conversation thread |

## Protocol

### For Agents

When starting a session, agents should:

1. **Register**: Call `register_agent` with their name, role, and workspace
2. **Poll**: Call `poll` to check for instructions from the orchestrator
3. **Work**: Execute tasks, calling `update_status` when starting/finishing
4. **Report**: Call `send_message` to report results back to orchestrator
5. **Poll again**: Call `poll` between tasks to check for priority changes

### For the Orchestrator

The orchestrator manages all agents by:

1. **Monitor**: Call `get_board` for a birds-eye view of all agents
2. **Instruct**: Call `send_message` with `type: "instruction"` to direct agents
3. **Alert**: Call `send_message` with `type: "alert"` for urgent changes
4. **Coordinate**: Use `list_agents` to check who's blocked and redirect work

### Message Types

| Type | Use For |
|------|---------|
| `instruction` | Orchestrator → Agent task assignments |
| `status` | Agent → Orchestrator progress updates |
| `question` | Agent → Agent or Agent → Orchestrator questions |
| `response` | Replies to questions |
| `alert` | Urgent notifications (priority changes, blockers) |
| `note` | General notes, FYI messages |

### Priority Levels

| Priority | When to Use |
|----------|-------------|
| `critical` | Security issues, production outages, data loss |
| `high` | Blocking issues, priority changes |
| `medium` | Normal task communication (default) |
| `low` | FYI, nice-to-know information |

## Storage

Messages and agent state are persisted to `{workspace}/.wayy-ops/aichat-store.json`.

Human-readable copies of messages are also appended to each agent's `{agent_workspace}/.wayy-ops/messages.md` file for visibility.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Agent A     │     │  Agent B     │     │ Orchestrator │
│ (voxlex)     │     │ (wayyFin)    │     │   (ops)      │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       └────────────────────┴────────────────────┘
                            │
                    ┌───────▼────────┐
                    │  aichat MCP    │
                    │  Server        │
                    │                │
                    │  - Messages[]  │
                    │  - Agents{}    │
                    │  - Store.json  │
                    └────────────────┘
```

## Development

```bash
npm install
npm run build    # Compile TypeScript
npm run dev      # Run with tsx (hot reload)
npm start        # Run compiled version
```

## License

MIT — Wayy Research
