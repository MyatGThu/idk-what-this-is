// Cross-browser WebExtension API shim.
//
// Firefox exposes a promise-based `browser.*`; Chromium exposes callback-based
// `chrome.*` (promise-based for most APIs since MV3, but not uniformly across
// older Chromium forks). `ext` normalizes the small API surface this extension
// uses to promises on every browser.
//
// Usable from ES modules (background, popup, options, paywall). Content scripts
// have their own tiny inline shim because they cannot import modules.

const api =
  typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null;

function promisify(fn, thisArg) {
  return (...args) =>
    new Promise((resolve, reject) => {
      try {
        const maybe = fn.call(thisArg, ...args, (result) => {
          const err = api.runtime && api.runtime.lastError;
          if (err) reject(new Error(err.message));
          else resolve(result);
        });
        // Firefox (and newer Chromium) returns a promise and ignores the
        // trailing callback argument only in some APIs; if we got a promise,
        // prefer it.
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(resolve, reject);
        }
      } catch (e) {
        reject(e);
      }
    });
}

const isPromiseNative = typeof browser !== 'undefined';

function wrap(ns, names) {
  const out = {};
  for (const name of names) {
    if (!ns || typeof ns[name] !== 'function') continue;
    out[name] = isPromiseNative ? ns[name].bind(ns) : promisify(ns[name], ns);
  }
  return out;
}

function buildExt() {
  if (!api) {
    // Node (unit tests) or another non-extension context: importing this module
    // must not throw; any actual API call will fail loudly instead.
    return {
      raw: null,
      storage: { local: {}, onChanged: null },
      runtime: {},
      tabs: {},
      scripting: {},
      action: null,
      alarms: null,
    };
  }
  return {
    raw: api,

    storage: {
      local: wrap(api.storage && api.storage.local, ['get', 'set', 'remove', 'clear']),
      onChanged: api.storage ? api.storage.onChanged : null,
    },

    runtime: {
      id: api.runtime.id,
      getURL: (path) => api.runtime.getURL(path),
      sendMessage: isPromiseNative
        ? api.runtime.sendMessage.bind(api.runtime)
        : promisify(api.runtime.sendMessage, api.runtime),
      onMessage: api.runtime.onMessage,
      onInstalled: api.runtime.onInstalled,
      openOptionsPage: wrap(api.runtime, ['openOptionsPage']).openOptionsPage,
    },

    tabs: {
      ...wrap(api.tabs, ['create', 'remove', 'update', 'get', 'query']),
      sendMessage: isPromiseNative
        ? api.tabs.sendMessage.bind(api.tabs)
        : promisify(api.tabs.sendMessage, api.tabs),
      onUpdated: api.tabs.onUpdated,
      onRemoved: api.tabs.onRemoved,
    },

    scripting: wrap(api.scripting, ['executeScript']),

    action: api.action || api.browserAction || null,

    alarms: api.alarms
      ? { ...wrap(api.alarms, ['create', 'clear']), onAlarm: api.alarms.onAlarm }
      : null,
  };
}

export const ext = buildExt();

/**
 * Await a tab reaching status 'complete', with a timeout.
 * @param {number} tabId
 * @param {number} timeoutMs
 */
export function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      ext.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      fn(arg);
    };
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish(resolve);
    };
    const timer = setTimeout(
      () => finish(reject, new Error(`Tab ${tabId} did not finish loading in ${timeoutMs}ms`)),
      timeoutMs,
    );
    ext.tabs.onUpdated.addListener(listener);
    // The tab may already be complete before the listener attaches.
    ext.tabs.get(tabId).then(
      (tab) => {
        if (tab && tab.status === 'complete') finish(resolve);
      },
      () => {},
    );
  });
}
