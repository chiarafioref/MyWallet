// Icon set (inline SVG, 24x24 stroke style). No external dependency: icons are
// SVG strings using currentColor.
//   icon("pencil")             -> <svg> string
//   iconEl("pencil", { size }) -> DOM node

const PATHS = {
  // navigation
  dashboard:
    '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  transactions:
    '<path d="M8 3 4 7l4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/>',
  sparkles:
    '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4Z"/><path d="M19 14l.7 1.8L21 16l-1.3.5L19 18l-.7-1.5L17 16l1.3-.2Z"/><path d="M5 4l.7 1.8L7 6l-1.3.5L5 8l-.7-1.5L3 6l1.3-.2Z"/>',
  chart:
    '<path d="M3 3v18h18"/><path d="M8 17V10"/><path d="M13 17V5"/><path d="M18 17v-4"/>',
  analysis:
    '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h.01"/><path d="M13 12h3"/><path d="M9 16h.01"/><path d="M13 16h3"/>',
  wallet:
    '<path d="M19 7V5.5A2.5 2.5 0 0 0 16.5 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2H6"/><path d="M16 12h.01"/>',
  repeat:
    '<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  savings:
    '<path d="M19 6c-.6-1.2-1.8-2-3-2-3.5-1.3-13-.4-13 6 0 2 .8 3.5 2 4.7V19h4v-2h3v2h4v-3c.9-.7 1.6-1.6 2-2.7h2V9h-2c-.2-1.2-.9-2.2-1.9-3Z"/><path d="M2 10v1a2 2 0 0 0 2 2h1"/><path d="M15 8h.01"/>',
  plane:
    '<path d="M17.8 19.2 16 11l3.5-3.5c1.3-1.3 1.7-3 1-4-.9-.7-2.7-.3-4 1L13 8 4.9 6.3c-.4-.1-.8 0-1 .4l-.3.5c-.2.4-.1.9.3 1.1L8 12l-2 3H3.5l-1 1 3 2 2 3 1-1v-2.5l3-2 3.5 4.5c.3.3.7.5 1.1.3l.5-.3c.4-.2.5-.6.4-1Z"/>',
  calendar:
    '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',

  // actions
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  pencil:
    '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash:
    '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  close: '<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy:
    '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  search:
    '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  filter: '<path d="M22 3H2l8 9.5V21l4-2v-6.5Z"/>',
  menu: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/>',
  logout:
    '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  chevronRight: '<path d="M9 18l6-6-6-6"/>',
  chevronDown: '<path d="M6 9l6 6 6-6"/>',
  arrowUp: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  arrowDown: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  swap: '<path d="M17 3l4 4-4 4"/><path d="M21 7H3"/><path d="M7 21l-4-4 4-4"/><path d="M3 17h18"/>',
  fileText:
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h8"/><path d="M8 9h2"/>',

  // status / feedback
  sun:
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 19.1l1.4-1.4"/><path d="M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M12 3a6.4 6.4 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  alert:
    '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  lightbulb:
    '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.1 14c.2-1 .7-1.8 1.4-2.5A4.7 4.7 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.2 1.5 1.4 2.5"/>',
  receipt:
    '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1Z"/><path d="M8 7h8"/><path d="M8 11h8"/><path d="M8 15h5"/>',
  trophy:
    '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.7V17c0 .6-.5 1-1 1.2C7.9 18.8 7 20.2 7 22"/><path d="M14 14.7V17c0 .6.5 1 1 1.2 1.1.6 2 2 2 4.8"/><path d="M18 2H6v7a6 6 0 0 0 12 0Z"/>',
  target:
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  creditCard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  banknote:
    '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01"/><path d="M18 12h.01"/>',
  bell:
    '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  trendingUp: '<path d="M22 7 13.5 15.5 8.5 10.5 2 17"/><path d="M16 7h6v6"/>',
  trendingDown: '<path d="M22 17 13.5 8.5 8.5 13.5 2 7"/><path d="M16 17h6v-6"/>',
  key:
    '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 20 3"/><path d="M17 6l3 3"/><path d="M15 8l2 2"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1A4 4 0 0 1 16 11"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1Z"/><path d="M4 22v-7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  eyeOff:
    '<path d="M10.7 5.1A9.8 9.8 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7"/><path d="M6.6 6.6A13.3 13.3 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="M2 2l20 20"/>',
};

export function icon(name, { size = 20, stroke = 1.9, cls = "" } = {}) {
  const body = PATHS[name];
  if (!body) return "";
  return (
    `<svg class="icn${cls ? " " + cls : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

export function iconEl(name, opts) {
  const span = document.createElement("span");
  span.className = "icn-wrap";
  span.innerHTML = icon(name, opts);
  return span;
}

// Brand mark (filled, not stroke).
export function brandMark(size = 26) {
  return (
    `<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 32 32" fill="none" aria-hidden="true">` +
    `<rect x="3" y="6" width="26" height="20" rx="6" fill="currentColor" opacity="0.16"/>` +
    `<path d="M4 12a6 6 0 0 1 6-6h11l7 7v7a6 6 0 0 1-6 6H10a6 6 0 0 1-6-6Z" stroke="currentColor" stroke-width="2.4"/>` +
    `<circle cx="22" cy="17" r="2.4" fill="currentColor"/>` +
    `</svg>`
  );
}
