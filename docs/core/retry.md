← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Retry Logic (retry.ts)

Handles the reality that AWS API calls sometimes fail temporarily — throttling, network blips, service hiccups. Instead of immediately giving up, we wait and try again.

**Exponential backoff:** Each retry waits longer than the last:
- Attempt 1 fails → wait 1 second → retry
- Attempt 2 fails → wait 2 seconds → retry
- Attempt 3 fails → wait 4 seconds → retry
- Attempt 4 fails → give up

The wait time doubles each time because if a service is overloaded, hammering it with immediate retries makes things worse. Backing off gives it time to recover.

**The critical distinction — retryable vs non-retryable errors:**

| Retryable (try again) | Non-retryable (fail immediately) |
|----------------------|--------------------------------|
| ThrottlingException | ValidationException |
| TooManyRequestsException | AccessDeniedException |
| ServiceUnavailableException | ResourceNotFoundException |
| InternalServerError | InvalidParameterValue |
| RequestTimeout, ECONNRESET, ETIMEDOUT | |

If AWS says "you don't have permission," retrying won't help. But if AWS says "too many requests," waiting and retrying usually works.

**Why it returns a result object instead of throwing:** The Resource Resolver needs to continue processing other resources even when one lookup fails. By returning `{ success: false }` instead of throwing, the caller can mark that resource as `unknown` coverage and keep going — rather than crashing the entire analysis.

```typescript
const result = await withRetry(() => configClient.send(queryCommand));
if (result.success) {
  // use result.result
} else {
  // mark resource as "unknown" coverage and move on
}
```
