// =============================================================================
// HARNESS LAYER — Guardrails for Node Factory owners
// Defines what agents can touch, resource conflict detection, failure containment.
// =============================================================================

export type ResourceType = 'file' | 'wallet' | 'mcp' | 'network' | 'vault' | 'process';

export interface PermissionRule {
  resource: ResourceType;
  paths?: string[];       // e.g. ["/home/mauricio/vms/"]
  actions: ('read' | 'write' | 'execute' | 'delete')[];
}

export interface HarnessConfig {
  name: string;
  allowed: PermissionRule[];
  denied: PermissionRule[];
  maxConcurrentTasks: number;
  maxMemoryMb: number;
  timeoutMs: number;
}

export class HarnessLayer {
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
  }

  /**
   * Check if an action on a resource is permitted.
   */
  check(action: string, resource: ResourceType, path?: string): { allowed: boolean; reason?: string } {
    // Denied takes precedence
    for (const rule of this.config.denied) {
      if (rule.resource === resource) {
        if (!rule.paths || !path || rule.paths.some((p) => path.startsWith(p))) {
          return { allowed: false, reason: `Denied by harness "${this.config.name}": ${action} on ${resource}${path ? ` (${path})` : ''}` };
        }
      }
    }

    for (const rule of this.config.allowed) {
      if (rule.resource === resource && rule.actions.includes(action as any)) {
        if (!rule.paths || !path || rule.paths.some((p) => path.startsWith(p))) {
          return { allowed: true };
        }
      }
    }

    return { allowed: false, reason: `No explicit permission for ${action} on ${resource}${path ? ` (${path})` : ''} in harness "${this.config.name}"` };
  }

  /**
   * Detect resource conflicts between parallel tasks.
   */
  detectConflicts(tasks: { id: string; resource: ResourceType; path?: string; action: string }[]): string[] {
    const conflicts: string[] = [];
    const writes = tasks.filter((t) => t.action === 'write' || t.action === 'delete');

    for (let i = 0; i < writes.length; i++) {
      for (let j = i + 1; j < writes.length; j++) {
        const a = writes[i];
        const b = writes[j];
        if (a.resource === b.resource && a.path && b.path && a.path === b.path) {
          conflicts.push(`Conflict: ${a.id} and ${b.id} both ${a.action} ${a.resource} at ${a.path}`);
        }
      }
    }

    return conflicts;
  }

  /**
   * Default Node Factory owner harness — safe defaults.
   */
  static defaultNodeFactoryHarness(): HarnessConfig {
    return {
      name: 'node-factory-owner',
      allowed: [
        { resource: 'file', actions: ['read', 'write'], paths: ['/home/mauricio/vms/', '/home/mauricio/backups/'] },
        { resource: 'vault', actions: ['read', 'write'] },
        { resource: 'mcp', actions: ['read', 'execute'] },
        { resource: 'network', actions: ['read'] },
      ],
      denied: [
        { resource: 'wallet', actions: ['write', 'delete'] },
        { resource: 'file', actions: ['write', 'delete'], paths: ['/etc/', '/usr/bin/', '/home/mauricio/.hermes/'] },
        { resource: 'process', actions: ['execute', 'delete'] },
      ],
      maxConcurrentTasks: 40,
      maxMemoryMb: 8192,
      timeoutMs: 30000,
    };
  }
}

export default HarnessLayer;
