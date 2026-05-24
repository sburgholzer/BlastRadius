← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Results Handler

**`results/handler.ts`** — The authorization-aware result retrieval endpoint. When someone asks for analysis results, this handler decides what they're allowed to see.

**Two operations:**

**Get (single result):**
- Looks up the analysis in DynamoDB to find who owns it
- If you're the owner → full access to everything
- If you're authorized for the originating account → scoped access (unauthorized resources filtered out)
- If neither → 403 Forbidden

**List (all accessible results):**
- Queries DynamoDB for results you own (by principal ARN)
- Also queries for results from accounts you're authorized to access
- Combines, deduplicates, sorts by most recent

**Scoping in action:** If an analysis spans accounts 111 and 222, but you only have access to 111, you'll see the results but resources from account 222 will be stripped out. The response includes an exclusion summary: "1 resource omitted from account 222222222222."

**Why this exists separately from the status handler:** Status is lightweight (just progress info). Results involves S3 retrieval, authorization checks, and potentially filtering large result sets. Different concerns, different Lambda.
