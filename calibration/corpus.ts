export interface CorpusCase {
  readonly name: string
  readonly html: string
  readonly manifest?: object
}

interface PageOptions {
  head?: string
  style?: string
  body?: string
  viewport?: string
  rows?: number
}

const DEFAULT_ROWS = 40

function page({ head = '', style = '', body = '', viewport = 'width=device-width, initial-scale=1, viewport-fit=cover', rows = DEFAULT_ROWS }: PageOptions) {
  const filler = Array.from({ length: rows }, (_, i) => `<p class="row">Row ${i} — The quick brown fox jumps over the lazy dog.</p>`).join('\n')
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="${viewport}">
${head}
<style>
  body { margin: 0; font: 16px -apple-system, Helvetica, sans-serif; }
  .row { margin: 0; padding: 20px 16px; border-bottom: 1px solid rgba(128,128,128,.4); }
  ${style}
</style>
</head>
<body>
${body}
${filler}
</body>
</html>`
}

const fixedBar = (side: 'top' | 'bottom', css: string) =>
  `.bar-${side} { position: fixed; ${side}: 0; left: 0; right: 0; height: 56px; z-index: 10; ${css} }`

export const corpus: readonly CorpusCase[] = [
  { name: 'plain', html: page({}) },
  { name: 'body-color', html: page({ style: 'body { background: #1e88e5; color: white; }' }) },
  { name: 'html-color', html: page({ style: 'html { background: #8e24aa; color: white; }' }) },
  { name: 'html-body-colors', html: page({ style: 'html { background: #c62828; } body { background: #2e7d32; margin: 40px; color: white; }' }) },
  { name: 'body-alpha', html: page({ style: 'body { background: rgba(255, 0, 0, 0.5); }' }) },
  { name: 'body-gradient', html: page({ style: 'body { background: linear-gradient(#ff5722, #3f51b5); color: white; }' }) },
  { name: 'top-hero', html: page({ style: '.hero { height: 300px; background: #00897b; }', body: '<div class="hero"></div>' }) },
  { name: 'fixed-top', html: page({ style: `${fixedBar('top', 'background: #ff9800;')} body { padding-top: 56px; }`, body: '<div class="bar-top"></div>' }) },
  { name: 'fixed-top-alpha', html: page({ style: `${fixedBar('top', 'background: rgba(255, 152, 0, 0.5);')} body { background: #e3f2fd; }`, body: '<div class="bar-top"></div>' }) },
  { name: 'fixed-top-alpha-high', html: page({ style: `${fixedBar('top', 'background: rgba(255, 152, 0, 0.8);')} body { background: #e3f2fd; }`, body: '<div class="bar-top"></div>' }) },
  { name: 'fixed-top-backdrop', html: page({ style: `${fixedBar('top', 'background: rgba(255, 255, 255, 0.6); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);')} body { background: #fce4ec; }`, body: '<div class="bar-top"></div>' }) },
  { name: 'fixed-top-gradient', html: page({ style: fixedBar('top', 'background: linear-gradient(90deg, #f44336, #2196f3);'), body: '<div class="bar-top"></div>' }) },
  { name: 'fixed-top-image-solid', html: page({ style: fixedBar('top', 'background: linear-gradient(#6a1b9a, #6a1b9a);'), body: '<div class="bar-top"></div>' }) },
  { name: 'fixed-top-narrow', html: page({ style: `${fixedBar('top', 'background: #ff9800; right: auto; width: 60%;')}`, body: '<div class="bar-top"></div>' }) },
  { name: 'fixed-top-border', html: page({ style: fixedBar('top', 'background: #ffeb3b; border-top: 8px solid #d32f2f;'), body: '<div class="bar-top"></div>' }) },
  { name: 'fixed-top-offset', html: page({ style: fixedBar('top', 'background: #ff9800; top: 40px;'), body: '<div class="bar-top"></div>' }) },
  { name: 'fixed-top-nobg-child', html: page({ style: `${fixedBar('top', '')} .bar-top > div { height: 100%; background: #43a047; }`, body: '<div class="bar-top"><div></div></div>' }) },
  { name: 'sticky-top', html: page({ style: '.sticky { position: sticky; top: 0; height: 56px; background: #5e35b1; z-index: 10; }', body: '<p class="row">Above sticky</p><div class="sticky"></div>' }) },
  { name: 'fixed-bottom', html: page({ style: fixedBar('bottom', 'background: #009688;'), body: '<div class="bar-bottom"></div>' }) },
  { name: 'fixed-both', html: page({ style: `${fixedBar('top', 'background: #e91e63;')} ${fixedBar('bottom', 'background: #3f51b5;')}`, body: '<div class="bar-top"></div><div class="bar-bottom"></div>' }) },
  { name: 'fixed-overlay-full', html: page({ style: '.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); z-index: 20; }', body: '<div class="overlay"></div>' }) },
  { name: 'fixed-pointer-none', html: page({ style: `.layer { position: fixed; inset: 0; pointer-events: none; z-index: 30; } ${fixedBar('top', 'background: #795548;')}`, body: '<div class="layer"></div><div class="bar-top"></div>' }) },
  { name: 'dialog-modal', html: page({ style: 'dialog::backdrop { background: rgba(33, 150, 243, 0.6); } dialog { border: 0; border-radius: 12px; }', body: '<dialog id="d"><p>Modal dialog</p></dialog><script>addEventListener("load", () => document.getElementById("d").showModal())</script>' }) },
  { name: 'popover', html: page({ style: '[popover] { border: 0; padding: 24px; } [popover]::backdrop { background: rgba(76, 175, 80, 0.5); }', body: '<div id="p" popover>Popover</div><script>addEventListener("load", () => document.getElementById("p").showPopover())</script>' }) },
  { name: 'theme-color', html: page({ head: '<meta name="theme-color" content="#d32f2f">' }) },
  { name: 'theme-color-media', html: page({ head: '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffc107"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1a237e">' }) },
  { name: 'manifest-theme', html: page({ head: '<link rel="manifest" href="/case/manifest-theme.webmanifest">' }), manifest: { name: 'Manifest theme', display: 'standalone', theme_color: '#00bcd4', background_color: '#00bcd4' } },
  { name: 'color-scheme-dark', html: page({ head: '<meta name="color-scheme" content="light dark">' }) },
  { name: 'viewport-auto', html: page({ viewport: 'width=device-width, initial-scale=1', style: 'body { background: #ffcdd2; }' }) },
  { name: 'canvas-top', html: page({ style: 'canvas { display: block; width: 100%; height: 200px; }', body: '<canvas id="c" width="400" height="200"></canvas><script>const x = document.getElementById("c").getContext("2d"); x.fillStyle = "#ff5722"; x.fillRect(0, 0, 400, 200)</script>' }) },
  {
    name: 'pocket-stripes',
    html: page({ style: 'body { background: #ffffff; } .stripe { position: absolute; top: 0; width: 24px; height: 6000px; background: #000; } .row { padding-left: 120px; }', body: '<div class="stripe" style="left: 0"></div><div class="stripe" style="left: 60px; background: #ff0000"></div>', rows: 80 }),
  },
  {
    name: 'pocket-stripes-dark',
    html: page({ style: 'body { background: #000000; color: #fff; } .stripe { position: absolute; top: 0; width: 24px; height: 6000px; background: #fff; } .row { padding-left: 120px; }', body: '<div class="stripe" style="left: 0"></div><div class="stripe" style="left: 60px; background: #00ff00"></div>', rows: 80 }),
  },
  ...['#000000', '#333333', '#808080', '#c0c0c0', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#7f3f00', '#003f7f'].map(color => ({
    name: `swatch-${color.slice(1)}`,
    html: page({ style: `body { background: ${color}; } .row { visibility: hidden; }` }),
  })),
  {
    name: 'geometry',
    html: page({ style: 'body { background: #1e88e5; color: #fff; } .marker { position: fixed; top: 0; left: 0; width: 40%; height: 20px; background: #ff0000; }', body: '<div class="marker"></div>' }),
  },
  { name: 'standalone-translucent', html: page({ head: '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="apple-mobile-web-app-title" content="Translucent">', style: 'body { background: #4caf50; padding-top: env(safe-area-inset-top); }' }) },
  { name: 'standalone-default', html: page({ head: '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Default">', style: 'body { background: #4caf50; }' }) },
]

/**
 * Looks up a corpus case by name.
 * @param name case name
 * @returns the case, or undefined if none has that name
 */
export function findCase(name: string) {
  return corpus.find(c => c.name === name)
}
