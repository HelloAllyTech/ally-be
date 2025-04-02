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
          console.warn(`Retrying (${attempt}/${attempts}) in ${backoff}ms...`);
          await new Promise((res) => setTimeout(res, backoff));
        }
      }
    };

    return descriptor;
  };
}
