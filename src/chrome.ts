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
    readonly backdropFilter: string
    readonly tint: string
    readonly rim: string
    readonly shadow: string
  }
  /** Scroll edge effect: content fades into the pocket color under the bars. */
  readonly topPocket: Pocket
  readonly bottomPocket: Pocket
  readonly refreshSpinner: { readonly offsetTop: number }
}

export interface Pocket {
  /** How far the effect reaches past the obscured inset, into the page. */
  readonly overhang: number
  /** [offset 0–1 from the screen edge, pocket color alpha]. */
  readonly alphaStops: readonly (readonly [number, number])[]
  readonly blur: number
  /** Fraction of the pocket height that is fully blurred before the blur fades out. */
  readonly blurSolidUntil: number
}

export const CHROME_26: Chrome26 = {
  fontFamily: `-apple-system, "SF Pro Text", "SF Pro", system-ui, "Inter", "Helvetica Neue", Arial, sans-serif`,
  statusBar: { height: 54, timeCenterX: 74, timeBaseline: 38.3, timeFontSize: 17, iconsCenterY: 33, trailingInset: 35 },
  toolbarExpanded: { height: 48, sideMargin: 34, gap: 7, bottomMargin: 34, fontSize: 17, pageMenuIconLeft: 16, reloadIconRight: 14, disabledIconColor: 'rgba(60, 60, 67, 0.3)' },
  toolbarCollapsed: { height: 32, bottomMargin: 14, paddingX: 18, fontSize: 12.6 },
  glass: {
    backdropFilter: 'blur(2px) saturate(1.8) brightness(1.15)',
    tint: 'rgba(255, 255, 255, 0.3)',
    rim: 'inset 0.6px 0.6px 0.6px rgba(255, 255, 255, 0.7), inset -0.4px -0.4px 0.6px rgba(255, 255, 255, 0.35)',
    shadow: '0 4px 16px rgba(0, 0, 0, 0.06)',
  },
  topPocket: { overhang: 12, alphaStops: [[0, 0.7], [0.6, 0.45], [1, 0]], blur: 1.5, blurSolidUntil: 0.6 },
  bottomPocket: { overhang: 16, alphaStops: [[0, 0.75], [0.6, 0.5], [1, 0]], blur: 1.5, blurSolidUntil: 0.6 },
  refreshSpinner: { offsetTop: 30 },
}
