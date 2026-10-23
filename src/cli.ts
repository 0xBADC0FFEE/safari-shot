#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { webkit, chromium, type Browser } from 'playwright'
import { DEVICES, DEFAULT_DEVICE_ID, findDevice } from './devices.ts'
import { SCROLL_STATES, THEMES, ORIENTATIONS, MODES, scenarioStem, type Scenario } from './scenario.ts'
import { takeShot, type ShotReport } from './shot.ts'

const DEFAULT_SCROLL_PX = 400
const DEFAULT_OVERSCROLL_PT = 150
const DEFAULT_SETTLE_MS = 500
const DEFAULT_OUT_DIR = 'safari-shots'

const USAGE = `Usage: safari-shot <url...> [options]

Screenshots of pages as iOS 26 Safari shows them on iPhone, including what is painted
under the status bar and the toolbar. Writes <out>/<page>/<device>.<orientation>.<theme>.<state>.png
plus a .json report next to each PNG, and prints a JSON manifest to stdout.

Options:
  -d, --device <ids>        Device presets, comma-separated, or "all" (default: ${DEFAULT_DEVICE_ID})
  -s, --state <states>      ${SCROLL_STATES.join(', ')} or "all" (default: initial)
  -t, --theme <themes>      ${THEMES.join(', ')} or "all" (default: light)
  -o, --orientation <list>  ${ORIENTATIONS.join(', ')} (default: portrait)
      --mode <mode>         ${MODES.join(', ')} (default: browser)
      --scroll <px>         Scroll offset for the "scrolled" state (default: ${DEFAULT_SCROLL_PX})
      --overscroll <pt>     Rubber-band distance for overscroll states (default: ${DEFAULT_OVERSCROLL_PT})
      --settle <ms>         Wait after the load event (default: ${DEFAULT_SETTLE_MS})
      --engine <name>       webkit or chromium (default: webkit)
      --out <dir>           Output directory (default: ./${DEFAULT_OUT_DIR})
      --list-devices        Print device presets as JSON and exit
  -h, --help                Show this help`

interface ManifestEntry {
  readonly png: string
  readonly json: string
  readonly url: string
  readonly device: string
  readonly scenario: Scenario
  readonly panels: ShotReport['panels']
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      device: { type: 'string', short: 'd', default: DEFAULT_DEVICE_ID },
      state: { type: 'string', short: 's', default: 'initial' },
      theme: { type: 'string', short: 't', default: 'light' },
      orientation: { type: 'string', short: 'o', default: 'portrait' },
      mode: { type: 'string', default: 'browser' },
      scroll: { type: 'string', default: String(DEFAULT_SCROLL_PX) },
      overscroll: { type: 'string', default: String(DEFAULT_OVERSCROLL_PT) },
      settle: { type: 'string', default: String(DEFAULT_SETTLE_MS) },
      engine: { type: 'string', default: 'webkit' },
      out: { type: 'string', default: DEFAULT_OUT_DIR },
      'list-devices': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) return console.log(USAGE)
  if (values['list-devices']) return console.log(JSON.stringify(DEVICES, null, 2))
  if (!positionals.length) throw new UsageError('at least one URL is required')

  const devices = values.device === 'all' ? DEVICES : values.device.split(',').map(id => findDevice(id.trim()))
  const scenarios = cartesian({
    state: pick(values.state, SCROLL_STATES, 'state'),
    theme: pick(values.theme, THEMES, 'theme'),
    orientation: pick(values.orientation, ORIENTATIONS, 'orientation'),
    mode: pick(values.mode, MODES, 'mode'),
  })
  for (const s of scenarios) {
    if (s.orientation !== 'portrait' || s.mode !== 'browser') throw new UsageError(`${s.orientation}/${s.mode} is not calibrated yet; use portrait browser`)
  }
  const numbers = {
    scrollY: nonNegative(values.scroll, 'scroll'),
    overscroll: nonNegative(values.overscroll, 'overscroll'),
    settleMs: nonNegative(values.settle, 'settle'),
  }
  const outDir = resolve(values.out)
  const browser = await launch(values.engine)
  const manifest: ManifestEntry[] = []
  try {
    for (const rawUrl of positionals) {
      const url = normalizeUrl(rawUrl)
      const pageDir = join(outDir, slug(url))
      await mkdir(pageDir, { recursive: true })
      for (const device of devices) {
        for (const scenario of scenarios) {
          const { png, report } = await takeShot(browser, { url, device, scenario, ...numbers })
          const stem = join(pageDir, scenarioStem(device.id, scenario))
          await writeFile(`${stem}.png`, png)
          await writeFile(`${stem}.json`, JSON.stringify(report, null, 2))
          manifest.push({ png: `${stem}.png`, json: `${stem}.json`, url, device: device.id, scenario, panels: report.panels })
          console.error(`wrote ${stem}.png`)
        }
      }
    }
  } finally {
    await browser.close()
  }
  await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(JSON.stringify(manifest, null, 2))
}

class UsageError extends Error {}

function pick<T extends string>(value: string, allowed: readonly T[], name: string): T[] {
  if (value === 'all') return [...allowed]
  const items = value.split(',').map(v => v.trim())
  const unknown = items.filter(v => !(allowed as readonly string[]).includes(v))
  if (unknown.length) throw new UsageError(`unknown ${name} "${unknown.join(', ')}"; allowed: ${allowed.join(', ')}, all`)
  return items as T[]
}

function cartesian(axes: { state: Scenario['state'][], theme: Scenario['theme'][], orientation: Scenario['orientation'][], mode: Scenario['mode'][] }): Scenario[] {
  return axes.orientation.flatMap(orientation => axes.theme.flatMap(theme => axes.mode.flatMap(mode => axes.state.map(state => ({ state, theme, orientation, mode })))))
}

function nonNegative(value: string, name: string) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--${name} must be a non-negative number`)
  return n
}

function normalizeUrl(raw: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return raw
  if (/^[./~]/.test(raw) || raw.endsWith('.html')) return new URL(`file://${resolve(raw)}`).href
  return `https://${raw}`
}

function slug(url: string) {
  const { hostname, pathname } = new URL(url)
  return `${hostname || 'file'}${pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'page'
}

async function launch(engine: string): Promise<Browser> {
  if (engine === 'webkit') return webkit.launch()
  if (engine === 'chromium') return chromium.launch()
  throw new UsageError(`unknown engine "${engine}"; allowed: webkit, chromium`)
}

main().catch(error => {
  console.error(error instanceof UsageError ? `safari-shot: ${error.message}\n\n${USAGE}` : error)
  process.exitCode = error instanceof UsageError ? 2 : 1
})
