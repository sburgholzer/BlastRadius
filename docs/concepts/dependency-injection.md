← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Dependency Injection for Testing

**The problem:** Lambda handlers talk to AWS services (DynamoDB, S3, Config). When running tests, you don't want to actually call AWS — it's slow, costs money, and requires credentials. You need a way to swap in fake versions.

**How it works:** Every handler that talks to AWS has an optional second parameter called `deps`:

```typescript
export async function handler(
  event: IngestionInput,        // the actual input data
  deps?: AdapterRegistryDeps    // ← optional AWS clients
): Promise<Result> {
  // If deps wasn't provided, create real AWS clients
  const { dynamoClient, lambdaClient } = deps ?? createDefaultDeps();
  
  // Use those clients for all AWS operations
  const result = await dynamoClient.send(new GetItemCommand(...));
}
```

**In production** (deployed as a Lambda): nobody passes `deps`. It's `undefined`, so `createDefaultDeps()` runs and creates real clients that talk to actual AWS.

**In tests**: you pass fake clients that return whatever data you want:

```typescript
// Create fakes that return predetermined data
const mockDynamoClient = {
  send: vi.fn().mockResolvedValue({
    Item: { formatId: { S: 'terraform-plan' }, adapterLambdaArn: { S: 'arn:...' } }
  })
};

// Call the handler with fakes — no AWS calls happen
const result = await handler(
  { format: 'terraform-plan', payload: {...} },
  { dynamoClient: mockDynamoClient, lambdaClient: mockLambdaClient }
);

// Assert the result
expect(result).toHaveProperty('manifest');
```

**Why not mock module imports?** Some approaches use `jest.mock()` to replace the entire AWS SDK. That's fragile — if import paths change, tests break. Dependency injection is explicit: the test says exactly what fake data to return, and the handler doesn't know or care whether it's talking to real AWS or a mock.

**Which handlers use it:**

| Handler | What's injectable |
|---------|-------------------|
| adapter-registry | DynamoDB client, Lambda client |
| resource-resolver | Config client, Resource Explorer client |
| status | DynamoDB Document client |
| failure-handler | S3 client, DynamoDB Document client |
| visualization-prep | S3 client |
| results | DynamoDB Document client, S3 client, AuthorizationResolver |

Handlers that don't talk to AWS (ingestion, adapters, risk-assessor) don't need `deps` — they're pure functions that just transform data. No faking needed.
