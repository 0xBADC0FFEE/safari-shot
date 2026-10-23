/** Safari 26 chrome drawing constants in points, measured from iOS 26.5 Simulator screenshots. */
export interface Chrome26 {
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
  readonly glass: {
    readonly blur: number
    readonly shadow: string
    /** Share of white mixed into the glass fill when the plan marks it whitened. */
    readonly whitenedMix: number
    readonly light: GlassVariant
    readonly dark: GlassVariant
  }
  /** Top scroll edge: the pocket color over content, alpha by distance from the screen top. */
  readonly topPocket: { readonly alphaStops: readonly AlphaStop[], readonly measuredTopInset: number }
  /** Bottom scroll edge under the expanded toolbar: the pocket color over content, alpha by distance from the screen bottom. */
  readonly bottomPocket: { readonly alphaStops: readonly AlphaStop[] }
  readonly refreshSpinner: { readonly offsetTop: number }
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

export const CHROME_26: Chrome26 = {
  fontFamily: `-apple-system, "SF Pro Text", "SF Pro", system-ui, "Inter", "Helvetica Neue", Arial, sans-serif`,
  toolbarExpanded: { height: 48, sideMargin: 34, gap: 7, bottomMargin: 34, fontSize: 17, pageMenuIconLeft: 16, reloadIconRight: 14 },
  toolbarCollapsed: { height: 32, bottomMargin: 14, paddingX: 18, fontSize: 12.6 },
  glass: {
    blur: 2,
    // Fitted on the red swatch: content is 11% darker at the pill's bottom edge, 2% at 33pt below it.
    shadow: '0 11px 42px rgba(0, 0, 0, 0.16)',
    // Fitted on fixed-both, fixed-bottom and body-gradient; measured over light glass only.
    whitenedMix: 0.24,
    light: {
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
    },
    dark: {
      // saturate(2.25) · 0.53 + 0.098
      colorMatrix: [
        1.0515, -0.4738, -0.0477, 0, 0.098,
        -0.141, 0.7187, -0.0477, 0, 0.098,
        -0.141, -0.4738, 1.1448, 0, 0.098,
        0, 0, 0, 1, 0,
      ],
      ink: '#ffffff',
      disabledInk: 'rgba(235, 235, 245, 0.3)',
      rim: 'inset 0 0 0 0.6px rgba(255, 255, 255, 0.14)',
    },
  },
  // Measured on a red page edge under a green body (html-body-colors, scrolled).
  topPocket: { alphaStops: [[0, 0.81], [10, 0.75], [20, 0.67], [30, 0.55], [40, 0.41], [50, 0.27], [60, 0.16], [70, 0.08], [80, 0.03], [100, 0]], measuredTopInset: 62 },
  // Measured on a black stripe over white and a white stripe over black (pocket-stripes, pocket-stripes-dark).
  bottomPocket: { alphaStops: [[0, 0.85], [16, 0.83], [28, 0.81], [40, 0.77], [52, 0.67], [64, 0.54], [76, 0.37], [88, 0.22], [100, 0.11], [112, 0.04], [124, 0.01], [136, 0]] },
  refreshSpinner: { offsetTop: 30 },
}
