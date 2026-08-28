// Paywall page: starts Stripe Checkout via the background, or activates an
// existing license token. All backend interaction goes through the message
// protocol in docs/ARCHITECTURE.md.

import { ext } from '../common/compat.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIVATION_POLL_MS = 5000;
const ACTIVATION_POLL_LIMIT = 120; // ~10 minutes of waiting for the webhook

const $ = (id) => document.getElementById(id);

// Only the newest checkout attempt keeps polling for activation.
let activationGeneration = 0;

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
  if (res.devToken) {
    setFeedback(feedback, 'Dev license activated — you are all set.', 'success');
    await refreshLicenseStatus();
    return;
  }
  if (res.url) {
    ext.tabs.create({ url: res.url }).catch(() => {});
    setFeedback(
      feedback,
      'Stripe Checkout opened in a new tab. Complete the payment there — ' +
        'this page will activate your license automatically.',
      'success',
    );
    if (res.token) {
      // Keep the token visible so activation also works manually / later.
      const tokenInput = $('token-input');
      if (tokenInput && !tokenInput.value) tokenInput.value = res.token;
      void pollForActivation(res.token, feedback);
    }
    return;
  }
  setFeedback(feedback, 'The licensing server did not return a checkout link.', 'error');
}

/**
 * After Stripe Checkout starts, keep asking the background to activate the
 * pending token; it succeeds as soon as the webhook confirms payment.
 * @param {string} token
 * @param {HTMLElement} feedback
 */
async function pollForActivation(token, feedback) {
  const generation = ++activationGeneration;
  for (let i = 0; i < ACTIVATION_POLL_LIMIT; i++) {
    await new Promise((resolve) => setTimeout(resolve, ACTIVATION_POLL_MS));
    if (generation !== activationGeneration) return;
    const res = await send({ type: 'ACTIVATE_LICENSE', token });
    if (generation !== activationGeneration) return;
    if (res.ok) {
      setFeedback(feedback, 'Payment confirmed — your subscription is active.', 'success');
      await refreshLicenseStatus();
      return;
    }
  }
  setFeedback(
    feedback,
    'Still waiting for payment confirmation. If you completed checkout, keep this token safe ' +
      'and press Activate below once your payment settles.',
    'error',
  );
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
