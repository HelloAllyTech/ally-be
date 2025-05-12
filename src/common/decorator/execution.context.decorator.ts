import { ExecutionManager } from '../execution/execution-manager';

export enum ExecutionContextPropagation {
  REQUIRED = 'REQUIRED', // Must have an execution context
  REQUIRES_NEW = 'REQUIRES_NEW', // Always create a new execution context
  SUPPORTS = 'SUPPORTS', // Use existing context if available, otherwise run without context
  NOT_SUPPORTED = 'NOT_SUPPORTED', // Run without execution context
}

export function WithExecutionContext(
  propagation: ExecutionContextPropagation = ExecutionContextPropagation.SUPPORTS,
): MethodDecorator {
  return (target, propertyKey, descriptor: PropertyDescriptor): void => {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      const currentContext = ExecutionManager.getCurrentContext();

      switch (propagation) {
        case ExecutionContextPropagation.REQUIRED:
          if (!currentContext) {
            throw new Error('Execution context is required but not found');
          }
          return originalMethod.apply(this, args);

        case ExecutionContextPropagation.REQUIRES_NEW:
          return ExecutionManager.runWithContext(
            () => originalMethod.apply(this, args),
            `${target.constructor.name}.${String(propertyKey)}`,
          );

        case ExecutionContextPropagation.SUPPORTS:
          if (currentContext) {
            return originalMethod.apply(this, args);
          }
          return ExecutionManager.runWithContext(
            () => originalMethod.apply(this, args),
            `${target.constructor.name}.${String(propertyKey)}`,
          );

        case ExecutionContextPropagation.NOT_SUPPORTED:
          if (currentContext) {
            throw new Error('Execution context is not supported but found');
          }
          return originalMethod.apply(this, args);

        default:
          return originalMethod.apply(this, args);
      }
    };
  };
}
