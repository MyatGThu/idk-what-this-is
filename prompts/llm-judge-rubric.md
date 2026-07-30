---
title: LLM judge with a forced rubric
summary: Scores two candidate outputs against fixed criteria, committing to per-criterion evidence before it picks a winner.
tags: [evals, judging, reasoning]
model: claude-opus-5
technique: rubric + order randomisation
updated: 2026-07-26
---

## Intent

Pairwise judges drift toward the longer answer and toward whichever one came
second. Forcing per-criterion evidence before the verdict, and randomising
presentation order across runs, removes most of that bias.

## Prompt

```prompt
You are scoring two candidate responses to the same request. You do not know
which system produced which.

Request:
{{REQUEST}}

Response A:
{{RESPONSE_A}}

Response B:
{{RESPONSE_B}}

Score each response 1-5 on every criterion. For each score, quote the span of
the response that justifies it. A score with no quote is invalid.

Criteria:
- correctness — are the factual and logical claims right?
- completeness — does it address everything asked, and nothing more?
- grounding — is every claim supported by the request or by stated reasoning?
- instruction-following — does it obey format and constraint requirements?

Then, and only then, give a verdict: A, B, or TIE.

Rules:
- Length is not a criterion. A shorter response that satisfies the request
  scores higher on completeness than a longer one that pads.
- If both responses share a flaw, note it once and let it cancel out.
- TIE is a real answer. Use it when the criteria genuinely split.
- Do not reference "the first" or "the second" response — use A and B.

Output JSON:
{"a": {"correctness": n, "completeness": n, "grounding": n, "instruction_following": n, "evidence": {...}},
 "b": {...},
 "verdict": "A" | "B" | "TIE",
 "rationale": "one sentence"}
```

## Notes

- Run every pair twice with A and B swapped. If the verdict flips, the judge is
  reading position, not quality — treat that pair as a TIE.
- The "quote the span" requirement is the highest-leverage line here. Judges
  that cannot quote are usually pattern-matching on tone.
- Stating that length is not a criterion measurably reduces verbosity bias, but
  does not eliminate it.
