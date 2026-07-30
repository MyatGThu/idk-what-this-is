# prompt-engineer

A prompt library kept in git and published as a static site on GitHub Pages.

Each prompt is a markdown file in `prompts/`. A build step turns them into a
searchable, filterable, linkable web page. No server, no database, no API keys —
which is the whole reason it fits on Pages.

**Live site:** https://myatgthu.github.io/prompt-engineer/

---

## GitHub setup

None, normally. The workflow passes `enablement: true` to
`actions/configure-pages`, so the first push to `master` turns Pages on itself
and publishes. No secrets, no `CNAME`, no environment variables.

If that step ever fails with `Get Pages site failed` or `Resource not
accessible by integration`, enable it by hand instead:

1. **Settings → Pages → Build and deployment → Source → GitHub Actions.**
   (Not "Deploy from a branch" — the site is built, so it needs the Actions path.)
2. Re-run the workflow.

Also check **Settings → Actions → General → Workflow permissions** if the token
looks under-privileged; the `permissions:` block in the workflow covers the rest.

### Using a custom domain later

Add a `CNAME` file to `web/` (it gets copied into the published output) and set
the domain under **Settings → Pages**.

---

## Local development

Requires Node 20 or newer. There are no dependencies to install.

```bash
npm run dev      # build, then serve on http://localhost:4173
npm run build    # write _site/ only
npm run serve    # serve an existing _site/
npm run new -- "My prompt title"   # scaffold prompts/my-prompt-title.md
```

`_site/` is generated and gitignored. Do not edit it.

Opening `_site/index.html` directly via `file://` will not work — the page
fetches `prompts.json`, which browsers block on the file protocol. Use
`npm run dev`.

---

## Adding a prompt

Create a file in `prompts/`. Copy `prompts/_TEMPLATE.md` or run `npm run new`.

```markdown
---
title: Adversarial code review
summary: Reviews a diff by trying to break it rather than by praising it.
tags: [code, review, reasoning]
model: claude-opus-5
technique: role + adversarial framing
updated: 2026-07-30
featured: true
---

## Intent

Why this prompt exists and when to reach for it.

## Prompt

```prompt
The actual prompt text. Use {{PLACEHOLDERS}} for the parts that change.
```

## Notes

What you tried, what failed, what to watch for.
```

### Front matter

| Field | Required | Notes |
|---|---|---|
| `title` | yes | Card heading. |
| `summary` | yes | One sentence, shown on the card. |
| `tags` | yes | `[a, b]` or a `-` list. Drives the filter chips. |
| `model` | no | Free text, e.g. `claude-opus-5`. Feeds the model count. |
| `technique` | no | Shown in the detail panel. |
| `updated` | no | `YYYY-MM-DD`. Also the sort key. |
| `featured` | no | `true` pins it to the front of the list. |
| `slug` | no | Defaults to the filename. Changing it breaks existing links. |

Files beginning with `_` are ignored, which is why `_TEMPLATE.md` never appears
on the site.

### The `prompt` block

The copy button copies the first <code>```prompt</code> fenced block. If a file
has none, the whole body is treated as the prompt. Keeping the copyable text in
its own block is what lets you write intent and notes around it without them
ending up on someone's clipboard.

### Validation

`node scripts/build.mjs` fails loudly on a missing required field, an empty
body, a duplicate slug, or unparseable front matter, and prints
`prompts/file.md:line — reason`. CI runs the same build on pull requests, so a
malformed prompt fails the check rather than shipping quietly.

---

## How it is put together

```
prompts/            markdown source — the actual content
web/                static site source, copied verbatim into the build
  assets/           css + js
  vendor/           pinned copies of the animation libraries
scripts/build.mjs   prompts/*.md -> _site/prompts.json, plus copies web/
scripts/serve.mjs   local static server
scripts/new-prompt.mjs
.github/workflows/  build + deploy
.claude/skills/     vendored agent skills (see below)
_site/              build output (gitignored)
```

The build has no dependencies — front-matter parsing and markdown rendering are
both in `scripts/build.mjs`, in about 250 lines. The markdown subset covers
headings, lists, fenced and inline code, blockquotes, links, emphasis and rules;
it does not do tables or footnotes.

Everything the browser loads is same-origin. Asset paths are relative, so the
site works from the `/prompt-engineer/` sub-path Pages serves it on.

### Motion

Three libraries, kept on strictly separate properties so they never overwrite
each other. The full contract is in the header comment of
`web/assets/js/motion.js`.

| Library | Owns |
|---|---|
| [StringTune](https://string-tune.fiddle.digital) 1.2.2 | `string`/`string-…` attributes: parallax orbs, headline split, magnetic buttons, card tilt. Writes `--tilt-*` and `--magnetic-*`. |
| [GSAP](https://gsap.com) + ScrollTrigger 3.15.0 | Scroll reveals and the hero timeline. Owns `opacity`/`y` on `[data-reveal]` and `.card`. |
| [Anime.js](https://animejs.com) 4.5.0 | Counters, copy confirmation, detail panel, toast. |

They are vendored into `web/vendor/` rather than loaded from a CDN — see
[`web/vendor/README.md`](web/vendor/README.md) for versions, licences and how to
upgrade. StringTune is deliberately left in its default scroll mode; its
`smooth` mode transforms a scroll container and would desynchronise
ScrollTrigger.

`prefers-reduced-motion: reduce` disables all of it and hides the orbs. The page
is fully readable with JavaScript off or broken — reveal targets are only hidden
once the motion layer confirms it is going to animate them.

### Interface behaviour

- Search and tag filters are mirrored into the query string, so a filtered view
  can be linked and reloaded. The detail panel is a `#/p/<slug>` hash route.
- `/` focuses search, `Escape` closes the panel, focus is trapped inside it
  while open and restored on close.
- Theme follows the system setting and is overridable; the choice persists in
  `localStorage` and is applied before first paint.

---

## Agent skills

`.claude/skills/` contains nine vendored third-party skills, committed so any
clone and any Claude Code session picks them up without a setup step:
`find-skills`, `web-design-guidelines`, `vercel-composition-patterns`,
`frontend-design`, `emil-design-eng`, `impeccable`, `ponytail`,
`karpathy-guidelines`, `ui-ux-pro-max`.

Sources, pinned commits, licences and update instructions are in
[`.claude/skills/PROVENANCE.md`](.claude/skills/PROVENANCE.md).

---

## Licence

Prompts and site code: MIT (see `LICENSE`). Vendored libraries and skills keep
their own licences, recorded alongside them.
