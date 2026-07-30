---
title: Debug from a stack trace
summary: Works backwards from an error to a ranked set of hypotheses, each with the cheapest experiment that would disprove it.
tags: [code, debugging, reasoning]
model: claude-opus-5
technique: hypothesis ranking
updated: 2026-07-14
---

## Intent

Pasting a stack trace usually gets one confident answer, which is wrong about
half the time. Asking for ranked hypotheses plus a falsifying test converts a
guess into a debugging plan.

## Prompt

```prompt
Here is a failure. Work backwards to its cause.

Error and stack trace:
{{TRACE}}

Relevant code:
{{CODE}}

What I have already ruled out:
{{RULED_OUT}}

Give three to five hypotheses, ranked by how likely they are given this
specific evidence — not by how common they are in general.

For each:
- The mechanism, in one or two sentences. What is actually happening in memory
  or on the wire.
- The evidence in the trace that supports it. Quote the line.
- The evidence that would contradict it, if it were present and is not.
- The cheapest experiment that would rule it out. Prefer a log line or a
  one-line check over a refactor.

Then say which experiment to run first, and what each outcome would tell me.

Do not propose a fix yet. If the top hypothesis is far ahead of the rest, say
so explicitly rather than padding the list to five.
```

## Notes

- "Ranked by this specific evidence, not general frequency" stops the model
  from leading with the textbook cause of that exception class.
- Asking for absent contradicting evidence is unusual and surprisingly useful —
  it surfaces the "if it were X, we'd also see Y, and we don't" reasoning.
- Withholding the fix keeps the response focused. Ask for it in a second turn,
  after an experiment has narrowed things down.
