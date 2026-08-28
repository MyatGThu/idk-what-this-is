// Paywall page: starts Stripe Checkout via the background, or activates an
// existing license token. All backend interaction goes through the message
// protocol in docs/ARCHITECTURE.md.

import { ext } from '../common/compat.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const $ = (id) => document.getElementById(id);

/**
 * sendMessage that never throws: failures collapse to the protocol shape.
 * @param {{type: string}} message
 * @returns {Promise<{ok: boolean, error?: string, code?: string, [k: string]: *}>}
 */
async function send(message) {
  try {
    const res = await ext.runtime.sendMessage(message);
    if (!res || typeof res.ok !== 'boolean') {
      return { ok: false, error: 'No response from the extension background.' };
    }
    return res;
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

/** @param {HTMLElement} node @param {string} text @param {'error'|'success'|''} [tone] */
function setFeedback(node, text, tone = '') {
  node.textContent = text;
  node.className = `feedback${tone ? ` ${tone}` : ''}`;
}

async function refreshLicenseStatus() {
  const banner = $('license-status');
  const res = await send({ type: 'GET_LICENSE' });
  if (res.ok && res.license && res.license.status === 'active') {
    banner.hidden = false;
    banner.textContent = 'Your subscription is active — you are all set.';
  } else {
    banner.hidden = true;
    banner.textContent = '';
  }
}

async function startCheckout() {
  const button = $('subscribe-button');
  const feedback = $('subscribe-feedback');
  const email = $('email-input').value.trim();

  if (!EMAIL_RE.test(email)) {
    setFeedback(feedback, 'Enter a valid email address first.', 'error');
    return;
  }

  button.disabled = true;
  setFeedback(feedback, 'Contacting the licensing server…');
  const res = await send({ type: 'START_CHECKOUT', email });
  button.disabled = false;

  if (!res.ok) {
    setFeedback(feedback, res.error || 'Could not start checkout. Try again shortly.', 'error');
    return;
  }
  if (res.url) {
    ext.tabs.create({ url: res.url }).catch(() => {});
    setFeedback(
      feedback,
      'Stripe Checkout opened in a new tab. After paying, activate with the token from your receipt email.',
      'success',
    );
    return;
  }
  if (res.devToken) {
    setFeedback(feedback, 'Dev license activated.', 'success');
    await refreshLicenseStatus();
    return;
  }
  setFeedback(feedback, 'The licensing server did not return a checkout link.', 'error');
}

async function activateLicense() {
  const button = $('activate-button');
  const feedback = $('activate-feedback');
  const token = $('token-input').value.trim();

  if (!token) {
    setFeedback(feedback, 'Paste your license token first.', 'error');
    return;
  }

  button.disabled = true;
  setFeedback(feedback, 'Verifying your license…');
  const res = await send({ type: 'ACTIVATE_LICENSE', token });
  button.disabled = false;

  if (!res.ok) {
    setFeedback(feedback, res.error || 'That token could not be verified.', 'error');
    return;
  }
  setFeedback(feedback, 'License activated — you are all set.', 'success');
  await refreshLicenseStatus();
}

function init() {
  $('subscribe-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void startCheckout();
  });
  $('activate-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void activateLicense();
  });
  $('options-link').addEventListener('click', () => {
    if (ext.runtime.openOptionsPage) ext.runtime.openOptionsPage().catch(() => {});
  });
  void refreshLicenseStatus();
}

init();
