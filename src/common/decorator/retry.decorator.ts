import { LoggerService } from '../../logger/logger.service';

const logger = LoggerService.getInstance('RetryOnFail');
export function RetryOnFail(attempts = 3, delayMs = 1000) {
  return function (
    _target: any,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: any[]) {
      let attempt = 0;
      while (attempt < attempts) {
        try {
          return await originalMethod.apply(this, args); // Call the original method
        } catch (error) {
          attempt++;
          if (attempt >= attempts) throw error;
          const backoff = delayMs * Math.pow(2, attempt - 1); // Exponential backoff
          logger.warn(`Retrying (${attempt}/${attempts}) in ${backoff}ms...`);
          await new Promise((res) => setTimeout(res, backoff));
        }
      }
    };

    return descriptor;
  };
}

export interface RetryWithinBudgetOptions {
  /** Maximum number of CALLS (not retries). 2 means "one retry". */
  attempts: number;
  /** Fixed pause between attempts. No exponential growth — see below. */
  delayMs: number;
  /**
   * Hard wall-clock ceiling for the whole decorated call, retries included.
   *
   * This is the reason this decorator exists. `RetryOnFail` retries blindly, so
   * on a method with a 25s HTTP timeout it can burn 3 × 25s + backoff ≈ 78s.
   * On a path that runs inside an SQS consumer whose visibility timeout is 60s,
   * that guarantees the exact failure the retry was meant to prevent: the
   * message is redelivered while we are still working on it.
   */
  budgetMs: number;
  /**
   * Optional predicate. Return false for a failure that repeating cannot fix
   * (a 4xx the upstream will refuse identically) so the budget is not spent on
   * a guaranteed second refusal.
   */
  shouldRetry?: (error: unknown) => boolean;
  /** Label for the log line. Defaults to the method name. */
  label?: string;
}

/**
 * Retry a method, but never exceed a wall-clock budget.
 *
 * The scheduling rule: after a failed attempt, retry only if
 * `elapsed + delay + (however long the attempt that just failed took)` still
 * fits inside `budgetMs`. Using the last attempt's duration as the estimate for
 * the next one is what makes this safe without needing to know the method's
 * internal timeout:
 *
 *  - A fast failure (connection refused, 502, DNS) costs ~milliseconds, so the
 *    retry is essentially free and happens. These are precisely the failures
 *    where a retry works.
 *  - A slow failure (the call timed out) is assumed to time out again, so with a
 *    budget below 2× the timeout no retry is attempted. That is the right call
 *    twice over: the budget is protected, and hammering an already-overloaded
 *    service with a second full-length request is what turns a slow minute into
 *    an outage.
 *
 * The delay is FIXED rather than exponential for the same reason — under a tight
 * budget, exponential backoff spends the budget on sleeping instead of trying.
 */
export function RetryWithinBudget(options: RetryWithinBudgetOptions) {
  const { attempts, delayMs, budgetMs, shouldRetry, label } = options;

  return function (
    _target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) {
    const originalMethod = descriptor.value;
    const name = label ?? propertyKey;

    descriptor.value = async function (...args: any[]) {
      const startedAt = Date.now();

      for (let attempt = 1; ; attempt++) {
        const attemptStartedAt = Date.now();
        try {
          return await originalMethod.apply(this, args);
        } catch (error) {
          const attemptMs = Date.now() - attemptStartedAt;
          const elapsedMs = Date.now() - startedAt;

          if (attempt >= attempts) throw error;
          if (shouldRetry && !shouldRetry(error)) {
            logger.warn(
              `${name}: not retrying — the failure is terminal ` +
                `(attempt ${attempt}/${attempts}, elapsed ${elapsedMs}ms)`,
            );
            throw error;
          }

          const projectedMs = elapsedMs + delayMs + attemptMs;
          if (projectedMs > budgetMs) {
            logger.warn(
              `${name}: not retrying — a further attempt would need ~` +
                `${projectedMs}ms against a ${budgetMs}ms budget ` +
                `(attempt ${attempt}/${attempts}, elapsed ${elapsedMs}ms)`,
            );
            throw error;
          }

          logger.warn(
            `${name}: retrying (${attempt}/${attempts}) in ${delayMs}ms ` +
              `after a ${attemptMs}ms failure; elapsed ${elapsedMs}ms of ` +
              `${budgetMs}ms budget`,
          );
          await new Promise((res) => setTimeout(res, delayMs));
        }
      }
    };

    return descriptor;
  };
}
