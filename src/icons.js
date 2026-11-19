const shapes = {
  bag: '<path d="M4 8h16l1 13H3L4 8Z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>',
  body: '<circle cx="12" cy="4.6" r="2.5"/><path d="M5 10l7-2 7 2m-7-2v8m0 0-4 6m4-6 4 6"/>',
  upper: '<circle cx="12" cy="6" r="3.4"/><path d="M4 20v-1a8 8 0 0 1 16 0v1H4Z"/>',
  face: '<path d="M5 9V5h4m6 0h4v4m0 6v4h-4m-6 0H5v-4"/><path d="M9 10h.01M15 10h.01m-5 5a3 3 0 0 0 4 0"/>',
  rotate: '<path d="M20 10a8 8 0 1 0 0 5m0-10v5h-5"/>',
  video: '<rect x="2" y="5" width="13" height="14" rx="2"/><path d="m15 10 6-4v12l-6-4"/>',
  camera: '<path d="M4 7h4l2-3h4l2 3h4a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="3"/>',
  cube: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z"/><path d="m3 7 9 5 9-5m-9 5v10"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="#22251e"/><circle cx="15" cy="17" r="3" fill="#22251e"/>',
  shield: '<path d="M12 22s7-3 7-10V5l-7-3-7 3v7c0 7 7 10 7 10Z"/><path d="m9 12 2 2 4-4"/>',
  hanger: '<path d="M10 6a2 2 0 1 1 3.4 1.4c-1 .9-1.4 1-1.4 3.1L3 16a1.5 1.5 0 0 0 .8 2.7h16.4a1.5 1.5 0 0 0 .8-2.7L12 10.5"/>',
  ruler: '<path d="m3 15 12-12 6 6-12 12-6-6Z"/><path d="m7 11 2 2m1-5 2 2m1-5 2 2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.3 9.3a2.8 2.8 0 1 1 4.9 1.9c-1.1.8-2.2 1.1-2.2 2.5m0 2.7h.01"/>',
  crop: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5m3-3h10"/>',
  maximize: '<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4"/>',
  motion: '<path d="M2 12h4l3-7 5 14 3-7h5"/>',
  wind: '<path d="M3 8h12a2.5 2.5 0 1 0-2.5-2.5M2 13h18a2 2 0 1 0-2-2M5 18h8a2.5 2.5 0 1 1-2.5 2.5"/>',
  split: '<path d="M12 3v18M8 8l-4 4 4 4m8-8 4 4-4 4"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 1 1 8 0v3m-4 4v2"/>',
  code: '<path d="m8 6-5 6 5 6m8-12 5 6-5 6m-3-15-2 18"/>',
  upload: '<path d="M4 17v3h16v-3m-8-1V4m-5 5 5-5 5 5"/>',
  scan: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5m3-3h10"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  freeze: '<path d="M5 8V5h3m8 0h3v3m0 8v3h-3m-8 0H5v-3m5-6v4m4-4v4"/>',
};
export function icon(name) {
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${shapes[name] ?? ''}</svg>`;
}
export function fillIcons(node = document) {
  node.querySelectorAll('i[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}
