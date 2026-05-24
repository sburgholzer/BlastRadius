← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Terraform Adapter

**`adapters/terraform/handler.ts`** — Converts the output of `terraform show -json` (a plan file) into the canonical format.

**What Terraform gives you:**
```json
{
  "format_version": "1.2",
  "terraform_version": "1.5.0",
  "resource_changes": [
    {
      "address": "aws_instance.web",
      "type": "aws_instance",
      "provider_name": "registry.terraform.io/hashicorp/aws",
      "change": {
        "actions": ["update"],
        "before": { "instance_type": "t3.micro" },
        "after": { "instance_type": "t3.large" }
      }
    }
  ]
}
```

**What the adapter produces:**
```json
{ "resourceType": "aws_instance", "resourceId": "aws_instance.web", "provider": "aws", "modificationType": "Modify" }
```

**Action mapping:**

| Terraform `actions` array | → Canonical Type |
|--------------------------|------------------|
| `["create"]` | Add |
| `["update"]` | Modify |
| `["delete"]` | Remove |
| `["delete", "create"]` or `["create", "delete"]` | Replace |
| `["no-op"]` | *skipped entirely* |
| `["read"]` | *skipped entirely* |

Terraform uses a *two-element array* for replacements — `["delete", "create"]` means "destroy the old one, then create a new one." `no-op` and `read` are skipped because they represent resources that aren't changing.

**Provider mapping:**

| Terraform provider_name | → Canonical |
|------------------------|-------------|
| `registry.terraform.io/hashicorp/aws` | `aws` |
| `registry.terraform.io/hashicorp/azurerm` | `azure` |
| `registry.terraform.io/hashicorp/google` | `gcp` |
| Anything else | Last segment of the path |

**Resource ID:** Uses the `address` field (e.g. `aws_instance.web` or `module.networking.aws_vpc.main`) — Terraform's unique identifier for tracking resources.

**Before/after:** Carried through from `change.before` and `change.after` if present, showing what's actually changing (like instance type t3.micro → t3.large).
