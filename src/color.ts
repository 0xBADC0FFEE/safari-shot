/** sRGB color: channels 0–255, alpha 0–1. */
export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

export const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 }
export const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 }
export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 }

// PageColorSampler::nearlyTransparentAlphaThreshold
export const NEARLY_TRANSPARENT_ALPHA = 0.1
// PageColorSampler::colorsAreSimilar, squared distance on the 0–255 scale
const SIMILAR_COLOR_DISTANCE_SQUARED = 36

export function isVisible(color: Rgba) {
  return color.a > 0
}

/**
 * Composites `top` over `bottom` (CSS source-over).
 * @param bottom backdrop color
 * @param top color painted over it
 * @returns the composited color
 */
export function blendSourceOver(bottom: Rgba, top: Rgba): Rgba {
  if (top.a >= 1) return top
  if (top.a <= 0) return bottom
  const a = top.a + bottom.a * (1 - top.a)
  if (a === 0) return TRANSPARENT
  const channel = (t: number, b: number) => Math.round((t * top.a + b * bottom.a * (1 - top.a)) / a)
  return { r: channel(top.r, bottom.r), g: channel(top.g, bottom.g), b: channel(top.b, bottom.b), a }
}

export function withAlpha(color: Rgba, a: number): Rgba {
  return { ...color, a }
}

export function colorsAreSimilar(x: Rgba, y: Rgba) {
  return (x.r - y.r) ** 2 + (x.g - y.g) ** 2 + (x.b - y.b) ** 2 <= SIMILAR_COLOR_DISTANCE_SQUARED
}

export function sameColor(x: Rgba, y: Rgba) {
  return x.r === y.r && x.g === y.g && x.b === y.b && x.a === y.a
}

/** WCAG relative luminance of the opaque color, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: Rgba) {
  const linear = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function toHex({ r, g, b, a }: Rgba) {
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}${a < 1 ? hex(a * 255) : ''}`
}

export function toCss({ r, g, b, a }: Rgba) {
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/**
 * Parses `#rgb`, `#rrggbb`, `#rrggbbaa` or `rgb()/rgba()` notation.
 * @param text color text
 * @returns the color, or undefined when the notation is not one of those
 */
export function parseSimpleColor(text: string): Rgba | undefined {
  const value = text.trim().toLowerCase()
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1]
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const digits = hex.length <= 4 ? [...hex].map(d => d + d) : hex.match(/../g)!
    const [r = 0, g = 0, b = 0, a = 255] = digits.map(d => parseInt(d, 16))
    return { r, g, b, a: a / 255 }
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(value)?.[1]
  if (!fn) return undefined
  const parts = fn.split(/[\s,/]+/).filter(Boolean)
  if (parts.length < 3) return undefined
  const channel = (p: string) => p.endsWith('%') ? parseFloat(p) * 2.55 : parseFloat(p)
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
  return { r: channel(parts[0]!), g: channel(parts[1]!), b: channel(parts[2]!), a: alpha }
}

/** CIE L*a*b* (D65) of the opaque color. */
export function toLab({ r, g, b }: Rgba) {
  const linear = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)]
  const x = (0.4124 * lr + 0.3576 * lg + 0.1805 * lb) / 0.95047
  const y = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
  const z = (0.0193 * lr + 0.1192 * lg + 0.9505 * lb) / 1.08883
  const f = (t: number) => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116
  return { l: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) }
}

export function deltaE76(x: Rgba, y: Rgba) {
  const p = toLab(x)
  const q = toLab(y)
  return Math.hypot(p.l - q.l, p.a - q.a, p.b - q.b)
}

export function fromLab(lab: { l: number, a: number, b: number }): Rgba {
  const fy = (lab.l + 16) / 116
  const fx = fy + lab.a / 500
  const fz = fy - lab.b / 200
  const inverse = (t: number) => t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27)
  const x = inverse(fx) * 0.95047
  const y = inverse(fy)
  const z = inverse(fz) * 1.08883
  const gamma = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.round(Math.min(1, Math.max(0, v)) * 255)
  }
  return {
    r: gamma(3.2406 * x - 1.5372 * y - 0.4986 * z),
    g: gamma(-0.9689 * x + 1.8758 * y + 0.0415 * z),
    b: gamma(0.0557 * x - 0.204 * y + 1.057 * z),
    a: 1,
  }
}
