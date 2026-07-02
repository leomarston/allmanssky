// Toast + discovery-banner layer. Listens on the global event bus:
//   'notify'        { text, icon?, tone? }   tone: 'info'|'good'|'warn'|'danger'
//   'discovery:new' { kind, name, value }    queued center-top banners
import { events } from '../core/events.js';
import { el, iconSVG } from './widgets.js';

const TONE_ICONS = { info: 'scan', good: 'lumens', warn: 'hazard', danger: 'hazard' };

let _stack = null;
let _bannerHost = null;
let _queue = [];
let _bannerLive = false;
let _offs = [];
let _opts = { toastMs: 4000, bannerMs: 3500, maxToasts: 5 };

function toast({ text, icon, tone = 'info' } = {}) {
  if (!_stack || !text) return;
  const t = el('div', `ams-toast ams-panel tone-${tone}`, _stack);
  t.appendChild(iconSVG(icon || TONE_ICONS[tone] || 'scan'));
  const span = el('span', '', t);
  span.textContent = text;
  while (_stack.children.length > _opts.maxToasts) _stack.firstChild.remove();
  const kill = () => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 400);
  };
  t.__timer = setTimeout(kill, _opts.toastMs);
}

function discovery(d) {
  _queue.push(d);
  if (!_bannerLive) nextBanner();
}

function nextBanner() {
  const d = _queue.shift();
  if (!d) { _bannerLive = false; return; }
  _bannerLive = true;
  const b = el('div', 'ams-discovery ams-panel', _bannerHost);
  const kicker = el('div', 'kicker', b);
  kicker.textContent = `— New Discovery · ${d.kind || 'anomaly'} —`;
  const name = el('div', 'name', b);
  name.textContent = d.name || 'Unknown Signal';
  const worth = el('div', 'worth', b);
  worth.innerHTML = d.value != null
    ? `scanner upload · <b>+${Math.round(d.value).toLocaleString('en-US')} ⌾</b>`
    : 'scanner upload · logged';
  const track = el('div', 'sweep-track', b);
  el('div', 'sweep', track);
  setTimeout(() => {
    b.classList.add('out');
    setTimeout(() => { b.remove(); nextBanner(); }, 450);
  }, _opts.bannerMs);
}

/**
 * Mount the notification layer and subscribe to bus events.
 * @param {HTMLElement} uiRoot the #ui-root overlay element
 * @param {{toastMs?: number, bannerMs?: number}} [opts] timing overrides (tests)
 * @returns {{dispose(): void}}
 */
export function init(uiRoot, opts = {}) {
  dispose();
  Object.assign(_opts, opts);
  _stack = el('div', 'ams-toast-stack', uiRoot);
  _bannerHost = el('div', '', uiRoot);
  _bannerHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  _offs = [
    events.on('notify', toast),
    events.on('discovery:new', discovery),
  ];
  return { dispose };
}

/** Unsubscribe and remove all DOM. */
export function dispose() {
  for (const off of _offs) off();
  _offs = [];
  _stack?.remove();
  _bannerHost?.remove();
  _stack = _bannerHost = null;
  _queue = [];
  _bannerLive = false;
}
