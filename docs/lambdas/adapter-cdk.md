← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# CDK Adapter

**`adapters/cdk/handler.ts`** — Converts CDK cloud assembly diff output into the canonical format.

**CDK is different:** Its diff output organizes resources by *type* first, then by logical ID within each type. It also has nested stacks (stacks within stacks).

**What CDK gives you:**
```json
{
  "stackName": "MyStack",
  "resources": {
    "AWS::S3::Bucket": {
      "MyBucket": {
        "changeType": "CREATE",
        "logicalId": "MyBucket",
        "physicalId": "my-bucket-12345",
        "properties": {
          "BucketName": { "oldValue": "old-name", "newValue": "new-name" }
        }
      }
    }
  },
  "nestedStacks": {
    "AuthStack": { "resources": { ... } }
  }
}
```

Notice: `resources` is a map of *resource type* → map of *logical ID* → change details. Different from CloudFormation and Terraform (both flat arrays).

**Action mapping:**

| CDK changeType | → Canonical Type |
|---------------|------------------|
| CREATE | Add |
| UPDATE | Modify |
| DELETE | Remove |
| REPLACE | Replace |

Simpler than CloudFormation — CDK is more explicit about replacements.

**Nested stack flattening:** CDK projects often have stacks within stacks. The adapter recursively walks `nestedStacks` (up to 10 levels deep) and collects all resources into one flat list.

**Resource ID priority:** Uses `physicalId` (actual AWS resource ID) if available, falls back to `logicalId` (CDK construct name).

**Property changes:** CDK reports them as `{ oldValue, newValue }` per property. The adapter converts to canonical `{ before: {...}, after: {...} }` format.

**Provider:** Always `"aws"` since CDK is AWS-specific.
