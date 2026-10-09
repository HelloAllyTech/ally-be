## The bug
The application frequently fails health checks due to Redis being unreachable. The logs show "Redis PING did not answer in 2000ms", which subsequently causes the `/api/health` endpoint to return a `ServiceUnavailableException`. This intermittent Redis connectivity issue could indicate underlying problems with the Redis instance, network configuration, or connection handling within the application. These failures can trigger false alarms in monitoring systems and potentially affect other parts of the application that rely on Redis.

- **File:** `src/health/controller/health.controller.ts` · `HealthController.check`
- **Found by:** production log · severity medium

## Verified before the fix
Proven by tool output (production log); no judgement was needed.

## The change, in words
The fix addresses the intermittent Redis health check failures by introducing a retry mechanism. If the initial Redis ping fails, the health check will wait for 200ms and then attempt to ping Redis a second time. This makes the health check more resilient to transient network issues without masking persistent problems.

A regression test has been added to verify this behavior. The new test simulates a Redis timeout on the first ping and ensures that the health check still reports an 'up' status after the second successful ping. Another test ensures that the health check correctly reports a 'down' status if both pings fail.

## Left untouched on purpose
No other changes were made to the health check logic or any other part of the codebase. The fix is intentionally minimal to address only the reported bug.

## What Bug Hunter decided along the way
- **D4** gemini gemini-2.5-pro — by the rule
- **D7** retry_fix — by the rule
- **D6** gemini gemini-2.5-pro — by the rule
- **D7** ask_human — by the rule; veto (safety): I already retried this once after a failure; a person decides

## Cost so far
1 of 2 sessions · 2 of 4 attempts · $0.00 of $15 · 0 of 120 minutes

---
_Bug Hunter case `ac172e36-50fb-4478-b4a9-a41e7b72aadd` on ally-be. [Open in the admin](https://admin.helloally.ai/bug-hunter?finding=ac172e36-50fb-4478-b4a9-a41e7b72aadd). A separate Verifier run reads this PR before it can merge and posts its verdict below; nothing merges without a pass._