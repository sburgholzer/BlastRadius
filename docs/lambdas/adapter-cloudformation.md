← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# CloudFormation Adapter

**`adapters/cloudformation/handler.ts`** — Converts the output of AWS CloudFormation's `DescribeChangeSet` API into the canonical format.

**What CloudFormation gives you:**
```json
{
  "ChangeSetName": "my-changeset",
  "StackName": "my-stack",
  "Changes": [
    {
      "Type": "Resource",
      "ResourceChange": {
        "Action": "Modify",
        "LogicalResourceId": "MyBucket",
        "PhysicalResourceId": "arn:aws:s3:::my-bucket-12345",
        "ResourceType": "AWS::S3::Bucket",
        "Replacement": "False"
      }
    }
  ]
}
```

**What the adapter produces:**
```json
{ "resourceType": "AWS::S3::Bucket", "resourceId": "arn:aws:s3:::my-bucket-12345", "provider": "aws", "modificationType": "Modify" }
```

**Mapping rules:**

| CloudFormation Action | Replacement | → Canonical Type |
|----------------------|-------------|------------------|
| Add | — | Add |
| Remove | — | Remove |
| Import | — | Add |
| Dynamic | — | Modify |
| Modify | "False" or "Conditional" | Modify |
| Modify | "True" | Replace |

The tricky one: `Modify + Replacement: "True"` — CloudFormation calls it a "Modify" but it's actually going to delete and recreate the resource. Much more dangerous, so we map it to `Replace` (severity 80 instead of 50).

**Resource ID priority:** Uses `PhysicalResourceId` (actual ARN in AWS) if available, falls back to `LogicalResourceId` (template name) for resources that don't exist yet.

**Error handling:** Missing `Changes` array or malformed entries → error with exact JSON path (e.g. `$.Changes[2].ResourceChange.Action`). Non-resource changes are skipped with a warning.
