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
| `cloudformation` | `arn:aws:lambda:...:BlastRadius-Adapter-CloudFormation` | CloudFormation Adapter |
| `terraform-plan` | `arn:aws:lambda:...:BlastRadius-Adapter-Terraform` | Terraform Adapter |
| `cdk` | `arn:aws:lambda:...:BlastRadius-Adapter-CDK` | CDK Adapter |

**Seeded automatically:** The CDK stack uses `AwsCustomResource` to populate these entries on every deploy. Adding a new adapter means creating the Lambda and adding a seed entry to the stack — zero changes to the registry code.

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

**Important:** The handler uses `deps && 'dynamoClient' in deps` to distinguish between test-injected deps and the Lambda runtime's `Context` object (which is passed as the second argument in production). Using `deps ?? createDefaultDeps()` would fail because the Context object is truthy.

**Adapter handlers are async:** All adapter Lambdas (cloudformation, terraform, cdk) must be declared `async`. The Node.js 22 Lambda runtime returns `null` for synchronous handlers — this is a runtime behavior change from Node.js 18/20.

**Output includes metadata** — adapter name, how long conversion took, and any non-fatal warnings.

**Pipeline position:** The adapter registry is invoked by the Step Functions `AdapterConversion` state, which passes `{ format: $.sourceFormat, payload: $.manifest }` using a custom payload mapping. The result is stored at `$.adapterResult` using `resultPath`.
