# Vendored libraries

Pinned browser builds, committed rather than loaded from a CDN. That keeps the
site working offline, removes a third-party runtime dependency, and means a CDN
outage or a silent upstream republish cannot change what visitors get.

| Library | Version | File | Global | License |
|---|---|---|---|---|
| [GSAP](https://gsap.com) | 3.15.0 | `gsap/gsap.min.js` | `gsap` | [GreenSock standard "no charge"](https://gsap.com/standard-license) |
| [GSAP ScrollTrigger](https://gsap.com/docs/v3/Plugins/ScrollTrigger/) | 3.15.0 | `gsap/ScrollTrigger.min.js` | `ScrollTrigger` | as above |
| [Anime.js](https://animejs.com) | 4.5.0 | `animejs/anime.umd.min.js` | `anime` | MIT |
| [StringTune](https://string-tune.fiddle.digital) | 1.2.2 | `string-tune/string-tune.js` | `StringTune` | MIT |

Roughly 750 KB uncompressed, ~200 KB over the wire once GitHub Pages gzips it.
StringTune is most of that; it ships as a single bundle with no subset build.

## How they are used

They are kept on separate properties so they never overwrite each other — see
the header comment in `../assets/js/motion.js`.

- **StringTune** — declarative `string-*` attributes in the markup. Owns the
  parallax orbs plus the `--tilt-*` and `--magnetic-*` custom properties the
  stylesheet reads. Left in its default scroll mode deliberately: its `smooth`
  mode transforms a scroll container, which would desynchronise ScrollTrigger.
- **GSAP + ScrollTrigger** — scroll-triggered reveals and the hero timeline.
  Owns `opacity`/`y` on `[data-reveal]` and on `.card`, never on `.card__inner`.
- **Anime.js** — discrete feedback: stat counters, copy confirmation, the
  detail sheet transition, the toast.

## Updating

```bash
npm pack gsap@<version>      # then copy dist/gsap.min.js + dist/ScrollTrigger.min.js
npm pack animejs@<version>   # then copy dist/bundles/anime.umd.min.js
npm pack @fiddle-digital/string-tune@<version>   # then copy dist/index.js
```

StringTune ships a `//# sourceMappingURL` comment pointing at a map that is not
vendored; strip that last line when updating, or devtools will 404 on it.

Check the globals after any upgrade — Anime.js v4 exposes named exports on
`anime` (`anime.animate`, `anime.stagger`), which is not the v3 API, and
StringTune's bundle is an IIFE that assigns a namespace object, so the class
itself is `StringTune.StringTune`.
