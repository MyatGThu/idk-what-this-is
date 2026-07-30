/* prompt-engineer — motion layer.
 *
 * Three libraries, deliberately separated so they never fight over the same
 * property on the same element:
 *
 *   StringTune  declarative scroll/pointer effects driven by `string` /
 *               `string-...` attributes. Owns .orb transforms and the
 *               --tilt- and --magnetic- custom properties.
 *   GSAP        scroll-triggered reveals. Owns opacity/y on [data-reveal]
 *               and on .card (the outer element — never .card__inner, which
 *               StringTune tilts).
 *   Anime.js    discrete UI feedback: counters, copy confirmation, the sheet
 *               transition, the toast.
 *
 * StringTune is left in its default scroll mode on purpose. Its `smooth` mode
 * transforms a scroll container, which would desynchronise ScrollTrigger
 * unless we also wired up a scrollerProxy.
 */

(() => {
  'use strict';

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof window.gsap !== 'undefined';
  const hasAnime = typeof window.anime !== 'undefined';
  const hasTune = typeof window.StringTune !== 'undefined';

  // Signals to CSS that reveal targets may start hidden. Without this the page
  // renders fully visible, which is the correct no-JS / reduced-motion result.
  if (!reduced && hasGsap) document.documentElement.dataset.motion = 'on';

  const anime = window.anime;

  /* ---------------------------------------------------------- StringTune -- */

  let tune = null;
  if (hasTune && !reduced) {
    const ST = window.StringTune;
    const Tune = ST.StringTune || ST.default;

    tune = Tune.getInstance();
    tune.use(ST.StringSplit);     // hero headline -> per-character spans
    tune.use(ST.StringParallax);  // background orbs
    tune.use(ST.StringMagnetic);  // primary buttons pull toward the cursor
    tune.use(ST.StringTilt);      // card hover tilt
    tune.start(60);
  }

  /* ---------------------------------------------------------------- GSAP -- */

  if (hasGsap && !reduced) {
    gsap.registerPlugin(ScrollTrigger);
    gsap.defaults({ ease: 'power3.out', duration: 0.75 });
  }

  function revealOnScroll(targets, options = {}) {
    if (!hasGsap || reduced || !targets.length) return;
    gsap.fromTo(
      targets,
      { opacity: 0, y: options.y ?? 22 },
      {
        opacity: 1,
        y: 0,
        stagger: options.stagger ?? 0.06,
        scrollTrigger: {
          trigger: options.trigger || targets[0],
          start: options.start || 'top 88%',
          once: true,
        },
      },
    );
  }

  /* --------------------------------------------------------------- intro -- */

  function playIntro() {
    if (!hasGsap || reduced) return;

    // StringSplit rewrites the headline during its own init pass, so read the
    // characters afterwards and fall back to the element if it did not run.
    const title = document.querySelector('.hero__title');
    const chars = title ? title.querySelectorAll('.-s-char') : [];
    const tl = gsap.timeline({ delay: 0.08 });

    // fromTo throughout, not from: [data-reveal] elements are opacity:0 in CSS,
    // so a plain from() would treat 0 as the destination and never show them.
    if (chars.length) {
      tl.fromTo(chars,
        { yPercent: 108, opacity: 0 },
        { yPercent: 0, opacity: 1, duration: 0.72, stagger: 0.012, ease: 'power4.out' });
    } else if (title) {
      tl.fromTo(title, { opacity: 0, y: 26 }, { opacity: 1, y: 0 });
    }

    tl.fromTo('.hero__eyebrow', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5 }, 0)
      // .hero__actions is itself a [data-reveal], so CSS holds it at opacity 0.
      // Reveal the container, then stagger the buttons inside it.
      .set('.hero__actions', { opacity: 1 }, 0)
      .fromTo('.hero__lede', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.6 }, '-=0.45')
      .fromTo('.hero__actions > *', { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: 0.08, duration: 0.5 }, '-=0.35')
      .fromTo('.stats .stat', { opacity: 0, y: 14 }, { opacity: 1, y: 0, stagger: 0.07, duration: 0.5 }, '-=0.3');
  }

  /* ------------------------------------------------------------ counters -- */

  function countUp(node) {
    const target = Number(node.dataset.count || 0);
    if (!hasAnime || reduced) {
      node.textContent = String(target);
      return;
    }
    const box = { value: 0 };
    anime.animate(box, {
      value: target,
      duration: 900,
      ease: 'outExpo',
      onUpdate: () => {
        node.textContent = String(Math.round(box.value));
      },
    });
  }

  /* --------------------------------------------------------------- cards -- */

  function animateCards(cards) {
    if (!cards.length) return;

    if (reduced || !hasAnime) {
      cards.forEach((c) => (c.style.opacity = '1'));
      return;
    }

    anime.animate(cards, {
      opacity: [0, 1],
      translateY: [14, 0],
      scale: [0.985, 1],
      duration: 520,
      delay: anime.stagger(26),
      ease: 'outQuart',
    });
  }

  /* --------------------------------------------------------------- events -- */

  document.addEventListener('pe:ready', ({ detail }) => {
    document.querySelectorAll('[data-count]').forEach(countUp);

    revealOnScroll([...document.querySelectorAll('.library .section-head, .workflow .section-head')], { y: 18 });
    revealOnScroll([...document.querySelectorAll('.step')], { trigger: '.steps', stagger: 0.08 });

    playIntro();

    // The grid is populated before this fires; animate whatever is on screen.
    animateCards([...document.querySelectorAll('#grid .card')]);

    if (hasGsap && !reduced) ScrollTrigger.refresh();
    void detail;
  });

  document.addEventListener('pe:rendered', ({ detail }) => {
    animateCards(detail.cards);
    // New cards carry string-tilt attributes; make StringTune pick them up.
    if (tune) tune.onRebuild();
    if (hasGsap && !reduced) ScrollTrigger.refresh();
  });

  document.addEventListener('pe:copied', ({ detail }) => {
    const button = detail.button;
    if (!button || !hasAnime || reduced) return;
    // Magnetic buttons already own their `transform` via --magnetic-*; bounce
    // their inner content instead so the two never overwrite each other.
    const magnetic = (button.getAttribute('string') || '').includes('magnetic');
    const target = magnetic ? button.querySelector('.btn__label') || button : button;
    anime.animate(target, {
      scale: [1, 0.86, 1.06, 1],
      duration: 460,
      ease: 'outBack',
    });
  });

  /* --------------------------------------------------------------- sheet -- */

  document.addEventListener('pe:sheet-open', () => {
    const scrim = document.querySelector('.sheet__scrim');
    const panel = document.querySelector('.sheet__panel');
    if (!hasAnime || reduced) {
      if (scrim) scrim.style.opacity = '1';
      return;
    }
    anime.animate(scrim, { opacity: [0, 1], duration: 260, ease: 'outQuad' });
    anime.animate(panel, { translateX: ['4%', '0%'], opacity: [0, 1], duration: 420, ease: 'outExpo' });
    anime.animate(panel.querySelectorAll('.sheet__head, .sheet__actions, .sheet__body > *'), {
      opacity: [0, 1],
      translateY: [10, 0],
      duration: 420,
      delay: anime.stagger(22, { start: 90 }),
      ease: 'outQuart',
    });
  });

  /* --------------------------------------------------------------- toast -- */

  document.addEventListener('pe:toast', () => {
    const toast = document.getElementById('toast');
    if (!hasAnime || reduced) {
      toast.style.cssText += ';transform:translateY(0);opacity:1';
      return;
    }
    anime.animate(toast, { translateY: ['140%', '0%'], opacity: [0, 1], duration: 420, ease: 'outExpo' });
  });

  document.addEventListener('pe:toast-hide', () => {
    const toast = document.getElementById('toast');
    if (!hasAnime || reduced) {
      toast.style.cssText += ';transform:translateY(140%);opacity:0';
      return;
    }
    anime.animate(toast, { translateY: ['0%', '140%'], opacity: [1, 0], duration: 320, ease: 'inQuad' });
  });
})();
