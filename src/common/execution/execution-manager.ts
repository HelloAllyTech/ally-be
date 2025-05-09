import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

interface ExecutionContext {
  id: string;
  startTime: string;
  origin?: string;
  userId?: string;
  role?: string;
  tenantId?: string;
  path?: string;
}

export class ExecutionManager {
  private static storage = new AsyncLocalStorage<ExecutionContext>();

  static runWithContext<T>(fn: () => T, path: string): T {
    return this.storage.run(
      {
        id: randomUUID(),
        startTime: new Date().toISOString(),
        path,
      },
      fn,
    );
  }

  static setAuthContext(userId: string, role: string, tenantId: string): void {
    const context = this.storage.getStore();
    if (context) {
      context.userId = userId;
      context.role = role;
      context.tenantId = tenantId;
    }
  }

  static getCurrentContext(): ExecutionContext | undefined {
    return this.storage.getStore();
  }

  static getUserId(): string | undefined {
    return this.storage.getStore()?.userId;
  }

  static getRole(): string | undefined {
    return this.storage.getStore()?.role;
  }

  static getTenantId(): string | undefined {
    return this.storage.getStore()?.tenantId;
  }

  static getPath(): string | undefined {
    return this.storage.getStore()?.path;
  }

  static getExecutionId(): string | undefined {
    return this.storage.getStore()?.id;
  }
}
