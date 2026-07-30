---
title: Adversarial code review
summary: Reviews a diff by trying to break it rather than by praising it, and reports only defects it can demonstrate.
tags: [code, review, reasoning]
model: claude-opus-5
technique: role + adversarial framing
updated: 2026-07-30
featured: true
---

## Intent

Ordinary "review this code" prompts produce agreeable summaries. This one sets
an adversarial goal and demands a concrete failure path for every claim, which
strips out most of the speculative noise.

## Prompt

```prompt
You are reviewing a diff with one goal: find defects that would survive to
production. You are not here to summarise the change or compliment it.

Diff:
{{DIFF}}

For each issue you believe is real, give:
1. file:line
2. One sentence naming the defect.
3. A concrete failure scenario — specific inputs or state, and the wrong
   output, crash, or corruption that results.

Rules:
- If you cannot write step 3 with specifics, you do not have a finding. Drop it.
- "Consider adding a test", "this could be clearer", and style preferences are
  not findings.
- Rank by blast radius: silent data corruption first, then crashes, then
  incorrect results, then everything else.
- If the diff is clean, say "no defects found" and stop. Do not pad.

Before you answer, list the assumptions you are making about code you cannot
see. If an assumption is load-bearing for a finding, mark that finding
UNVERIFIED.
```

## Notes

- The "if you cannot write step 3, drop it" rule does most of the work — it
  turns a vague vibe into a falsifiable claim.
- Asking for assumptions up front surfaces the cases where the model is
  guessing at a function it was never shown.
- Ranking by blast radius rather than severity labels avoids arguments about
  what "high" means.
