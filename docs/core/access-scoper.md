← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Access Scoper (access-scoper.ts)

Enforces multi-tenancy: making sure teams only see resources they're authorized to access.

**The problem:** In a large organization, multiple teams share AWS accounts. Team A shouldn't see Team B's production database in their blast radius results, even if there's a dependency chain that crosses account boundaries.

**What it does (3 things):**

**1. Extract identity from the request:**
```typescript
extractPrincipalFromSigV4(apiGatewayEvent)
// → { principalArn: "arn:aws:iam::123456789012:user/alice", accountId: "123456789012" }
// → or null if authentication failed
```
Every API request is signed with AWS SigV4 (like a digital signature). This function pulls out *who* is making the request from that signature.

**2. Scope the dependency graph:**
```typescript
scopeDependencyGraph(fullGraph, {
  authorizedAccounts: ['123456789012'],
  authorizedRegions: ['us-east-1'],
})
// → filtered graph + exclusion summary ("2 resources omitted from account 987654321098")
```
Removes nodes/edges from accounts or regions the user can't access.

**3. Scope scored resources:** Same idea but for the scored resource list — strips out unauthorized resources before returning results.

**Key security rule:** The exclusion summary tells you *which accounts* were excluded, but never reveals *what resources* were in those accounts. You learn "account 987654321098 was excluded" but not "there's an RDS database in that account with a score of 95."

**Pluggable authorization:** The `AuthorizationResolver` interface lets you swap in different authorization backends. In production it would query IAM/Organizations. For testing, you inject a mock.

**Authentication error:** `createAuthenticationError()` returns a generic 401 that doesn't reveal internal system details — just "invalid or missing credentials."
