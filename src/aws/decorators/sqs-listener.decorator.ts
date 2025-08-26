import { sqsHandlerRegistry } from '../registry/sqs-handler.registry';

/**
 * Decorator to mark a method as an SQS message handler
 * @param queueUrl - The URL of the SQS queue to listen to
 */
export function SqsListener(queueUrl: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    // Register the handler when the decorator is applied
    sqsHandlerRegistry.registerHandler(queueUrl, target, propertyKey, false);

    return descriptor;
  };
}

/**
 * Decorator to mark a method as an SQS DLQ (Dead Letter Queue) message handler
 * @param queueUrl - The URL of the SQS DLQ to listen to
 */
export function SqsDlqListener(queueUrl: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    // Register the handler when the decorator is applied
    sqsHandlerRegistry.registerHandler(queueUrl, target, propertyKey, true);

    return descriptor;
  };
}
