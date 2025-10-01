import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';
import { Request } from 'express';

interface ExecutionContext {
  id: string;
  startTime: string;
  origin?: string;
  userId?: string;
  role?: string;
  tenantId?: string;
  path?: string;
  ip?: string;
  method?: string;
  originalUrl?: string;
  headers?: { [key: string]: string | string[] | undefined } | undefined;
}

export class ExecutionManager {
  private static storage = new AsyncLocalStorage<ExecutionContext>();

  static runWithContext<T>(fn: () => T, req?: Request | { path: string }): T {
    const contextData = {
      id: randomUUID(),
      startTime: new Date().toISOString(),
      ...(req && {
        path: req.path,
        headers: 'headers' in req ? req.headers : {},
        ip: 'ip' in req ? req.ip : undefined,
        method: 'method' in req ? req.method : undefined,
        originalUrl: 'originalUrl' in req ? req.originalUrl : undefined,
      }),
    };
    return this.storage.run(contextData, fn);
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

  static getRequestMetadata():
    | {
        ip?: string;
        method?: string;
        originalUrl?: string;
        headers?: { [key: string]: string | string[] | undefined };
      }
    | undefined {
    const context = this.storage.getStore();
    if (!context) return undefined;

    return {
      ip: context.ip,
      method: context.method,
      originalUrl: context.originalUrl,
      headers: context.headers,
    };
  }
}
