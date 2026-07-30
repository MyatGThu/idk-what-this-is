---
title: Rewrite without drift
summary: Tightens prose while holding the claims fixed, and reports anything it had to change rather than silently smoothing it over.
tags: [writing, editing]
model: claude-sonnet-5
technique: constraint + change log
updated: 2026-07-18
---

## Intent

Ask a model to "improve" a paragraph and it will quietly upgrade hedged claims
into confident ones. Requiring a change log makes that drift visible.

## Prompt

```prompt
Rewrite the text below so it is clearer and shorter. The claims must survive
unchanged.

Hold fixed:
- Every factual claim, including its hedging. "may cause" does not become
  "causes". "roughly 40%" does not become "40%".
- Every number, name, date and quoted string.
- The author's register. Do not make informal writing corporate, or the
  reverse.

Change freely:
- Sentence structure, ordering, and connective tissue.
- Redundancy. If two sentences make one point, make it once.
- Filler: "it is important to note", "in order to", "very".

Then list every edit where you were not certain the meaning survived, as:
  - original phrasing -> new phrasing -> why it might matter

If the text is already tight, return it unchanged and say so. Do not rewrite to
demonstrate effort.

Text:
{{TEXT}}
```

## Notes

- The hedging examples are load-bearing. Without them, "may cause" becomes
  "causes" often enough to matter in anything regulated.
- "Do not rewrite to demonstrate effort" measurably reduces churn on text that
  was already fine.
- Sonnet is the right tier here; the task is constraint-following rather than
  reasoning, and the cost difference is real at volume.
