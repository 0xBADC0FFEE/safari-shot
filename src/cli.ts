#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { webkit, chromium, type Browser, type BrowserType } from 'playwright'
import { DEVICES, DEFAULT_DEVICE_ID, findDevice, modeledOrientations } from './devices.ts'
import { SCROLL_STATES, THEMES, ORIENTATIONS, MODES, IOS_VERSIONS, DEFAULT_IOS, scenarioStem, type IosVersion, type Scenario } from './scenario.ts'
import { takeShot, type ShotReport } from './shot.ts'

const DEFAULT_SCROLL_PX = 400
const DEFAULT_OVERSCROLL_PT = 150
const DEFAULT_SETTLE_MS = 500
const DEFAULT_OUT_DIR = 'safari-shots'

const USAGE = `Usage: safari-shot <url...> [options]

Screenshots of pages as Safari shows them on iPhone, including what is painted under the
status bar and the toolbar. Writes <out>/<page>/ios<version>/<device>.<orientation>.<theme>.<state>.png
plus a .json report next to each PNG, and prints a JSON manifest to stdout.

Options:
  -d, --device <ids>        Device presets, comma-separated, or "all" (default: ${DEFAULT_DEVICE_ID})
      --ios <versions>      ${IOS_VERSIONS.join(', ')} or "all"; 18 is a simplified, portrait-only model (default: ${DEFAULT_IOS})
  -s, --state <states>      ${SCROLL_STATES.join(', ')} or "all" (default: scrolled with --scroll, else initial)
  -t, --theme <themes>      ${THEMES.join(', ')} or "all" (default: light)
  -o, --orientation <list>  ${ORIENTATIONS.join(', ')} (default: portrait)
      --mode <mode>         ${MODES.join(', ')} (default: browser)
      --scroll <px>         Scroll offset for the "scrolled" state; implies it without --state (default: ${DEFAULT_SCROLL_PX})
      --overscroll <pt>     Rubber-band distance for overscroll states (default: ${DEFAULT_OVERSCROLL_PT})
      --settle <ms>         Wait after the load event (default: ${DEFAULT_SETTLE_MS})
      --engine <name>       webkit or chromium (default: webkit)
      --out <dir>           Output directory (default: ./${DEFAULT_OUT_DIR})
      --list-devices        Print device presets as JSON and exit
  -v, --version             Print the version and exit
  -h, --help                Show this help

The first run downloads Playwright's browser build (about 100 MB) if it is missing.`

interface ManifestEntry {
  readonly png: string
  readonly json: string
  readonly url: string
  readonly device: string
  readonly ios: IosVersion
  readonly scenario: Scenario
  readonly panels: ShotReport['panels']
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      device: { type: 'string', short: 'd', default: DEFAULT_DEVICE_ID },
      ios: { type: 'string', default: DEFAULT_IOS },
      state: { type: 'string', short: 's' },
      theme: { type: 'string', short: 't', default: 'light' },
      orientation: { type: 'string', short: 'o', default: 'portrait' },
      mode: { type: 'string', default: 'browser' },
      scroll: { type: 'string' },
      overscroll: { type: 'string', default: String(DEFAULT_OVERSCROLL_PT) },
      settle: { type: 'string', default: String(DEFAULT_SETTLE_MS) },
      engine: { type: 'string', default: 'webkit' },
      out: { type: 'string', default: DEFAULT_OUT_DIR },
      'list-devices': { type: 'boolean', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) return console.log(USAGE)
  if (values.version) return console.log(await packageVersion())
  if (values['list-devices']) return console.log(JSON.stringify(DEVICES, null, 2))
  if (!positionals.length) throw new UsageError('at least one URL is required')
  const urls = positionals.map(normalizeUrl)

  const devices = values.device === 'all' ? DEVICES : values.device.split(',').map(id => findDevice(id.trim()))
  const scenarios = cartesian({
    state: pick(values.state ?? (values.scroll === undefined ? 'initial' : 'scrolled'), SCROLL_STATES, 'state'),
    theme: pick(values.theme, THEMES, 'theme'),
    orientation: pick(values.orientation, ORIENTATIONS, 'orientation'),
    mode: pick(values.mode, MODES, 'mode'),
  })
  const iosVersions = pick(values.ios, IOS_VERSIONS, 'ios')
  for (const s of scenarios) {
    if (s.mode !== 'browser') throw new UsageError(`${s.mode} mode is not calibrated yet; use browser`)
    for (const ios of iosVersions) {
      if (!modeledOrientations(ios).includes(s.orientation)) throw new UsageError(`iOS ${ios} ${s.orientation} is not modeled; allowed: ${modeledOrientations(ios).join(', ')}`)
    }
  }
  const numbers = {
    scrollY: nonNegative(values.scroll ?? String(DEFAULT_SCROLL_PX), 'scroll'),
    overscroll: nonNegative(values.overscroll, 'overscroll'),
    settleMs: nonNegative(values.settle, 'settle'),
  }
  const outDir = resolve(values.out)
  const browser = await launch(values.engine)
  const manifest: ManifestEntry[] = []
  try {
    for (const url of urls) {
      for (const ios of iosVersions) {
        const shotDir = join(outDir, slug(url), `ios${ios}`)
        await mkdir(shotDir, { recursive: true })
        for (const device of devices) {
          for (const scenario of scenarios) {
            const { png, report } = await takeShot(browser, { url, device, ios, scenario, ...numbers })
            const stem = join(shotDir, scenarioStem(device.id, scenario))
            await writeFile(`${stem}.png`, png)
            await writeFile(`${stem}.json`, JSON.stringify(report, null, 2))
            manifest.push({ png: `${stem}.png`, json: `${stem}.json`, url, device: device.id, ios, scenario, panels: report.panels })
            console.error(`wrote ${stem}.png`)
          }
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
  // `npm run shot url --scroll 200` hands the CLI a bare "200": npm eats options that come without `--`.
  if (!/^(localhost|[^\s/:]+\.[^\s/:]+)(:\d+)?(\/|$)/i.test(raw)) {
    throw new UsageError(`"${raw}" is not a URL; with npm run, put options after --: npm run shot -- <url> [options]`)
  }
  return `https://${raw}`
}

function slug(url: string) {
  const { hostname, pathname } = new URL(url)
  return `${hostname || 'file'}${pathname}`.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'page'
}

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return manifest.version
}

async function launch(engine: string): Promise<Browser> {
  const browserType = ENGINES[engine]
  if (!browserType) throw new UsageError(`unknown engine "${engine}"; allowed: ${Object.keys(ENGINES).join(', ')}`)
  try {
    return await browserType.launch()
  } catch (error) {
    if (!(error instanceof Error && error.message.includes(MISSING_BROWSER))) throw error
    await installBrowser(engine)
    return browserType.launch()
  }
}

const ENGINES: Readonly<Record<string, BrowserType>> = { webkit, chromium }

// Playwright's launch error when the browser build for this Playwright version is not downloaded.
const MISSING_BROWSER = "Executable doesn't exist"

// The bundled Playwright CLI installs the build matching the library; `npx playwright` may resolve another version.
async function installBrowser(engine: string) {
  console.error(`safari-shot: downloading Playwright ${engine}; this happens once`)
  const playwrightCli = fileURLToPath(new URL('cli.js', import.meta.resolve('playwright/package.json')))
  const installer = spawn(process.execPath, [playwrightCli, 'install', engine], { stdio: ['ignore', 2, 2] })
  const [code] = await once(installer, 'exit') as [number | null]
  if (code !== 0) throw new Error(`playwright install ${engine} exited with ${code}; on Linux, run: npx playwright install --with-deps ${engine}`)
}

main().catch(error => {
  console.error(error instanceof UsageError ? `safari-shot: ${error.message}\n\n${USAGE}` : error)
  process.exitCode = error instanceof UsageError ? 2 : 1
})
