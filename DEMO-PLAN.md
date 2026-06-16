# Demo Recording Plan

Silent video, 5-10 minutes. Visuals only.

## Pre-Recording Setup

- Terminal: large font, clean background
- Browser: zoom in (Cmd+Plus), dark mode
- Have the demo PR open: https://github.com/sburgholzer/BlastRadiusDemo/pull/2
- Have the frontend open: https://d10nk68ljvk3lk.cloudfront.net
- Terminal cwd: `examples/cdk-demo/02-risky-change`

### Terminal alias setup (run before recording):
```bash
alias blast-radius="node /Users/scottburgholzer/Documents/CBProjects/BlastRadius/packages/cli/dist/index.js"
export BLAST_RADIUS_API_URL=https://alhs6t7pub.execute-api.us-east-1.amazonaws.com/v1
```

---

## 1. CLI Demo (1-2min)

Run from `examples/cdk-demo/02-risky-change`:

```bash
blast-radius analyze --format cdk --stack BlastRadiusDemoBaseline --ai-gate
```

Let it run live:
- "Generating cdk input..."
- "Creating changeset against stack..."
- "Computing changes..."
- "Submitting analysis..."
- "Analysis submitted. Waiting for results..."
- Results: "✗ FAIL — AI recommends against deployment."
- AI summary displays

Then show exit code:
```bash
echo $?
# → 1
```

## 2. Frontend Graph (2-3min)

- Open the latest completed analysis in the frontend
- Pause on Risk Summary cards (Critical/High/Medium/Low)
- Hover/click nodes in the graph — show detail popover
- Click a filter chip (toggle Direct Changes off, then on)
- Try a different layout (Hierarchical or Force)
- Switch to Table View — scroll through resources
- Scroll down to the AI Summary (rendered markdown)

## 3. PR Comment (15-30s)

- Open GitHub PR
- Scroll to the Blast Radius comment
- Pause on the metrics table (score, affected, AI recommendation)
- Scroll through the AI summary

## 4. Quick Architecture (30s)

- Open the GitHub repo README
- Scroll to "How It Works" section
- Brief pause on the flow diagram

---

## Tips

- Move slowly between sections so viewers can read
- Pause 2-3 seconds on important info
- Consider text overlay title cards between sections in post-production:
  - "CLI — CI/CD Integration"
  - "Interactive Dependency Graph"
  - "GitHub Action — Automatic PR Analysis"
  - "Architecture"
