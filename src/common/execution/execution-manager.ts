import { v4 as UUIDV4 } from 'uuid';
import { AsyncLocalStorage } from 'async_hooks';

export class ExecutionManager {
  private static asl: AsyncLocalStorage<Map<string, any>>;

  static init() {
    ExecutionManager.asl = new AsyncLocalStorage();
  }

  static runWithContext<R>(
    callback: (...args: any[]) => R,
    origin?: string,
  ): R {
    return ExecutionManager.getExecutionContext().run(
      new Map([
        ['id', UUIDV4()],
        ['startTime', new Date().toISOString()],
        ['origin', origin],
      ]),
      () => callback.apply(this),
    );
  }

  private static getExecutionContext() {
    return ExecutionManager.asl;
  }

  public static getFromContext<T>(key: string) {
    return ExecutionManager.getExecutionContext()?.getStore()?.get(key) as T;
  }

  public static setInContext(key: string, value: any) {
    ExecutionManager.getExecutionContext()?.getStore()?.set(key, value);
  }

  static getExecutionId(): string {
    return ExecutionManager.getFromContext('id');
  }

  static getExecutionStartTime(): string {
    return ExecutionManager.getFromContext('startTime');
  }
  static setActor(actor: string) {
    ExecutionManager.setInContext('actor', actor);
  }
  static getActor() {
    return ExecutionManager.getFromContext<string>('actor');
  }
  static setOrigin(origin: string) {
    ExecutionManager.setInContext('origin', origin);
  }
  static getOrigin() {
    return ExecutionManager.getFromContext<string>('origin');
  }

  static getContext() {
    return ExecutionManager.getExecutionContext()?.getStore();
  }

  static setAuthContext(userId: string, role: string, tenantId: string) {
    ExecutionManager.setInContext('userId', userId);
    ExecutionManager.setInContext('role', role);
    ExecutionManager.setInContext('tenantId', tenantId);
  }
}
