← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Adapter Registry Handler

**`adapter-registry/handler.ts`** — A router. When someone submits a changeset in a native format, this Lambda figures out which adapter to call.

**How it works:**
1. User submits `{ format: "terraform-plan", payload: {...} }`
2. Registry looks up "terraform-plan" in a DynamoDB table
3. DynamoDB returns the Lambda ARN for the Terraform adapter
4. Registry invokes that Lambda with the payload
5. Adapter returns a canonical `ResourceChangeManifest`
6. Registry passes it back with timing metadata

**The DynamoDB table is the registry:**

| formatId | adapterLambdaArn | displayName |
|----------|-----------------|-------------|
| `cloudformation` | `arn:aws:lambda:...:cfn-adapter` | CloudFormation Adapter |
| `terraform-plan` | `arn:aws:lambda:...:terraform-adapter` | Terraform Adapter |
| `cdk` | `arn:aws:lambda:...:cdk-adapter` | CDK Adapter |

**Why DynamoDB instead of hardcoding?** Adding a new adapter (say Pulumi) means inserting one row in DynamoDB and deploying one new Lambda. Zero changes to the registry code or any existing adapter.

**Unknown format handling:**
```
User submits: { format: "ansible", payload: {...} }
Response: { error: "Unsupported format: ansible", supportedFormats: ["cloudformation", "terraform-plan", "cdk"] }
```
Tells you what *is* supported so you can fix your request.

**Dependency injection for testing:**
```typescript
export async function handler(event: AdapterRegistryInput, deps?: AdapterRegistryDeps)
```
In production, creates real DynamoDB/Lambda clients. In tests, you pass mocks — no AWS calls needed.

**Output includes metadata** — adapter name, how long conversion took, and any non-fatal warnings.
