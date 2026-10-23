import type { LiquidGlassVersion } from './scenario.ts'

/** Safari 26 chrome drawing constants in points, measured from iOS 26.5 Simulator screenshots. */
export interface LiquidGlassChrome {
  readonly fontFamily: string
  readonly toolbarExpanded: {
    readonly height: number
    readonly sideMargin: number
    readonly gap: number
    readonly bottomMargin: number
    readonly fontSize: number
    readonly pageMenuIconLeft: number
    readonly reloadIconRight: number
  }
  readonly toolbarCollapsed: {
    readonly height: number
    readonly bottomMargin: number
    readonly paddingX: number
    readonly fontSize: number
  }
  /** Landscape top toolbar: back and bookmarks circles, a centered URL pill, and a share/new tab/tabs group. */
  readonly toolbarLandscape: {
    readonly top: number
    readonly height: number
    /** Gap between the landscape safe area and the outermost controls. */
    readonly safeAreaGap: number
    readonly gap: number
    readonly urlPillWidth: number
    readonly groupButtons: number
    readonly fontSize: number
  }
  readonly glass: {
    readonly blur: number
    readonly shadow: string
    /** Share of white mixed into the glass fill when the plan marks it whitened. */
    readonly whitenedMix: number
    /** Per system appearance, glass variants by the backdrop's luma, ascending; the first band whose `maxLuma` covers it applies. */
    readonly bands: Readonly<Record<'light' | 'dark', readonly GlassBand[]>>
  }
  /** Top scroll edge: the pocket color over content, alpha by distance from the screen top. */
  readonly topPocket: { readonly alphaStops: readonly AlphaStop[], readonly measuredTopInset: number }
  /** Bottom scroll edge under the expanded toolbar: the pocket color over content, alpha by distance from the screen bottom. */
  readonly bottomPocket: { readonly alphaStops: readonly AlphaStop[] }
  readonly refreshSpinner: { readonly offsetTop: number }
  /** Glyph in the URL pill's leading slot, and in the circle right of the pill. */
  readonly icons: { readonly pageMenu: 'reader' | 'lines', readonly trailing: 'more' | 'tabs' }
}

export type GlassName = 'dark' | 'dimmed' | 'light'

export interface GlassBand {
  readonly name: GlassName
  readonly maxLuma: number
  readonly variant: GlassVariant
}

export interface GlassVariant {
  /** feColorMatrix (4×5, row-major, sRGB 0–1) mapping the blurred backdrop to the glass fill. */
  readonly colorMatrix: readonly number[]
  readonly ink: string
  readonly disabledInk: string
  readonly rim: string
}

/** [distance from the screen edge in points, opacity]. */
export type AlphaStop = readonly [number, number]

// Fitted on iOS 26.5 Simulator swatches: #333333 (0.200) gets dark glass, #003f7f (0.213) light.
export const DARK_GLASS_MAX_LUMA = 0.206

const DARK_RIM = 'inset 0 0 0 0.6px rgba(255, 255, 255, 0.14)'

const LIGHT_GLASS: GlassVariant = {
  // saturate(2.25) · 0.48 + 0.538
  colorMatrix: [
    0.9524, -0.4291, -0.0433, 0, 0.538,
    -0.1276, 0.6509, -0.0433, 0, 0.538,
    -0.1276, -0.4291, 1.0367, 0, 0.538,
    0, 0, 0, 1, 0,
  ],
  ink: '#000000',
  disabledInk: 'rgba(60, 60, 67, 0.3)',
  rim: 'inset 0.6px 0.6px 0.6px rgba(255, 255, 255, 0.7), inset -0.4px -0.4px 0.6px rgba(255, 255, 255, 0.35)',
}

const DARK_GLASS: GlassVariant = {
  // saturate(2.25) · 0.53 + 0.098
  colorMatrix: [
    1.0515, -0.4738, -0.0477, 0, 0.098,
    -0.141, 0.7187, -0.0477, 0, 0.098,
    -0.141, -0.4738, 1.1448, 0, 0.098,
    0, 0, 0, 1, 0,
  ],
  ink: '#ffffff',
  disabledInk: 'rgba(235, 235, 245, 0.3)',
  rim: DARK_RIM,
}

/**
 * Builds the 4×5 feColorMatrix for saturate(s), then scale, then offset (sRGB 0–1).
 * @param saturation 1 leaves colors unchanged
 * @param scale channel multiplier
 * @param offset added to every channel
 * @returns row-major matrix values
 */
export function saturateScaleOffset(saturation: number, scale: number, offset: number): number[] {
  const s = saturation
  const rows = [
    [0.2126 + 0.7874 * s, 0.7152 - 0.7152 * s, 0.0722 - 0.0722 * s],
    [0.2126 - 0.2126 * s, 0.7152 + 0.2848 * s, 0.0722 - 0.0722 * s],
    [0.2126 - 0.2126 * s, 0.7152 - 0.7152 * s, 0.0722 + 0.9278 * s],
  ]
  return [...rows.flatMap(row => [...row.map(v => v * scale), 0, offset]), 0, 0, 0, 1, 0]
}

const DIMMED = { s: 1.575, scale: 0.79, offset: 0.07 }
const DARK_LIGHT = { s: 0.5, scale: 0.31, offset: 0.679 }

const SYSTEM_FONT = `-apple-system, "SF Pro Text", "SF Pro", system-ui, "Inter", "Helvetica Neue", Arial, sans-serif`

export const CHROME_26: LiquidGlassChrome = {
  fontFamily: SYSTEM_FONT,
  toolbarExpanded: { height: 48, sideMargin: 34, gap: 7, bottomMargin: 34, fontSize: 17, pageMenuIconLeft: 16, reloadIconRight: 14 },
  toolbarCollapsed: { height: 32, bottomMargin: 14, paddingX: 18, fontSize: 12.6 },
  toolbarLandscape: { top: 10, height: 44, safeAreaGap: 10, gap: 12, urlPillWidth: 317.7, groupButtons: 3, fontSize: 17 },
  glass: {
    blur: 2,
    // Fitted on the red swatch: content is 11% darker at the pill's bottom edge, 2% at 33pt below it.
    shadow: '0 11px 42px rgba(0, 0, 0, 0.16)',
    // Fitted on fixed-both, fixed-bottom and body-gradient; measured over light glass only.
    whitenedMix: 0.24,
    bands: {
      light: [
        { name: 'dark', maxLuma: DARK_GLASS_MAX_LUMA, variant: DARK_GLASS },
        { name: 'light', maxLuma: 1, variant: LIGHT_GLASS },
      ],
      // Fitted with calibration/fit-glass.ts --theme dark: dark RMSE 0.1, dimmed 3.6, light 1.3. Below near-white one
      // transform saturates mid-tones and darkens pastels; near-white backdrops get a light glass with black ink.
      dark: [
        { name: 'dark', maxLuma: DARK_GLASS_MAX_LUMA, variant: DARK_GLASS },
        // #fce4ec (0.917) is dimmed; #ffff00 (0.928) and #e3f2fd (0.94) are light.
        { name: 'dimmed', maxLuma: 0.922, variant: { ...DARK_GLASS, colorMatrix: saturateScaleOffset(DIMMED.s, DIMMED.scale, DIMMED.offset) } },
        { name: 'light', maxLuma: 1, variant: { ...LIGHT_GLASS, colorMatrix: saturateScaleOffset(DARK_LIGHT.s, DARK_LIGHT.scale, DARK_LIGHT.offset) } },
      ],
    },
  },
  // Measured on a red page edge under a green body (html-body-colors, scrolled).
  topPocket: { alphaStops: [[0, 0.81], [10, 0.75], [20, 0.67], [30, 0.55], [40, 0.41], [50, 0.27], [60, 0.16], [70, 0.08], [80, 0.03], [100, 0]], measuredTopInset: 62 },
  // Measured on a black stripe over white and a white stripe over black (pocket-stripes, pocket-stripes-dark).
  bottomPocket: { alphaStops: [[0, 0.85], [16, 0.83], [28, 0.81], [40, 0.77], [52, 0.67], [64, 0.54], [76, 0.37], [88, 0.22], [100, 0.11], [112, 0.04], [124, 0.01], [136, 0]] },
  refreshSpinner: { offsetTop: 30 },
  icons: { pageMenu: 'reader', trailing: 'more' },
}

// Fitted with calibration/fit-glass.ts --ios 27. Light appearance: all 16 uniform backdrops at once, RMSE 0.7;
// black stays mid-gray. Dark appearance: white ink throughout, two bands split at luma 0.6, RMSE 3.4 and 1.1.
const GLASS_27: GlassVariant = { ...LIGHT_GLASS, colorMatrix: saturateScaleOffset(1.93, 0.478, 0.512) }
const DARK_GLASS_27: GlassVariant = { ...DARK_GLASS, colorMatrix: saturateScaleOffset(1.53, 0.76, 0.142) }
const DIMMED_GLASS_27: GlassVariant = { ...DARK_GLASS, colorMatrix: saturateScaleOffset(3.05, 0.316, 0.406) }

/** iOS 27.0 Safari keeps the iOS 26 layout; one black-ink glass, no whitening, no scroll-edge pockets, a faint shadow. */
export const CHROME_27: LiquidGlassChrome = {
  ...CHROME_26,
  glass: {
    ...CHROME_26.glass,
    shadow: '0 11px 42px rgba(0, 0, 0, 0.02)',
    whitenedMix: 0,
    bands: {
      light: [{ name: 'light', maxLuma: 1, variant: GLASS_27 }],
      dark: [
        { name: 'dark', maxLuma: 0.6, variant: DARK_GLASS_27 },
        { name: 'dimmed', maxLuma: 1, variant: DIMMED_GLASS_27 },
      ],
    },
  },
  topPocket: { ...CHROME_26.topPocket, alphaStops: [[0, 0]] },
  bottomPocket: { alphaStops: [[0, 0]] },
  icons: { pageMenu: 'lines', trailing: 'tabs' },
}

export const LIQUID_GLASS_CHROME: Readonly<Record<LiquidGlassVersion, LiquidGlassChrome>> = { '26': CHROME_26, '27': CHROME_27 }

/** Safari 18 chrome drawing constants in points, measured from iOS 18.6 Simulator screenshots of iPhone 16 Pro. */
export interface Chrome18 {
  readonly fontFamily: string
  readonly material: Readonly<Record<'light' | 'dark', Material>>
  readonly urlField: { readonly sideMargin: number, readonly top: number, readonly height: number, readonly radius: number, readonly fontSize: number, readonly shadow: string }
  /** Back, forward, share, bookmarks, tabs: centers spread evenly between the side insets. */
  readonly buttonRow: { readonly centerY: number, readonly sideInset: number }
  /** Collapsed bar: the bottom scroll-edge color over content, host name on one line. */
  readonly collapsedBar: { readonly opacity: number, readonly textCenterY: number, readonly fontSize: number }
  readonly separator: string
  readonly tint: string
  readonly homeIndicator: { readonly width: number, readonly height: number, readonly bottomMargin: number }
  readonly refreshSpinner: { readonly offsetTop: number }
}

/** Blurred content run through saturate, then a per-channel `scale · c + offset` (sRGB 0–1). */
export interface Material {
  readonly blur: number
  readonly saturation: number
  readonly scale: number
  readonly offset: number
  readonly fieldFill: string
  readonly ink: string
  readonly disabledInk: string
}

export const CHROME_18: Chrome18 = {
  fontFamily: SYSTEM_FONT,
  material: {
    // Fitted on solid page colors under the expanded toolbar (calibration/fit-glass.ts --ios 18), RMSE 4.2 of 255.
    light: { blur: 10, saturation: 0.775, scale: 0.422, offset: 0.717, fieldFill: 'rgba(255, 255, 255, 0.82)', ink: '#000000', disabledInk: 'rgba(60, 60, 67, 0.3)' },
    // Not calibrated: the light fit around a dark base.
    dark: { blur: 10, saturation: 0.775, scale: 0.422, offset: 0.06, fieldFill: 'rgba(118, 118, 128, 0.24)', ink: '#ffffff', disabledInk: 'rgba(235, 235, 245, 0.3)' },
  },
  urlField: { sideMargin: 28, top: 8, height: 45, radius: 12, fontSize: 17, shadow: '0 2px 10px rgba(0, 0, 0, 0.07)' },
  buttonRow: { centerY: 77, sideInset: 29 },
  // Fitted on body-gradient: white over the content at the bottom edge.
  collapsedBar: { opacity: 0.86, textCenterY: 19, fontSize: 14 },
  separator: 'rgba(0, 0, 0, 0.05)',
  tint: '#007aff',
  homeIndicator: { width: 144, height: 5, bottomMargin: 8 },
  refreshSpinner: { offsetTop: 30 },
}
