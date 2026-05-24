← Back to [Architecture Walkthrough](../architecture-walkthrough.md)

# Risk Summary Handler

**`risk-summary/handler.ts`** — Optional AI-powered feature. Takes the top-scoring resources and asks Amazon Bedrock (Claude) to write a plain-English explanation of the risk.

**Why it exists:** Engineers can read scores and graphs, but team leads want a quick "what does this mean?" without parsing numbers. The summary says things like: "The proposed security group change puts your production RDS database at critical risk because it's directly attached via the EC2 instance that serves as the database proxy."

**How it works:**
1. **Feature flag check** — if `ENABLE_BEDROCK_SUMMARY` is not `true`/`1`, returns immediately. No Bedrock call, no cost.
2. **Select top 3** — picks the 3 highest-scoring resources (or all if fewer than 3). Focus on the scariest ones.
3. **Build a prompt** — structured prompt with resource details, scores, chains, and overall summary.
4. **Call Bedrock** — invokes Claude 3 Haiku with a 15-second timeout.
5. **Enforce word limit** — truncates to 500 words at a sentence boundary.
6. **Graceful failure** — if Bedrock is slow/unavailable, returns `{ summary: undefined, error: "..." }`. The rest of the analysis is still available.

**Why Claude 3 Haiku?** Cheapest and fastest Bedrock model. A summary costs ~$0.0005 (half a cent).

**The 15-second timeout:** If Bedrock is slow, we don't hold up the pipeline. The timeout races against the Bedrock call — whichever finishes first wins. The summary is purely additive — everything else works without it.
