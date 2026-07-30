---
title: Structured extraction with a refusal path
summary: Pulls typed fields out of messy documents and emits a null with a reason instead of inventing a value.
tags: [extraction, json, reliability]
model: claude-opus-5
technique: schema + explicit abstention
updated: 2026-07-28
featured: true
---

## Intent

Extraction prompts fail in one particular way: when a field is absent, the
model supplies something plausible. Giving abstention an explicit, rewarded
representation is more effective than telling the model not to hallucinate.

## Prompt

```prompt
Extract the fields below from the document. Return a single JSON object and
nothing else — no prose, no code fence.

Schema:
{
  "invoice_number": string | null,
  "issue_date":     string | null,   // ISO 8601, YYYY-MM-DD
  "due_date":       string | null,   // ISO 8601, YYYY-MM-DD
  "currency":       string | null,   // ISO 4217
  "total":          number | null,   // major units, e.g. 1234.56
  "vendor_name":    string | null,
  "line_items":     [{ "description": string, "quantity": number, "unit_price": number }],
  "_missing":       { "<field>": "<why it could not be determined>" }
}

Rules:
- A field you cannot ground in the document text is null, and gets an entry in
  `_missing` explaining why — "not present", "illegible", or "ambiguous: two
  candidate totals".
- Never infer a value from convention. If the date is "03/04/25", that is
  ambiguous, not April 3rd.
- Copy strings verbatim, including odd casing. Do not normalise vendor names.
- `total` is the amount actually payable, not a subtotal.
- If the document is not an invoice, return {"_missing": {"*": "not an invoice"}}.

Document:
{{DOCUMENT}}
```

## Notes

- The `_missing` map matters more than the nulls. It converts a silent gap into
  a reviewable signal, and downstream code can route on it.
- Naming a specific ambiguity example (`03/04/25`) is worth more than a general
  instruction about date formats.
- Removing the code fence from the output makes parsing simpler, but you should
  still strip one defensively — models add it back under load.
