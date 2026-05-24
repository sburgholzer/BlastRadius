← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# What 'Canonical' Means

"Canonical" means the single, standardized format the system uses internally — regardless of what tool produced the input. It's a universal translator:

- Terraform says `["delete", "create"]` to mean a resource replacement
- CloudFormation says `Action: "Modify"` with `Replacement: "True"` for the same thing
- CDK says `changeType: "REPLACE"`

All three mean the same thing, but expressed differently. The canonical format normalizes them all into one shape:

```typescript
{
  resourceType: "AWS::EC2::Instance",
  resourceId: "i-abc123",
  provider: "aws",
  modificationType: "Replace"  // ← one consistent representation
}
```

The adapters do the translation (Terraform → canonical, CloudFormation → canonical, etc.), and then the entire analysis engine — dependency discovery, risk scoring, visualization — only needs to understand one format. It never sees Terraform or CloudFormation specifics.

This is why adding a new IaC tool (say, Pulumi or Ansible) only requires writing one adapter. The core engine doesn't change at all.
