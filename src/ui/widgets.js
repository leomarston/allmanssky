// Small DOM building blocks shared by all UI modules: element factory,
// stat bars with smooth transitions and low-value alarm state, and an
// inline stroke-based SVG icon set (currentColor, 24x24 viewBox).

/**
 * Create an element, optionally with a class and parent.
 * @param {string} tag
 * @param {string} [cls] space-separated class list
 * @param {HTMLElement} [parent] appended if given
 * @returns {HTMLElement}
 */
export function el(tag, cls, parent) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * Labeled stat bar with glow fill, smooth width transitions and a pulsing
 * red alarm state when the value drops below 25%.
 * @param {string} label uppercase caption (e.g. 'HEALTH')
 * @param {string} colorVar CSS var name for the fill color (e.g. '--ui-green')
 * @returns {{root: HTMLElement, set(v01: number, text?: string): void}}
 */
export function statBar(label, colorVar) {
  const root = el('div', 'ams-bar');
  const head = el('div', 'ams-bar-head', root);
  const lab = el('div', 'ams-label', head);
  lab.textContent = label;
  const value = el('div', 'ams-bar-value ams-value', head);
  const track = el('div', 'ams-bar-track', root);
  const fill = el('div', 'ams-bar-fill', track);
  fill.style.color = `var(${colorVar})`;

  let lastW = -1;
  let lastText = null;
  let lastLow = null;
  return {
    root,
    set(v01, text) {
      const v = Math.max(0, Math.min(1, v01 ?? 0));
      const w = Math.round(v * 1000) / 10; // 0.1% granularity — cheap change gate
      if (w !== lastW) {
        lastW = w;
        fill.style.width = `${w}%`;
      }
      const t = text ?? `${Math.round(v * 100)}`;
      if (t !== lastText) {
        lastText = t;
        value.textContent = t;
      }
      const low = v < 0.25;
      if (low !== lastLow) {
        lastLow = low;
        root.classList.toggle('is-low', low);
      }
    },
  };
}

// -- icon set -----------------------------------------------------------------
// Stroke-based, drawn on a 24x24 grid, colored via currentColor.
const S = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  health: `<path ${S} d="M12 20c-5-3.4-8-6.4-8-10a4.2 4.2 0 0 1 8-1.8A4.2 4.2 0 0 1 20 10c0 3.6-3 6.6-8 10z"/>`,
  shield: `<path ${S} d="M12 3l7 2.6v5.2c0 4.6-3 8.1-7 10.2-4-2.1-7-5.6-7-10.2V5.6z"/><path ${S} d="M12 7v6"/>`,
  o2: `<circle ${S} cx="10" cy="13" r="5.4"/><circle ${S} cx="17.4" cy="7.2" r="2.6"/><path ${S} d="M10 10.6v4.8M8 13h4"/>`,
  energy: `<path ${S} d="M13 2.6L5.4 13.4h5L10.6 21.4l7.8-10.8h-5z"/>`,
  jetpack: `<path ${S} d="M12 3c2.2 2.4 3 4.8 3 7.4 0 2-.8 3.6-3 3.6s-3-1.6-3-3.6C9 7.8 9.8 5.4 12 3z"/><path ${S} d="M9.4 17.4L8 20.6M14.6 17.4L16 20.6M12 16.4V21"/>`,
  lumens: `<path ${S} d="M12 4l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>`,
  cargo: `<path ${S} d="M4.5 8l7.5-4 7.5 4v8L12 20l-7.5-4z"/><path ${S} d="M4.5 8L12 12l7.5-4M12 12v8"/>`,
  warp: `<circle ${S} cx="12" cy="12" r="2"/><path ${S} d="M12 4a8 8 0 0 1 8 8M12 20a8 8 0 0 1-8-8"/><path ${S} d="M17.5 3.9l2.5.1-.1 2.5M6.5 20.1L4 20l.1-2.5"/>`,
  scan: `<circle ${S} cx="12" cy="12" r="8"/><path ${S} d="M12 12L17 7.5"/><path ${S} d="M12 6.4A5.6 5.6 0 0 1 17.6 12" opacity=".55"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>`,
  temp: `<path ${S} d="M10.4 4.5a1.9 1.9 0 0 1 3.8 0v8.2a4 4 0 1 1-3.8 0z"/><path ${S} d="M12.3 8.5v6.5"/><circle cx="12.3" cy="16.7" r="1.5" fill="currentColor"/>`,
  rad: `<circle cx="12" cy="12" r="1.6" fill="currentColor"/><path ${S} d="M12 9.4V3.6M9.8 13.4l-5 3M14.2 13.4l5 3"/><path ${S} d="M8.4 5.6a7.4 7.4 0 0 1 7.2 0M3.9 17a7.4 7.4 0 0 1-.5-7M20.1 17a7.4 7.4 0 0 0 .5-7" opacity=".6"/>`,
  tox: `<path ${S} d="M12 3.4C15 7 17 9.8 17 13a5 5 0 0 1-10 0c0-3.2 2-6 5-9.6z"/><circle ${S} cx="10.6" cy="12.4" r="1.1"/><circle ${S} cx="13.8" cy="14.8" r="1.4"/>`,
  compass: `<circle ${S} cx="12" cy="12" r="8.4"/><path ${S} d="M15.2 8.8l-2 5-3.2 1.4 2-5z"/><path ${S} d="M12 3.6v1.6M12 18.8v1.6M3.6 12h1.6M18.8 12h1.6" opacity=".6"/>`,
  fuel: `<path ${S} d="M6 20V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14M6 20h8M6 11h8"/><path ${S} d="M14 9h1.8a1.6 1.6 0 0 1 1.6 1.6v5.2a1.3 1.3 0 1 0 2.6 0V8.6L17.6 6"/>`,
  speed: `<path ${S} d="M4.5 15.5a8 8 0 1 1 15 0"/><path ${S} d="M12 15.3l3.6-5.4"/><circle cx="12" cy="15.3" r="1.4" fill="currentColor"/>`,
  altitude: `<path ${S} d="M3.6 18.4L9 8.8l3.4 5.6 2.2-3 5.8 7z"/><path ${S} d="M18 3.4v5M16 5.2l2-1.8 2 1.8"/>`,
  target: `<circle ${S} cx="12" cy="12" r="6.4"/><path ${S} d="M12 2.8v3.4M12 17.8v3.4M2.8 12h3.4M17.8 12h3.4"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/>`,
  quest: `<path ${S} d="M6 3.6h12v16.8l-6-3.6-6 3.6z"/><path ${S} d="M9.5 9.5h5"/>`,
  build: `<path ${S} d="M14.5 4.2a4.6 4.6 0 0 0-5.9 5.9L3.4 15.3a1.9 1.9 0 0 0 0 2.7l2.6 2.6a1.9 1.9 0 0 0 2.7 0l5.2-5.2a4.6 4.6 0 0 0 5.9-5.9l-3.2 3.2-2.8-.7-.7-2.8z"/>`,
  hazard: `<path ${S} d="M12 3.8L21 19.4H3z"/><path ${S} d="M12 9.6v4.4"/><circle cx="12" cy="16.6" r="1.1" fill="currentColor"/>`,
};
// aliases used around the codebase
ICONS.oxygen = ICONS.o2;
ICONS.heat = ICONS.temp;
ICONS.cold = ICONS.temp;
ICONS.radiation = ICONS.rad;
ICONS.toxic = ICONS.tox;
ICONS.info = ICONS.scan;

/**
 * Inline SVG icon (stroke-based, inherits currentColor).
 * Known names: health shield o2 energy jetpack lumens cargo warp scan temp
 * rad tox compass fuel speed altitude target quest build hazard (+aliases).
 * @param {string} name
 * @returns {SVGElement}
 */
export function iconSVG(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || ICONS.hazard;
  return svg;
}
