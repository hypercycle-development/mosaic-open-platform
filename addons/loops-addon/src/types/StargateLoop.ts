// =============================================================================
// STARGATE LOOP TYPES — General-Purpose Agent Loop Framework
//
// These loops are NOT tied to Midnight City. They are generic patterns that
// any Mosaic AI Agent can execute using data from Vault boxes, user inputs,
// or external networks.
//
// Principle: "Nodes are jobs, edges are dependencies."
// A loop is a cycle with mandatory convergence rules.
//
// The user creates loops in Stargate Graph. Mosaic AI Agents execute them.
// =============================================================================

export interface StargateLoop {
  id: string;
  name: string;
  description: string;
  trigger: LoopTrigger;
  nodes: LoopNode[];
  edges: LoopEdge[];
  convergence: LoopConvergence;
  testResults?: LoopTestResult[];
  status: LoopStatus;
  createdAt: string;
  updatedAt: string;
  vaultEntryId?: string; // reference to Mosaic Vault entry (if saved)
}

export interface LoopTrigger {
  type: "manual" | "timer" | "event" | "vault-change" | "mcp-signal";
  config: {
    /** Cron expression for timer triggers */
    cron?: string;
    /** Event name for event triggers */
    eventName?: string;
    /** Vault box ID for vault-change triggers */
    vaultBoxId?: string;
    /** Delay between iterations (ms) */
    intervalMs?: number;
  };
}

export interface LoopNode {
  id: string;
  type: LoopNodeType;
  label: string;
  description: string;
  config: Record<string, any>;
  /** Input contract — what this node expects */
  inputSchema: Record<string, any>;
  /** Output contract — what this node produces */
  outputSchema: Record<string, any>;
  estimatedMs?: number;
  isCheckpoint?: boolean;
}

export type LoopNodeType =
  | "agent-action"      // Execute action on a Mosaic AI Agent
  | "vault-read"        // Read from a Mosaic Vault box
  | "vault-write"       // Write result to Mosaic Vault (existing box)
  | "condition"         // Branch based on data
  | "delay"             // Wait N milliseconds
  | "parallel"          // Fan out to multiple nodes
  | "merge"             // Fan in — barrier
  | "verify"            // Assert a condition
  | "router"            // Route based on classification
  | "transform"         // Pure data transformation (zero cost)
  | "mcp-call"          // Call an MCP server tool
  | "notify"            // Send notification (toast, log, external)
  | "wait-for-input";   // Pause until user provides input

/** Enhanced config for mcp-call nodes — specifies server, tool, args, and data mapping */
export interface McpCallConfig {
  /** MCP server ID (from addonAPI.mcp.listServers) */
  serverId: string;
  /** Tool name within the MCP server (from addonAPI.mcp.listTools) */
  toolName: string;
  /** Static arguments passed to the tool */
  args?: Record<string, any>;
  /** Dynamic argument mapping: Vault data → tool args via {{...}} templates */
  argMapping?: Record<string, string>;
  /** Optional timeout in ms */
  timeoutMs?: number;
  /** Whether to retry on error */
  retryOnError?: boolean;
  /** Max retry attempts */
  maxRetries?: number;
}

export interface LoopEdge {
  id: string;
  source: string;
  target: string;
  type: LoopEdgeType;
  condition?: string;
  dataMapping?: Record<string, string>;
  isFeedback?: boolean;
}

export type LoopEdgeType =
  | "sequential"
  | "conditional"
  | "parallel"
  | "feedback"
  | "error"
  | "retry";

export interface LoopConvergence {
  maxIterations: number;
  dryRounds: number;
  timeoutSeconds: number;
  dedupeKey: string;
  backoff: "none" | "linear" | "exponential" | "fixed";
  fixedDelayMs?: number;
}

export interface LoopTestResult {
  runId: string;
  runAt: string;
  mode: "dry-run" | "live";
  iterations: number;
  dryRoundsHit: number;
  nodeOutcomes: LoopNodeOutcome[];
  edgeTraversals: LoopEdgeTraversal[];
  elapsedMs: number;
  converged: boolean;
  error?: string;
  summary: string;
  /** Phase B: per-node execution statistics */
  nodeStats?: Array<{
    nodeId: string;
    label: string;
    totalExecutions: number;
    avgElapsedMs: number;
    successRate: number;
  }>;
  /** Phase B: final state after live execution */
  state?: Record<string, any>;
  /** Phase B: verifier results for verify nodes */
  verifierResults?: Array<{
    nodeId: string;
    passed: boolean;
    score: number;
    verdicts: Array<{ lens: string; verdict: string; reason: string }>;
  }>;
}

export interface LoopNodeOutcome {
  nodeId: string;
  iteration: number;
  status: "ok" | "err" | "skipped" | "timeout" | "dry";
  input: Record<string, any>;
  output: Record<string, any>;
  elapsedMs: number;
}

export interface LoopEdgeTraversal {
  edgeId: string;
  iteration: number;
  timestamp: string;
  dataSnapshot: Record<string, any>;
}

export type LoopStatus = "draft" | "testing" | "tested" | "deployed" | "failed" | "disabled";

/** Runtime status for a loop execution — separate from design-time status */
export type LoopRunStatus = "running" | "completed" | "failed" | "paused";

/* ═════════════════════════════════════════════════════════════════════════════
   PRESET LOOPS — Generic patterns for Mosaic AI Agents
   ═════════════════════════════════════════════════════════════════════════════ */

/** PRESET 1: Knowledge Discovery Loop
 *  Read Vault → Query Agent → If incomplete → Expand search → Write back → Repeat
 *  Converges when agent returns "sufficient" 3 times in a row.
 */
export const PRESET_KNOWLEDGE_DISCOVERY: StargateLoop = {
  id: "loop-knowledge-discovery-v1",
  name: "Knowledge Discovery Loop",
  description: "Continuously read from Vault, ask agent to analyze, expand search if gaps found, write enriched knowledge back. Stops when agent reports 'sufficient'.",
  trigger: { type: "manual", config: {} },
  nodes: [
    {
      id: "node-read-vault",
      type: "vault-read",
      label: "Read Vault Box",
      description: "Read entries from a Mosaic Vault box",
      config: { boxName: "Research Notes", limit: 10 },
      inputSchema: { boxId: "string" },
      outputSchema: { entries: "array", count: "number" },
      estimatedMs: 500,
    },
    {
      id: "node-agent-analyze",
      type: "agent-action",
      label: "Agent Analyzes",
      description: "Ask Mosaic AI Agent to analyze entries and report completeness",
      config: { action: "analyze", prompt: "Analyze these entries for gaps. Report: {complete: boolean, gaps: string[], enriched: string}" },
      inputSchema: { entries: "array" },
      outputSchema: { complete: "boolean", gaps: "array", enriched: "string" },
      estimatedMs: 3000,
    },
    {
      id: "node-query-gbrain",
      type: "mcp-call",
      label: "Query Knowledge Graph",
      description: "Query gbrain MCP for related concepts and connections",
      config: {
        serverId: "gbrain",
        toolName: "query_knowledge",
        args: { limit: 5 },
        argMapping: { query: "{{entries[0].content}}" },
        timeoutMs: 10000,
      },
      inputSchema: { entries: "array" },
      outputSchema: { results: "array", concepts: "array" },
      estimatedMs: 3000,
    },
    {
      id: "node-check-complete",
      type: "condition",
      label: "Is Knowledge Complete?",
      description: "Branch based on agent completeness report and gbrain results",
      config: { field: "complete", operator: "===", value: true },
      inputSchema: { complete: "boolean", results: "array" },
      outputSchema: { result: "boolean" },
      estimatedMs: 100,
    },
    {
      id: "node-expand-search",
      type: "mcp-call",
      label: "Expand Search via Web",
      description: "Use hermes MCP to search web for missing information",
      config: {
        serverId: "hermes-tools",
        toolName: "hermes_web_search",
        argMapping: { query: "{{gaps[0]}}" },
        timeoutMs: 15000,
      },
      inputSchema: { gaps: "array" },
      outputSchema: { findings: "array", sources: "array" },
      estimatedMs: 8000,
    },
    {
      id: "node-write-vault",
      type: "vault-write",
      label: "Write Enriched Knowledge",
      description: "Write combined original + enriched data back to Vault",
      config: { boxName: "Research Notes", entryLabel: "enriched:{{timestamp}}" },
      inputSchema: { enriched: "string", findings: "array" },
      outputSchema: { saved: "boolean", entryId: "string" },
      estimatedMs: 500,
    },
    {
      id: "node-verify",
      type: "verify",
      label: "Verify Quality",
      description: "Assert enriched data meets quality threshold",
      config: { assert: "findings.length > 0", onFail: "retry" },
      inputSchema: { findings: "array" },
      outputSchema: { passed: "boolean" },
      estimatedMs: 100,
      isCheckpoint: true,
    },
  ],
  edges: [
    { id: "e-read-analyze", source: "node-read-vault", target: "node-agent-analyze", type: "sequential" },
    { id: "e-analyze-gbrain", source: "node-agent-analyze", target: "node-query-gbrain", type: "sequential" },
    { id: "e-gbrain-check", source: "node-query-gbrain", target: "node-check-complete", type: "sequential" },
    { id: "e-check-expand", source: "node-check-complete", target: "node-expand-search", type: "conditional", condition: "result === false" },
    { id: "e-expand-write", source: "node-expand-search", target: "node-write-vault", type: "sequential" },
    { id: "e-write-verify", source: "node-write-vault", target: "node-verify", type: "sequential" },
    // FEEDBACK: if incomplete, loop back to read (with dedupe)
    { id: "e-feedback", source: "node-verify", target: "node-read-vault", type: "feedback", isFeedback: true },
  ],
  convergence: {
    maxIterations: 10,
    dryRounds: 2,
    timeoutSeconds: 120,
    dedupeKey: "entryId",
    backoff: "linear",
  },
  status: "draft",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** PRESET 2: Agent Skill Training Loop
 *  Execute skill → Evaluate → If failed → Read Vault for fix → Apply fix → Retry → Repeat
 *  Converges when skill succeeds 3 times consecutively.
 */
export const PRESET_AGENT_SKILL_TRAINING: StargateLoop = {
  id: "loop-skill-training-v1",
  name: "Agent Skill Training Loop",
  description: "Test an agent skill, evaluate outcome, read correction from Vault if failed, retry with fix. Converges on 3 consecutive successes.",
  trigger: { type: "manual", config: {} },
  nodes: [
    {
      id: "node-execute-skill",
      type: "agent-action",
      label: "Execute Skill",
      description: "Ask Mosaic AI Agent to execute a specific skill",
      config: { action: "execute_skill", skillName: "data-analysis", params: {} },
      inputSchema: { skillName: "string", params: "object" },
      outputSchema: { result: "any", status: "string", error: "string" },
      estimatedMs: 5000,
    },
    {
      id: "node-evaluate",
      type: "condition",
      label: "Did Skill Succeed?",
      description: "Check if agent reported success",
      config: { field: "status", operator: "===", value: "success" },
      inputSchema: { status: "string" },
      outputSchema: { success: "boolean", error: "string" },
      estimatedMs: 100,
    },
    {
      id: "node-read-fix",
      type: "vault-read",
      label: "Read Fix from Vault",
      description: "Look up correction pattern in Vault 'Skill Corrections' box",
      config: { boxName: "Skill Corrections", filter: "error-type:{{error}}" },
      inputSchema: { error: "string" },
      outputSchema: { corrections: "array", bestMatch: "object" },
      estimatedMs: 500,
    },
    {
      id: "node-apply-fix",
      type: "transform",
      label: "Apply Fix",
      description: "Transform skill params using correction pattern (pure JS, zero cost)",
      config: { transform: "merge(params, bestMatch.fix)" },
      inputSchema: { params: "object", bestMatch: "object" },
      outputSchema: { fixedParams: "object" },
      estimatedMs: 0,
    },
    {
      id: "node-retry",
      type: "agent-action",
      label: "Retry with Fix",
      description: "Re-execute skill with corrected parameters",
      config: { action: "execute_skill", useFixedParams: true },
      inputSchema: { fixedParams: "object" },
      outputSchema: { result: "any", status: "string" },
      estimatedMs: 5000,
    },
    {
      id: "node-verify",
      type: "verify",
      label: "Verify 3 Successes",
      description: "Only pass when skill succeeded 3 times in a row",
      config: { assert: "successCount >= 3", onFail: "retry" },
      inputSchema: { successCount: "number" },
      outputSchema: { passed: "boolean" },
      estimatedMs: 100,
      isCheckpoint: true,
    },
  ],
  edges: [
    { id: "e-exec-eval", source: "node-execute-skill", target: "node-evaluate", type: "sequential" },
    { id: "e-eval-read", source: "node-evaluate", target: "node-read-fix", type: "conditional", condition: "success === false" },
    { id: "e-read-apply", source: "node-read-fix", target: "node-apply-fix", type: "sequential" },
    { id: "e-apply-retry", source: "node-apply-fix", target: "node-retry", type: "sequential" },
    { id: "e-retry-verify", source: "node-retry", target: "node-verify", type: "sequential" },
    // FEEDBACK: keep looping until 3 successes
    { id: "e-feedback", source: "node-verify", target: "node-execute-skill", type: "feedback", isFeedback: true },
  ],
  convergence: {
    maxIterations: 20,
    dryRounds: 3,
    timeoutSeconds: 300,
    dedupeKey: "error+fixedParams",
    backoff: "exponential",
  },
  status: "draft",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** PRESET 3: Multi-Agent Orchestration Loop
 *  Read task → Route to appropriate agent → Execute → Collect → Merge → If incomplete → Re-route → Repeat
 *  Converges when all sub-tasks report done.
 */
export const PRESET_MULTI_AGENT_ORCHESTRATION: StargateLoop = {
  id: "loop-multi-agent-v1",
  name: "Multi-Agent Orchestration Loop",
  description: "Read a complex task from Vault, fan out to multiple Mosaic AI Agents based on specialization, collect results, merge, and re-route incomplete sub-tasks. Converges when all branches report done.",
  trigger: { type: "vault-change", config: { vaultBoxId: "incoming-tasks" } },
  nodes: [
    {
      id: "node-read-task",
      type: "vault-read",
      label: "Read Task",
      description: "Read next pending task from Vault",
      config: { boxName: "incoming-tasks", status: "pending" },
      inputSchema: {},
      outputSchema: { taskId: "string", description: "string", subTasks: "array" },
      estimatedMs: 500,
    },
    {
      id: "node-router",
      type: "router",
      label: "Route to Agents",
      description: "Classify sub-tasks and route to appropriate agent specializations",
      config: { routes: ["research-agent", "code-agent", "review-agent"] },
      inputSchema: { subTasks: "array" },
      outputSchema: { assignments: "array" },
      estimatedMs: 500,
    },
    {
      id: "node-parallel-exec",
      type: "parallel",
      label: "Execute in Parallel",
      description: "Fan out: all assigned agents work simultaneously",
      config: { agentType: "mcp-tool", toolName: "agent:execute" },
      inputSchema: { assignments: "array" },
      outputSchema: { branchResults: "array" },
      estimatedMs: 8000,
    },
    {
      id: "node-merge",
      type: "merge",
      label: "Merge Results",
      description: "Fan in: wait for all branches, combine outputs",
      config: { strategy: "concatenate" },
      inputSchema: { branchResults: "array" },
      outputSchema: { merged: "object", completedCount: "number", totalCount: "number" },
      estimatedMs: 100,
    },
    {
      id: "node-check-done",
      type: "condition",
      label: "All Done?",
      description: "Check if all sub-tasks completed",
      config: { field: "completedCount", operator: "===", valueRef: "totalCount" },
      inputSchema: { completedCount: "number", totalCount: "number" },
      outputSchema: { allDone: "boolean" },
      estimatedMs: 100,
    },
    {
      id: "node-write-result",
      type: "vault-write",
      label: "Write Final Result",
      description: "Store merged result in Vault 'completed-tasks' box",
      config: { boxName: "completed-tasks", entryLabel: "task:{{taskId}}" },
      inputSchema: { taskId: "string", merged: "object" },
      outputSchema: { saved: "boolean" },
      estimatedMs: 500,
    },
    {
      id: "node-notify",
      type: "notify",
      label: "Notify User",
      description: "Send notification that task is complete",
      config: { channel: "toast", message: "Task {{taskId}} completed by {{completedCount}} agents" },
      inputSchema: { taskId: "string", completedCount: "number" },
      outputSchema: { sent: "boolean" },
      estimatedMs: 100,
    },
  ],
  edges: [
    { id: "e-read-route", source: "node-read-task", target: "node-router", type: "sequential" },
    { id: "e-route-parallel", source: "node-router", target: "node-parallel-exec", type: "sequential" },
    { id: "e-parallel-merge", source: "node-parallel-exec", target: "node-merge", type: "sequential" },
    { id: "e-merge-check", source: "node-merge", target: "node-check-done", type: "sequential" },
    { id: "e-check-write", source: "node-check-done", target: "node-write-result", type: "conditional", condition: "allDone === true" },
    { id: "e-write-notify", source: "node-write-result", target: "node-notify", type: "sequential" },
    // FEEDBACK: if not all done, re-route incomplete sub-tasks
    { id: "e-feedback", source: "node-check-done", target: "node-router", type: "feedback", isFeedback: true },
  ],
  convergence: {
    maxIterations: 10,
    dryRounds: 1,
    timeoutSeconds: 600,
    dedupeKey: "taskId+completedCount",
    backoff: "fixed",
    fixedDelayMs: 5000,
  },
  status: "draft",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// =============================================================================
// TEACHING PRESET: Byron → Midnight City Auto-Work
// =============================================================================
// What this teaches: How to wire an agent (Byron) to control an external
// dashboard (Midnight City) via MCP-style IPC calls.
//
// FLOW:
// 1. Byron reads Vault "midnight-config" box (gets agentId, profession, baseImage)
// 2. Byron uses agent-action to decide WHICH Midnight City actions to perform
// 3. MCP node calls midnight-city:connect with agentId
// 4. MCP node calls midnight-city:autoReply to activate auto-work
// 5. Condition checks if auto-work is running (status === "online")
// 6. If failed, agent-action node retries with fallback strategy
// 7. Vault-write stores the session log for later review
// 8. Notify confirms "Auto-work active" or "Connection failed"
//
// NODE TYPES USED: vault-read, agent-action, mcp-call, condition, vault-write, notify
// IPC CALLS USED: midnight:connect, midnight:autoReply, midnight:getStatus
// AGENT: Byron (agent-1781120575138)
// =============================================================================

export const PRESET_BYRON_MIDNIGHT_AUTOWORK: StargateLoop = {
  id: "loop-byron-midnight-autowork-v1",
  name: "🌙 Byron → Midnight Auto-Work",
  description: "Teaching example: Byron reads Midnight config from Vault, connects to Midnight City, activates auto-reply auto-work, verifies status, logs result. Shows how agent nodes + MCP nodes + condition gates work together.",
  trigger: { type: "manual", config: {} },
  nodes: [
    {
      id: "node-read-midnight-config",
      type: "vault-read",
      label: "📖 Read Midnight Config",
      description: "Read agentId, profession, baseImage from Vault 'midnight-config' box",
      config: { boxName: "midnight-config" },
      inputSchema: {},
      outputSchema: { agentId: "string", profession: "string", baseImage: "string", apiKey: "string" },
      estimatedMs: 500,
    },
    {
      id: "node-byron-decide",
      type: "agent-action",
      label: "🤖 Byron Decides Strategy",
      description: "Byron reads config and decides: connect first, then activate auto-reply, then verify",
      config: {
        agentId: "agent-1781120575138",
        prompt: "You are controlling Midnight City dashboard. Config: {{config}}. Strategy: 1) Connect agent, 2) Activate auto-reply, 3) Verify status. Respond ONLY with a JSON object: {action: 'connect'|'autoReply'|'verify', agentId: string, profession: string}",
      },
      inputSchema: { config: "object" },
      outputSchema: { action: "string", agentId: "string", profession: "string" },
      estimatedMs: 3000,
    },
    {
      id: "node-midnight-connect",
      type: "mcp-call",
      label: "🔗 Connect to Midnight",
      description: "Calls IPC midnight:connect with agentId from config",
      config: {
        serverId: "midnight-mcp",
        toolName: "midnight:connect",
        args: {},
        argMapping: { agentId: "{{node-read-midnight-config.output.agentId}}" },
      },
      inputSchema: { agentId: "string" },
      outputSchema: { success: "boolean", status: "string", sessionId: "string" },
      estimatedMs: 2000,
    },
    {
      id: "node-activate-autowork",
      type: "mcp-call",
      label: "⚡ Enable Auto-Work",
      description: "Calls IPC midnight:setAutoWork(true) to enable the background auto-mine loop",
      config: {
        serverId: "midnight-mcp",
        toolName: "midnight:setAutoWork",
        args: { enabled: true },
      },
      inputSchema: {},
      outputSchema: { success: "boolean", autoMine: "boolean" },
      estimatedMs: 500,
    },
    {
      id: "node-verify-status",
      type: "mcp-call",
      label: "✅ Verify Status",
      description: "Calls IPC midnight:getStatus to confirm auto-work is running",
      config: {
        serverId: "midnight-mcp",
        toolName: "midnight:getStatus",
        args: {},
      },
      inputSchema: {},
      outputSchema: { connected: "boolean", autoReplyEnabled: "boolean", agentId: "string" },
      estimatedMs: 1000,
    },
    {
      id: "node-check-online",
      type: "condition",
      label: "🟢 Online?",
      description: "Gate: only proceed if Midnight reports connected + autoReply enabled",
      config: { field: "connected", operator: "===", value: true },
      inputSchema: { connected: "boolean", autoReplyEnabled: "boolean" },
      outputSchema: { isOnline: "boolean" },
      estimatedMs: 100,
    },
    {
      id: "node-byron-retry",
      type: "agent-action",
      label: "🔁 Byron Retry",
      description: "If connection failed, Byron retries with alternate baseImage or suggests manual intervention",
      config: {
        agentId: "agent-1781120575138",
        prompt: "Midnight City connection failed. Config: {{config}}. Previous result: {{result}}. Suggest retry strategy or alert user.",
      },
      inputSchema: { config: "object", result: "object" },
      outputSchema: { retry: "boolean", reason: "string", suggestion: "string" },
      estimatedMs: 3000,
    },
    {
      id: "node-log-session",
      type: "vault-write",
      label: "📝 Log Session",
      description: "Store session result to Vault 'midnight-sessions' box for audit trail",
      config: {
        boxName: "midnight-sessions",
        entryLabel: "session:{{timestamp}}",
      },
      inputSchema: { result: "object", timestamp: "number" },
      outputSchema: { saved: "boolean" },
      estimatedMs: 500,
    },
    {
      id: "node-notify-result",
      type: "notify",
      label: "🔔 Notify User",
      description: "Show toast: 'Auto-work active' or 'Connection failed — see logs'",
      config: {
        channel: "toast",
        message: "Midnight City Auto-Work: {{status}} — Session {{sessionId}}",
      },
      inputSchema: { status: "string", sessionId: "string" },
      outputSchema: { sent: "boolean" },
      estimatedMs: 100,
    },
  ],
  edges: [
    // Main flow: config → decide → connect → setAutoWork → verify → check → log → notify
    { id: "e1", source: "node-read-midnight-config", target: "node-byron-decide", type: "sequential" },
    { id: "e2", source: "node-byron-decide", target: "node-midnight-connect", type: "sequential" },
    { id: "e3", source: "node-midnight-connect", target: "node-activate-autowork", type: "sequential" },
    { id: "e4", source: "node-activate-autowork", target: "node-verify-status", type: "sequential" },
    { id: "e5", source: "node-verify-status", target: "node-check-online", type: "sequential" },
    { id: "e6", source: "node-check-online", target: "node-log-session", type: "conditional", condition: "isOnline === true" },
    { id: "e7", source: "node-log-session", target: "node-notify-result", type: "sequential" },
    // Error path: if check fails, go to retry → back to connect
    { id: "e-err", source: "node-check-online", target: "node-byron-retry", type: "error", condition: "isOnline === false" },
    { id: "e-retry", source: "node-byron-retry", target: "node-midnight-connect", type: "feedback", isFeedback: true },
  ],
  convergence: {
    maxIterations: 5,
    dryRounds: 2,
    timeoutSeconds: 120,
    dedupeKey: "sessionId",
    backoff: "exponential",
    fixedDelayMs: 3000,
  },
  status: "draft",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** Export all presets for UI */
export const LOOP_PRESETS: StargateLoop[] = [
  PRESET_KNOWLEDGE_DISCOVERY,
  PRESET_AGENT_SKILL_TRAINING,
  PRESET_MULTI_AGENT_ORCHESTRATION,
  PRESET_BYRON_MIDNIGHT_AUTOWORK,
];
