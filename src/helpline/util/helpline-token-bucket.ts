/**
 * Per-socket send limit (contract §6.3): `capacity` messages at once, refilled
 * at `refillPerSecond`. In memory and per socket on purpose — it protects the
 * other side of one conversation from a flood, not the service as a whole.
 */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now = Date.now(),
  ) {
    this.tokens = capacity;
    this.last = now;
  }

  take(now = Date.now()): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillPerSecond,
    );
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
