// Inline SVG icon set (24x24, stroke based) used across the interface.

const wrap = (body, opts = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${opts}>${body}</svg>`;

export const ICONS = {
  gold: wrap(`
    <circle cx="12" cy="12" r="8.2"/>
    <path d="M12 7.4v9.2M9.6 9.7h3.6a1.9 1.9 0 0 1 0 3.8H9.6"/>`),
  manpower: wrap(`
    <circle cx="9" cy="8.3" r="3"/>
    <path d="M3.4 19.2c.4-3.1 2.7-5 5.6-5s5.2 1.9 5.6 5"/>
    <path d="M16 5.6a3 3 0 0 1 0 5.6M17.6 14.4c2 .5 3.3 2.2 3.6 4.8"/>`),
  army: wrap(`
    <path d="M12 3.6 5 6.6v5.2c0 4 3 7.4 7 8.6 4-1.2 7-4.6 7-8.6V6.6z"/>
    <path d="m9.2 11.8 2 2 3.6-4"/>`),
  province: wrap(`
    <path d="M6 21V4.2l9 2.2V16l-9 2.2z"/>
    <path d="M15 6.4h3.4v9.4"/>`),
  city: wrap(`
    <path d="M4 20.4h16"/>
    <path d="M6 20.4V10l4-2.6V20.4M10 20.4V7.4l4-2.6v15.6M14 20.4v-7l4-2.2v9.6"/>
    <path d="M8 13h.01M8 16h.01M12 11h.01M12 14h.01M16 16h.01"/>`),
  fort: wrap(`
    <path d="M4 20.4V9.6l2.4-1.8V5l2.2 1.6V5l2.2 1.6V10l2.4 1.8v8.6z"/>
    <path d="M9.4 20.4v-4.2h2.6v4.2"/>
    <path d="M2.6 20.4h18.8"/>`),
  port: wrap(`
    <circle cx="12" cy="6.4" r="2.2"/>
    <path d="M12 8.6v11M7.4 12.6h9.2M6 15.2c0 3 2.7 4.8 6 4.8s6-1.8 6-4.8"/>
    <path d="M4.4 10.4 6 12.6M19.6 10.4 18 12.6"/>`),
  factory: wrap(`
    <path d="M3.6 20.4h16.8V9.4l-5 3.2V9.4l-5 3.2V6.6H6.2v13.8z"/>
    <path d="M6.4 3.4h3M17 4.4v3"/>`),
  aa: wrap(`<path d="M12 3.2v6.4M9 6.6h6"/><path d="M7 10.2h10l1.4 3.2H5.6z"/><path d="M9.4 13.4v7.4M14.6 13.4v7.4"/>`),
  silo: wrap(`
    <path d="M12 3.2v6.4M12 9.6c-3.2 0-5.4 2-5.4 4.6v6.2h10.8v-6.2c0-2.6-2.2-4.6-5.4-4.6z"/>
    <path d="M9.4 6.4h5.2M4.6 20.4h14.8"/>`),
  sword: wrap(`
    <path d="m16.8 3.6 3.6-.4-.4 3.6L9.6 17.2l-2.8-2.8z"/>
    <path d="m6.8 14.4-3.2 3.2 2.8 2.8 3.2-3.2"/>
    <path d="m9.2 18.4 2.4 2.4M6 21.6l1.6-1.6"/>`),
  shield: wrap(`
    <path d="M12 3.4 5.4 6v5.4c0 4 2.8 7.4 6.6 8.6 3.8-1.2 6.6-4.6 6.6-8.6V6z"/>`),
  peace: wrap(`
    <circle cx="12" cy="12" r="8.4"/>
    <path d="M12 3.6v16.8M6 7.2c3 1.4 3 8.2 0 9.6M18 7.2c-3 1.4-3 8.2 0 9.6"/>`),
  handshake: wrap(`
    <path d="m3.4 12.4 3.2-3.2 3.4 2 2.4-2 3.4 2.4 2.8-2.4 2 2-4.4 4.2-2.8-1.6-2 2-3.6-2.6z"/>`),
  gift: wrap(`
    <path d="M4 10.4h16v3.2H4zM5.6 13.6h12.8v6.8H5.6z"/>
    <path d="M12 10.4v10M12 10.4C10.4 7 6.8 6.2 6.8 8.6c0 1.4 2 1.8 5.2 1.8zM12 10.4c1.6-3.4 5.2-4.2 5.2-1.8 0 1.4-2 1.8-5.2 1.8z"/>`),
  nuke: wrap(`
    <circle cx="12" cy="12" r="2"/>
    <path d="M12 9.9V5.4a6.8 6.8 0 0 1 4.2 1.6l-2.2 3.8M9.8 13.1 6 15.3a6.8 6.8 0 0 1-.4-4.5l4.4.3M14.2 13.1l3.8 2.2a6.8 6.8 0 0 1-3.4 2.3l-1.5-4.5"/>`),
  star: wrap(`<path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.8l5.9-.8z"/>`),
  gear: wrap(`
    <circle cx="12" cy="12" r="3.2"/>
    <path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.2l2 1.2M17.5 15.6l2 1.2M4.5 16.8l2-1.2M17.5 8.4l2-1.2"/>`),
  info: wrap(`<circle cx="12" cy="12" r="8.4"/><path d="M12 11v5.4M12 7.8h.01"/>`),
  close: wrap(`<path d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>`),
  chevron: wrap(`<path d="m9 6 6 6-6 6"/>`),
  save: wrap(`<path d="M5 4.4h11l3 3v12.2H5z"/><path d="M8.4 4.4v5h6.4v-5M8.4 19.6v-6h7.2v6"/>`),
  load: wrap(`<path d="M4 7.4h6l2 2.4h8v9.8H4z"/><path d="M4 7.4V4.8h5.4l1.6 2.6"/>`),
  flag: wrap(`<path d="M6 21V3.8l11 2.4v8.6L6 12.2"/><path d="M6 12.2V21"/>`),
  users: wrap(`
    <circle cx="12" cy="8.4" r="3.4"/>
    <path d="M5 20c.5-3.6 3.2-5.8 7-5.8s6.5 2.2 7 5.8"/>`),
};

export function icon(name, cls = '') {
  const svg = ICONS[name] || ICONS.info;
  return cls ? svg.replace('<svg ', `<svg class="${cls}" `) : svg;
}
