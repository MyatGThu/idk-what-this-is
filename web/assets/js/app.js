/* prompt-engineer — data, filtering and routing.
   Motion lives in motion.js and hooks in through the events dispatched here. */

(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  const el = {
    grid: $('#grid'),
    empty: $('#empty'),
    search: $('#search'),
    tagFilters: $('#tagFilters'),
    resultCount: $('#resultCount'),
    clearFilters: $('#clearFilters'),
    template: $('#cardTemplate'),
    toast: $('#toast'),
    themeToggle: $('#themeToggle'),
    header: $('#siteHeader'),
    repoLink: $('#repoLink'),
    sheet: $('#sheet'),
    sheetPanel: $('.sheet__panel'),
    sheetScrim: $('#sheetScrim'),
    sheetClose: $('#sheetClose'),
    sheetTitle: $('#sheetTitle'),
    sheetEyebrow: $('#sheetEyebrow'),
    sheetBody: $('#sheetBody'),
    sheetCopy: $('#sheetCopy'),
    sheetSource: $('#sheetSource'),
    stats: {
      prompts: $('#statPrompts'),
      tags: $('#statTags'),
      models: $('#statModels'),
    },
  };

  const state = {
    prompts: [],
    tags: [],
    models: [],
    query: '',
    activeTags: new Set(),
    lastFocus: null,
  };

  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));

  /* ---------------------------------------------------------------- repo -- */

  /**
   * github.io project pages live at <user>.github.io/<repo>/, which is enough
   * to reconstruct the repository URL without hardcoding it.
   */
  function repoUrl() {
    const { hostname, pathname } = location;
    const owner = hostname.endsWith('.github.io') ? hostname.replace('.github.io', '') : null;
    const repo = pathname.split('/').filter(Boolean)[0];
    return owner && repo ? `https://github.com/${owner}/${repo}` : null;
  }

  const REPO = repoUrl();
  if (REPO) {
    el.repoLink.href = REPO;
  } else {
    el.repoLink.hidden = true;
  }

  /* --------------------------------------------------------------- theme -- */

  el.themeToggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem('pe-theme', next);
    } catch (e) {
      /* private mode — the theme just will not persist */
    }
  });

  /* --------------------------------------------------------------- toast -- */

  let toastTimer;
  function toast(message) {
    el.toast.textContent = message;
    emit('pe:toast');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => emit('pe:toast-hide'), 1900);
  }

  async function copy(text, label = 'Prompt copied') {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
      return true;
    } catch (e) {
      // Clipboard API needs a secure context; fall back for file:// and http://
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      ta.remove();
      toast(ok ? label : 'Copy failed — select the text manually');
      return ok;
    }
  }

  /* ------------------------------------------------------------ filtering -- */

  function matches(prompt) {
    for (const tag of state.activeTags) {
      if (!prompt.tags.includes(tag)) return false;
    }
    if (!state.query) return true;

    const needle = state.query.toLowerCase();
    return (
      prompt.title.toLowerCase().includes(needle) ||
      prompt.summary.toLowerCase().includes(needle) ||
      prompt.prompt.toLowerCase().includes(needle) ||
      prompt.tags.some((t) => t.toLowerCase().includes(needle)) ||
      prompt.model.toLowerCase().includes(needle)
    );
  }

  function render() {
    const visible = state.prompts.filter(matches);

    el.grid.replaceChildren();
    for (const prompt of visible) el.grid.appendChild(card(prompt));

    el.empty.hidden = visible.length > 0;
    el.resultCount.textContent =
      visible.length === state.prompts.length
        ? `${state.prompts.length} prompts`
        : `${visible.length} of ${state.prompts.length}`;

    syncUrl();
    emit('pe:rendered', { cards: [...el.grid.children] });
  }

  function card(prompt) {
    const node = el.template.content.firstElementChild.cloneNode(true);
    node.dataset.slug = prompt.slug;

    node.querySelector('.card__title').textContent = prompt.title;
    node.querySelector('.card__summary').textContent = prompt.summary;
    node.querySelector('.card__model').textContent = prompt.model || '—';
    node.querySelector('.card__words').textContent = `${prompt.words} words`;

    const tags = node.querySelector('.card__tags');
    for (const tag of prompt.tags.slice(0, 4)) {
      const li = document.createElement('li');
      li.textContent = tag;
      tags.appendChild(li);
    }

    const link = node.querySelector('.card__link');
    link.href = `#/p/${prompt.slug}`;
    link.textContent = `Open ${prompt.title}`;

    node.querySelector('.card__copy').addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const button = event.currentTarget;
      if (await copy(prompt.prompt)) {
        button.dataset.copied = 'true';
        emit('pe:copied', { button });
        setTimeout(() => delete button.dataset.copied, 1400);
      }
    });

    return node;
  }

  function buildTagFilters() {
    el.tagFilters.replaceChildren();
    for (const { name, count } of state.tags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('aria-pressed', String(state.activeTags.has(name)));
      chip.innerHTML = `${escapeHtml(name)}<span class="chip__n">${count}</span>`;
      chip.addEventListener('click', () => {
        if (state.activeTags.has(name)) state.activeTags.delete(name);
        else state.activeTags.add(name);
        chip.setAttribute('aria-pressed', String(state.activeTags.has(name)));
        render();
      });
      el.tagFilters.appendChild(chip);
    }
  }

  const escapeHtml = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ----------------------------------------------------------- url state -- */

  /**
   * Search and tag filters live in the query string so a filtered view can be
   * linked, bookmarked and reloaded. The hash is left alone — it belongs to the
   * detail route.
   */
  function syncUrl() {
    const params = new URLSearchParams();
    if (state.query) params.set('q', state.query);
    for (const tag of state.activeTags) params.append('tag', tag);

    const search = params.toString();
    history.replaceState(null, '', location.pathname + (search ? `?${search}` : '') + location.hash);
  }

  function readUrlState() {
    const params = new URLSearchParams(location.search);
    state.query = params.get('q') || '';
    state.activeTags = new Set(params.getAll('tag'));
    if (state.query) el.search.value = state.query;
  }

  /** Dates are authored as plain YYYY-MM-DD; format them in UTC so the
   *  displayed day cannot drift by one in western timezones. */
  function formatDate(iso) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!parts) return '';
    const date = new Date(Date.UTC(+parts[1], +parts[2] - 1, +parts[3]));
    try {
      return new Intl.DateTimeFormat(navigator.language, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }).format(date);
    } catch (e) {
      return iso;
    }
  }

  /* --------------------------------------------------------------- sheet -- */

  function openSheet(slug) {
    const prompt = state.prompts.find((p) => p.slug === slug);
    if (!prompt) {
      closeSheet(true);
      return;
    }

    state.lastFocus = document.activeElement;

    const updated = formatDate(prompt.updated);
    el.sheetEyebrow.textContent =
      [prompt.model, prompt.technique, updated && `updated ${updated}`].filter(Boolean).join(' · ') || 'prompt';
    el.sheetTitle.textContent = prompt.title;
    el.sheetBody.innerHTML = prompt.html;
    el.sheetSource.href = REPO ? `${REPO}/blob/HEAD/${prompt.source}` : '#';
    el.sheetSource.hidden = !REPO;

    el.sheetCopy.onclick = async () => {
      if (await copy(prompt.prompt)) emit('pe:copied', { button: el.sheetCopy });
    };

    el.sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    el.sheetPanel.scrollTop = 0;
    el.sheetPanel.focus();
    emit('pe:sheet-open');
  }

  function closeSheet(silent = false) {
    if (el.sheet.hidden) return;
    el.sheet.hidden = true;
    document.body.style.overflow = '';
    if (!silent && state.lastFocus) state.lastFocus.focus();
    if (location.hash.startsWith('#/p/')) history.pushState(null, '', location.pathname + location.search);
  }

  el.sheetClose.addEventListener('click', () => closeSheet());
  el.sheetScrim.addEventListener('click', () => closeSheet());

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !el.sheet.hidden) {
      closeSheet();
      return;
    }
    // `/` focuses search, the way most docs sites behave
    if (event.key === '/' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) {
      event.preventDefault();
      el.search.focus();
      el.search.select();
    }
  });

  // Keep focus inside the dialog while it is open.
  el.sheetPanel.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusables = [...el.sheetPanel.querySelectorAll('a[href], button:not([disabled])')].filter(
      (n) => !n.hidden && n.offsetParent !== null,
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function route() {
    const match = location.hash.match(/^#\/p\/([\w-]+)$/);
    if (match) openSheet(match[1]);
    else closeSheet(true);
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);

  /* ---------------------------------------------------------------- boot -- */

  let searchTimer;
  el.search.addEventListener('input', (event) => {
    clearTimeout(searchTimer);
    const value = event.target.value.trim();
    searchTimer = setTimeout(() => {
      state.query = value;
      render();
    }, 110);
  });

  el.clearFilters.addEventListener('click', () => {
    state.query = '';
    state.activeTags.clear();
    el.search.value = '';
    el.tagFilters.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
    render();
  });

  const onScroll = () => {
    el.header.dataset.stuck = String(window.scrollY > 12);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  async function boot() {
    let data;
    try {
      const response = await fetch('prompts.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      data = await response.json();
    } catch (error) {
      el.grid.innerHTML =
        '<p class="empty">Could not load <code>prompts.json</code>. ' +
        'Run <code>npm run build</code> and serve <code>_site/</code> rather than opening the file directly.</p>';
      el.resultCount.textContent = '';
      console.error('[prompt-engineer]', error);
      return;
    }

    state.prompts = data.prompts || [];
    state.tags = data.tags || [];
    state.models = data.models || [];

    readUrlState();

    el.stats.prompts.dataset.count = state.prompts.length;
    el.stats.tags.dataset.count = state.tags.length;
    el.stats.models.dataset.count = state.models.length;

    buildTagFilters();
    render();
    route();

    emit('pe:ready', { state });
  }

  boot();
})();
