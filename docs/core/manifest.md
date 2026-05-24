← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Manifest Model (manifest.ts)

The canonical format definition. Every IaC tool's changeset gets converted into this shape. This file is purely declarative — just TypeScript interfaces, no logic, no validation, no AWS calls. It's the contract that says "this is what a valid manifest looks like."

```typescript
// The 4 things you can do to a resource
type ModificationType = 'Add' | 'Modify' | 'Remove' | 'Replace';

// One resource being changed
interface ResourceChange {
  resourceType: string;      // e.g. "AWS::EC2::Instance"
  resourceId: string;        // e.g. "i-abc123"
  provider: string;          // e.g. "aws"
  modificationType: ModificationType;
  region?: string;
  accountId?: string;
  properties?: { before?: {...}; after?: {...} };
}

// The full manifest (what gets passed through the pipeline)
interface ResourceChangeManifest {
  version: string;
  metadata: ManifestMetadata;
  resources: ResourceChange[];
  groups?: ManifestGroup[];   // optional nesting for modules/stacks
}
```

Other files *use* these types:
- `manifest-validator.ts` enforces the rules (zod schemas check that data matches these shapes)
- The adapters *produce* objects matching these types
- The resource resolver *consumes* them to know what to look up

**Relationship:** `ResourceChange` is a single resource being modified (one security group, one Lambda function, one RDS instance). `ResourceChangeManifest` is the envelope that holds all of them together as one submission — like a shipping manifest listing every item in the shipment:

```
ResourceChangeManifest (the document)
├── version: "1.0"
├── metadata: { when it was submitted, what tool produced it }
└── resources: [                    ← array of individual changes
      ResourceChange (sg-abc123, Modify)
      ResourceChange (lambda-xyz, Remove)
      ResourceChange (rds-prod, Replace)
    ]
```

So when someone runs `terraform plan` and it says "3 resources will change," the adapter produces one `ResourceChangeManifest` containing 3 `ResourceChange` entries. The rest of the pipeline works with that single manifest object.

**What about `groups`?** Some IaC tools give you resources in a nested structure (CDK nested stacks, Terraform modules). Rather than forcing every adapter to write its own flattening code, we just say "hand it to us however you have it — nested or flat — and we'll handle the rest." The `groups` field is simply an input convenience: adapters can submit resources already flat in the `resources` array, or nested inside `groups`, or both. Either way, the ingestion service flattens everything into one flat list before anything else touches it.
