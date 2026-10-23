import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'

// Fits the glass color matrix: saturate(s), then scale b, then offset o, clamped to 0–1 (sRGB).
// Pairs come from uniform-background references: pill interior vs. the page color beside it.

const REFERENCES_DIR = join(import.meta.dirname, 'references', 'ios26')
const SCALE = 3
const PILL_SAMPLE = { x: 135, y: 797, width: 25, height: 8 }
const BACKDROP_SAMPLE = { x: 2, y: 700, width: 20, height: 20 }
const UNIFORM_CASES = /^(plain|body-color|html-color|body-alpha|swatch-.*)$/

type Triple = [number, number, number]

interface Pair { readonly name: string, readonly backdrop: Triple, readonly glass: Triple }

export interface GlassFit {
  readonly saturation: number
  readonly scale: number
  readonly offset: number
  readonly matrix: number[]
  readonly rmse: number
}

/**
 * Builds the 4×5 feColorMatrix for saturate(s) · scale + offset.
 * @param s saturation (1 = unchanged)
 * @param b channel scale
 * @param o offset added to every channel, 0–1
 * @returns row-major matrix values
 */
export function glassMatrix(s: number, b: number, o: number): number[] {
  const rows = [
    [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s],
    [0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s],
    [0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s],
  ]
  return [...rows.flatMap(r => [...r.map(v => v * b), 0, o]), 0, 0, 0, 1, 0]
}

function apply(matrix: number[], [r, g, b]: Triple): Triple {
  const row = (i: number) => Math.min(1, Math.max(0, matrix[i * 5]! * r + matrix[i * 5 + 1]! * g + matrix[i * 5 + 2]! * b + matrix[i * 5 + 4]!))
  return [row(0), row(1), row(2)]
}

async function mean(path: string, region: typeof PILL_SAMPLE): Promise<Triple> {
  const { data, info } = await sharp(path).removeAlpha()
    .extract({ left: region.x * SCALE, top: region.y * SCALE, width: region.width * SCALE, height: region.height * SCALE })
    .raw().toBuffer({ resolveWithObject: true })
  const sum: Triple = [0, 0, 0]
  for (let i = 0; i < data.length; i += info.channels) for (let c = 0; c < 3; c++) sum[c as 0 | 1 | 2] += data[i + c]!
  const n = data.length / info.channels
  return sum.map(v => v / n / 255) as Triple
}

async function collectPairs(): Promise<Pair[]> {
  const pairs: Pair[] = []
  for (const name of await readdir(REFERENCES_DIR)) {
    if (!UNIFORM_CASES.test(name)) continue
    const path = join(REFERENCES_DIR, name, 'iphone-17-pro.portrait.light.initial.png')
    try {
      await readFile(path)
    } catch {
      continue
    }
    pairs.push({ name, backdrop: await mean(path, BACKDROP_SAMPLE), glass: await mean(path, PILL_SAMPLE) })
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
      const rmse = error(pairs, glassMatrix(s, b, o))
      if (rmse < best.rmse) best = { saturation: s, scale: b, offset: o, rmse }
    }
  }
  const steps = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step)
  search(steps(0.5, 3, 0.05), steps(0.5, 1.5, 0.02), steps(-0.2, 0.6, 0.01))
  const around = (v: number, d: number) => steps(v - d, v + d, d / 10)
  search(around(best.saturation, 0.05), around(best.scale, 0.02), around(best.offset, 0.01))
  return { ...best, matrix: glassMatrix(best.saturation, best.scale, best.offset) }
}

if (import.meta.main) {
  const pairs = await collectPairs()
  const fit = fitGlass(pairs)
  const hex = (t: Triple) => t.map(v => Math.round(v * 255)).join(',')
  for (const p of pairs) console.log(`${p.name.padEnd(16)} backdrop ${hex(p.backdrop).padEnd(12)} glass ${hex(p.glass).padEnd(12)} model ${hex(apply(fit.matrix, p.backdrop))}`)
  console.log(JSON.stringify({ ...fit, matrix: fit.matrix.map(v => Number(v.toFixed(4))) }))
}
