# Installed skills

Vendored copies of third-party [Agent Skills](https://code.claude.com/docs/en/skills).
They live in the repo (rather than `~/.claude/skills/`) so every clone and every
Claude Code session gets them without a setup step.

Each skill is a plain directory with a `SKILL.md`; Claude Code loads them
automatically from `.claude/skills/`.

| Skill | Source repo | Path in source | Pinned commit | License |
|---|---|---|---|---|
| `find-skills` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | `skills/find-skills` | `7cb7db6` | MIT |
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `skills/web-design-guidelines` | `7c180d9` | none declared ⚠️ |
| `vercel-composition-patterns` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) | `skills/composition-patterns` | `7c180d9` | none declared ⚠️ |
| `frontend-design` | [vercel-labs/open-agents](https://github.com/vercel-labs/open-agents) | `.agents/skills/frontend-design` | `cf865e9` | MIT |
| `emil-design-eng` | [emilkowalski/skills](https://github.com/emilkowalski/skills) | `skills/emil-design-eng` | `70744e3` | MIT |
| `impeccable` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) | `.claude/skills/impeccable` | `9a949fb` | Apache-2.0 |
| `ponytail` | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) | `skills/ponytail` | `16f2980` | MIT |
| `karpathy-guidelines` | [swarmclawai/andrej-karpathy-skills](https://github.com/swarmclawai/andrej-karpathy-skills) | `skills/karpathy-guidelines` | `29b8bc1` | MIT |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | `.claude/skills/ui-ux-pro-max` | `4857a2c` | MIT |

⚠️ `vercel-labs/agent-skills` ships no `LICENSE` file. The two skills taken from it
are public and intended for exactly this use, but strictly speaking they are
"all rights reserved". Remove them if that matters for your project.

## Sourcing notes

`web-design-guidelines` and `vercel-composition-patterns` are the only two of the
nine that Vercel actually publishes. The rest are community skills that Vercel's
ecosystem points at — `frontend-design` and `emil-design-eng` come from Vercel Labs'
`open-agents` and from Emil Kowalski (the author) respectively, and the remaining
four are independent projects.

`composition-patterns` was installed under the name `vercel-composition-patterns`
to match what the upstream registry calls it; the directory name and the `name:`
field in its `SKILL.md` agree, which is what Claude Code requires.

## Updating

The registry at `skills.sh` is not reachable from every network, so update
straight from git:

```bash
git clone --depth 1 https://github.com/<owner>/<repo> /tmp/src
rm -rf .claude/skills/<skill>
cp -R /tmp/src/<path-in-source> .claude/skills/<skill>
```

Where the `skills` CLI is reachable, `npx skills add <owner>/<repo>` does the
same thing and writes a `skills-lock.json`.
