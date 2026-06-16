# Future TODO

Items to add as the project matures and gains users/contributors.

## Community & Governance

- [ ] Code of Conduct (`CODE_OF_CONDUCT.md`) — add when first external contributor appears
- [ ] Security policy (`SECURITY.md`) — how to report vulnerabilities privately
- [ ] Discussion templates — GitHub Discussions for Q&A, ideas

## CI/CD Improvements

- [ ] Dependabot config (`.github/dependabot.yml`) — auto-update dependencies
- [ ] Release changelog automation — generate from conventional commits on tag
- [ ] Deploy workflow — `cdk deploy` on push to main (private runner or OIDC)
- [ ] Frontend deploy workflow — S3 sync + CloudFront invalidation on main
- [ ] Code coverage reporting — vitest coverage, comment delta on PRs
- [ ] Bundle size check — warn if frontend grows too much

## CLI & Action

- [ ] Bundle as native binary (Bun compile) — no Node.js required
- [ ] Publish to npm (`npx blast-radius analyze ...`)
- [ ] Separate `blast-radius-action` repo for cleaner Marketplace listing
- [ ] Action: support generating changeset internally (optional, for convenience)
- [ ] Pre-built Docker image for CI runners without Node.js

## Features

- [ ] Pulumi adapter
- [ ] Multi-stack analysis (analyze changes across multiple stacks at once)
- [ ] Historical tracking — compare risk trends over time
- [ ] Slack/Teams notifications — post summary to channels
- [ ] Hosted backend option — so users don't need to deploy their own
- [ ] Cost impact estimation — pair with AWS Cost Explorer
- [ ] Custom criticality overrides — let users mark specific resources as Critical

## Frontend

- [ ] Analysis comparison view — diff two analyses side by side
- [ ] Shareable links with embedded state
- [ ] Mobile responsive layout
- [ ] Accessibility audit (WCAG 2.1 AA)

## Infrastructure

- [ ] Multi-region deployment support
- [ ] WAF on API Gateway
- [ ] Custom domain with ACM cert
- [ ] Backup/restore for DynamoDB tables
