import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import sharp from 'sharp'
import { LIQUID_GLASS_CHROME, saturateScaleOffset } from '../src/chrome.ts'
import { luma } from '../src/color.ts'

// Fits the toolbar's color transform: saturate(s), then scale b, then offset o, clamped to 0–1 (sRGB).
// Pairs come from uniform-background references: toolbar interior vs. the page color beside it.
// iOS 26 and 27 fit each glass band of the chosen appearance; iOS 18 fits the light toolbar material.

const SCALE = 3
const BACKDROP_SAMPLE = { x: 2, y: 700, width: 20, height: 20 }
const UNIFORM_CASES = /^(plain|body-color|html-color|body-alpha|swatch-.*)$/
// Dark appearance needs pastel backdrops to separate its bands; light-appearance fits predate them.
const DARK_ONLY_CASES = /^(dialog-modal|popover|viewport-auto|fixed-top-backdrop)$/
const TARGETS = {
  '27': { device: 'iphone-17-pro', toolbarSample: { x: 135, y: 797, width: 25, height: 8 } },
  '26': { device: 'iphone-17-pro', toolbarSample: { x: 135, y: 797, width: 25, height: 8 } },
  '18': { device: 'iphone-16-pro', toolbarSample: { x: 50, y: 836, width: 50, height: 14 } },
} as const

type Region = typeof BACKDROP_SAMPLE

type Triple = [number, number, number]

interface Pair { readonly name: string, readonly backdrop: Triple, readonly glass: Triple }

export interface GlassFit {
  readonly saturation: number
  readonly scale: number
  readonly offset: number
  readonly matrix: number[]
  readonly rmse: number
}

function apply(matrix: number[], [r, g, b]: Triple): Triple {
  const row = (i: number) => Math.min(1, Math.max(0, matrix[i * 5]! * r + matrix[i * 5 + 1]! * g + matrix[i * 5 + 2]! * b + matrix[i * 5 + 4]!))
  return [row(0), row(1), row(2)]
}

async function mean(path: string, region: Region): Promise<Triple> {
  const { data, info } = await sharp(path).removeAlpha()
    .extract({ left: region.x * SCALE, top: region.y * SCALE, width: region.width * SCALE, height: region.height * SCALE })
    .raw().toBuffer({ resolveWithObject: true })
  const sum: Triple = [0, 0, 0]
  for (let i = 0; i < data.length; i += info.channels) for (let c = 0; c < 3; c++) sum[c as 0 | 1 | 2] += data[i + c]!
  const n = data.length / info.channels
  return sum.map(v => v / n / 255) as Triple
}

async function collectPairs(ios: keyof typeof TARGETS, theme: string, exclude: RegExp | null): Promise<Pair[]> {
  const { device, toolbarSample } = TARGETS[ios]
  const reference = `${device}.portrait.${theme}.initial.png`
  const referencesDir = join(import.meta.dirname, 'references', `ios${ios}`)
  const pairs: Pair[] = []
  for (const name of await readdir(referencesDir)) {
    const uniform = UNIFORM_CASES.test(name) || (theme === 'dark' && DARK_ONLY_CASES.test(name))
    if (!uniform || exclude?.test(name)) continue
    const path = join(referencesDir, name, reference)
    try {
      await readFile(path)
    } catch {
      continue
    }
    pairs.push({ name, backdrop: await mean(path, BACKDROP_SAMPLE), glass: await mean(path, toolbarSample) })
  }
  return pairs
}

function error(pairs: Pair[], matrix: number[]) {
  let sum = 0
  for (const { backdrop, glass } of pairs) {
    const predicted = apply(matrix, backdrop)
    for (let c = 0; c < 3; c++) sum += (predicted[c]! - glass[c]!) ** 2
  }
  return Math.sqrt(sum / (pairs.length * 3)) * 255
}

/**
 * Grid-searches saturation, scale and offset, then refines around the best point.
 * @param pairs backdrop → glass color samples
 * @returns the best fit and its RMSE on the 0–255 scale
 */
export function fitGlass(pairs: Pair[]): GlassFit {
  let best = { saturation: 1, scale: 1, offset: 0, rmse: Infinity }
  const search = (sRange: number[], bRange: number[], oRange: number[]) => {
    for (const s of sRange) for (const b of bRange) for (const o of oRange) {
      const rmse = error(pairs, saturateScaleOffset(s, b, o))
      if (rmse < best.rmse) best = { saturation: s, scale: b, offset: o, rmse }
    }
  }
  const steps = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step)
  search(steps(0.5, 3, 0.05), steps(0.3, 1.5, 0.02), steps(-0.2, 0.8, 0.01))
  const around = (v: number, d: number) => steps(v - d, v + d, d / 10)
  search(around(best.saturation, 0.05), around(best.scale, 0.02), around(best.offset, 0.01))
  return { ...best, matrix: saturateScaleOffset(best.saturation, best.scale, best.offset) }
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { ios: { type: 'string', default: '26' }, theme: { type: 'string', default: 'light' }, exclude: { type: 'string' } } })
  const ios = Object.keys(TARGETS).find(v => v === values.ios) as keyof typeof TARGETS | undefined
  if (!ios) throw new Error(`--ios must be one of ${Object.keys(TARGETS).join(', ')}`)
  if (values.theme !== 'light' && values.theme !== 'dark') throw new Error('--theme must be light or dark')
  const pairs = await collectPairs(ios, values.theme, values.exclude ? new RegExp(values.exclude) : null)
  const bands = LIQUID_GLASS_CHROME[ios === '18' ? '26' : ios].glass.bands[values.theme]
  const bandOf = ({ backdrop: [r, g, b] }: Pair) => bands.find(band => luma({ r: r * 255, g: g * 255, b: b * 255, a: 1 }) <= band.maxLuma)!.name
  const hex = (t: Triple) => t.map(v => Math.round(v * 255)).join(',')
  // iOS 18's material follows the system appearance, not the content, so its light references form one group.
  const groups = ios === '18' ? [['light', pairs]] as const : bands.map(band => [band.name, pairs.filter(p => bandOf(p) === band.name)] as const)
  for (const [variant, group] of groups) {
    if (!group.length) continue
    const fit = fitGlass(group)
    for (const p of group) console.log(`${variant} ${p.name.padEnd(16)} backdrop ${hex(p.backdrop).padEnd(12)} glass ${hex(p.glass).padEnd(12)} model ${hex(apply(fit.matrix, p.backdrop))}`)
    console.log(variant, JSON.stringify({ ...fit, matrix: fit.matrix.map(v => Number(v.toFixed(4))) }))
  }
}
