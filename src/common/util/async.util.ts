/**
 * Utility functions for handling async operations
 */

/**
 * Executes an async function on each element of an array sequentially
 * @param items Array of items to process
 * @param asyncCallback Async function to execute for each item
 * @returns Promise that resolves when all items have been processed
 */
export async function processSequentially<T, R>(
  items: T[],
  asyncCallback: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i++) {
    const result = await asyncCallback(items[i], i);
    results.push(result);
  }
  return results;
}
