/** Safari 26 chrome drawing constants in points, measured from iOS 26.5 Simulator screenshots. */
export interface Chrome26 {
  readonly fontFamily: string
  readonly statusBar: {
    readonly height: number
    readonly timeCenterX: number
    readonly timeBaseline: number
    readonly timeFontSize: number
    readonly iconsCenterY: number
    readonly trailingInset: number
  }
  readonly toolbarExpanded: {
    readonly height: number
    readonly sideMargin: number
    readonly gap: number
    readonly bottomMargin: number
    readonly fontSize: number
    readonly pageMenuIconLeft: number
    readonly reloadIconRight: number
    readonly disabledIconColor: string
  }
  readonly toolbarCollapsed: {
    readonly height: number
    readonly bottomMargin: number
    readonly paddingX: number
    readonly fontSize: number
  }
  readonly glass: {
    readonly blur: number
    /** feColorMatrix (4×5, row-major, sRGB 0–1) mapping the blurred backdrop to the glass fill. */
    readonly colorMatrix: readonly number[]
    readonly ink: string
    readonly rim: string
    readonly shadow: string
  }
  /** Top scroll edge: the pocket color over content, alpha by distance from the screen top. */
  readonly topPocket: { readonly alphaStops: readonly AlphaStop[] }
  /** Bottom scroll edge under the expanded toolbar: blurred content mixed in by distance from the bottom. */
  readonly bottomPocket: { readonly blur: number, readonly alphaStops: readonly AlphaStop[] }
  readonly refreshSpinner: { readonly offsetTop: number }
}

/** [distance from the screen edge in points, opacity]. */
export type AlphaStop = readonly [number, number]

export const CHROME_26: Chrome26 = {
  fontFamily: `-apple-system, "SF Pro Text", "SF Pro", system-ui, "Inter", "Helvetica Neue", Arial, sans-serif`,
  statusBar: { height: 54, timeCenterX: 74, timeBaseline: 38.3, timeFontSize: 17, iconsCenterY: 33, trailingInset: 35 },
  toolbarExpanded: { height: 48, sideMargin: 34, gap: 7, bottomMargin: 34, fontSize: 17, pageMenuIconLeft: 16, reloadIconRight: 14, disabledIconColor: 'rgba(60, 60, 67, 0.3)' },
  toolbarCollapsed: { height: 32, bottomMargin: 14, paddingX: 18, fontSize: 12.6 },
  glass: {
    blur: 2,
    // calibration/fit-glass.ts: saturate(2.25) · 0.48 + 0.538
    colorMatrix: [
      0.9524, -0.4291, -0.0433, 0, 0.538,
      -0.1276, 0.6509, -0.0433, 0, 0.538,
      -0.1276, -0.4291, 1.0367, 0, 0.538,
      0, 0, 0, 1, 0,
    ],
    ink: '#000000',
    rim: 'inset 0.6px 0.6px 0.6px rgba(255, 255, 255, 0.7), inset -0.4px -0.4px 0.6px rgba(255, 255, 255, 0.35)',
    shadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
  },
  // Measured on a red page edge under a green body (html-body-colors, scrolled).
  topPocket: { alphaStops: [[0, 0.81], [10, 0.75], [20, 0.67], [30, 0.55], [40, 0.41], [50, 0.27], [60, 0.16], [70, 0.08], [80, 0.03], [100, 0]] },
  // Measured from black text rows fading under the expanded toolbar (plain, top-hero).
  bottomPocket: { blur: 40, alphaStops: [[0, 0.8], [28, 0.8], [39, 0.76], [48, 0.69], [52, 0.65], [63, 0.54], [72, 0.42], [83, 0.29], [114, 0.03], [125, 0]] },
  refreshSpinner: { offsetTop: 30 },
}
