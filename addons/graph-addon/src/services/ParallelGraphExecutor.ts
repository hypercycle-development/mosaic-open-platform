// =============================================================================
// PARALLEL GRAPH EXECUTOR
// Fan-out validator tasks across Node Factory nodes, layered fan-in,
// silent failure detection — extracted from article analysis.
// =============================================================================

interface ExecutionNode {
  id: string;
  task: string;
  inputs: Record<string, any>;
  dependencies: string[];
}

interface ExecutionResult {
  nodeId: string;
  status: 'success' | 'failure' | 'timeout';
  output?: any;
  error?: string;
  durationMs: number;
}

interface FanOutConfig {
  batchSize: number;
  timeoutMs: number;
  retryCount: number;
}

const DEFAULT_CONFIG: FanOutConfig = {
  batchSize: 20,
  timeoutMs: 30000,
  retryCount: 2,
};

/**
 * Execute a graph of tasks in parallel where edges allow,
 * with layered fan-in to avoid context collapse.
 */
export class ParallelGraphExecutor {
  private config: FanOutConfig;

  constructor(config: Partial<FanOutConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fan out: run independent nodes in parallel batches.
   */
  async fanOut(nodes: ExecutionNode[]): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    const expectedCount = nodes.length;

    for (let i = 0; i < nodes.length; i += this.config.batchSize) {
      const batch = nodes.slice(i, i + this.config.batchSize);
      const batchPromises = batch.map((node) =>
        this.executeNode(node).catch((err): ExecutionResult => ({
          nodeId: node.id,
          status: 'failure',
          error: err?.message || String(err),
          durationMs: 0,
        }))
      );
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    // Silent node failure detection: verify count
    if (results.length !== expectedCount) {
      console.error(
        `[ParallelGraphExecutor] SILENT FAILURE: expected ${expectedCount} results, got ${results.length}`
      );
      const missingIds = nodes
        .map((n) => n.id)
        .filter((id) => !results.some((r) => r.nodeId === id));
      missingIds.forEach((id) =>
        results.push({
          nodeId: id,
          status: 'failure',
          error: 'Node vanished silently — result missing from fan-out',
          durationMs: 0,
        })
      );
    }

    return results;
  }

  /**
   * Layered fan-in: aggregate 1,000 outputs via batch summaries
   * to avoid context collapse.
   */
  async layeredFanIn(results: ExecutionResult[]): Promise<any> {
    if (results.length <= this.config.batchSize) {
      return this.summarizeBatch(results);
    }

    const batches: ExecutionResult[][] = [];
    for (let i = 0; i < results.length; i += this.config.batchSize) {
      batches.push(results.slice(i, i + this.config.batchSize));
    }

    const summaries = await Promise.all(
      batches.map((batch) => this.summarizeBatch(batch))
    );

    return this.consolidateSummaries(summaries);
  }

  private async executeNode(node: ExecutionNode): Promise<ExecutionResult> {
    const start = Date.now();
    // Simulate task execution (placeholder for actual Node Factory dispatch)
    await this.delay(this.config.timeoutMs / 3);
    const duration = Date.now() - start;

    return {
      nodeId: node.id,
      status: 'success',
      output: { task: node.task, inputs: node.inputs },
      durationMs: duration,
    };
  }

  private summarizeBatch(batch: ExecutionResult[]): any {
    const ok = batch.filter((r) => r.status === 'success');
    const fail = batch.filter((r) => r.status === 'failure');
    return {
      total: batch.length,
      success: ok.length,
      failure: fail.length,
      avgDurationMs: batch.reduce((s, r) => s + r.durationMs, 0) / batch.length,
      failures: fail.map((f) => ({ nodeId: f.nodeId, error: f.error })),
    };
  }

  private consolidateSummaries(summaries: any[]): any {
    const total = summaries.reduce((s, v) => s + v.total, 0);
    const success = summaries.reduce((s, v) => s + v.success, 0);
    const failure = summaries.reduce((s, v) => s + v.failure, 0);
    const avgDuration =
      summaries.reduce((s, v) => s + v.avgDurationMs, 0) / summaries.length;
    return { total, success, failure, avgDurationMs: avgDuration, batches: summaries.length };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default ParallelGraphExecutor;
