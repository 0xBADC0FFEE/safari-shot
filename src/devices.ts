import type { Orientation } from './scenario.ts'

export interface Insets {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly right: number
}

/** Safari's browser-tab geometry for one orientation, in points. All values measured on the iOS Simulator. */
export interface SafariGeometry {
  /** Portrait puts the toolbar at the bottom under a status bar; landscape puts it at the top without one. */
  readonly toolbarEdge: 'top' | 'bottom'
  readonly statusBarVisible: boolean
  /**
   * Screen areas covered by browser chrome; the layout viewport is the rest. The toolbar is expanded on load
   * and at either end of the page, and collapses once a touch scroll moves the page.
   */
  readonly obscured: Readonly<Record<'expanded' | 'collapsed', Insets>>
}

/**
 * Where the status bar glyphs sit, in points.
 * `split`: time on the left of the sensor housing, signal/Wi-Fi/battery on the right.
 * `classic`: home-button phones — signal and Wi-Fi on the left, time centered, battery on the right.
 */
export type StatusBarLayout =
  | {
    readonly kind: 'split'
    readonly timeCenterX: number
    readonly timeBaseline: number
    readonly fontSize: number
    readonly iconsCenterY: number
    readonly trailingInset: number
  }
  | {
    readonly kind: 'classic'
    readonly timeBaseline: number
    readonly fontSize: number
    readonly iconsCenterY: number
    readonly sideInset: number
  }

export interface DevicePreset {
  readonly id: string
  readonly name: string
  /** Portrait screen size in points. */
  readonly screen: { readonly width: number, readonly height: number }
  readonly scale: number
  readonly safeArea: {
    readonly portrait: { readonly top: number, readonly bottom: number }
    readonly landscape: { readonly side: number, readonly bottom: number }
  }
  readonly statusBar: StatusBarLayout
  readonly safari26: Readonly<Record<Orientation, SafariGeometry>>
}

// iOS 26.5 (calibration/measure-devices.ts): the portrait toolbar covers the same height on every iPhone.
const PORTRAIT_BOTTOM_INSET_EXPANDED = 98
const PORTRAIT_BOTTOM_INSET_COLLAPSED = 58
// Landscape, one open tab, measured on iPhone 17: the top toolbar covers 64 pt and hides completely once collapsed.
const LANDSCAPE: SafariGeometry = {
  toolbarEdge: 'top',
  statusBarVisible: false,
  obscured: { expanded: { top: 64, bottom: 0, left: 0, right: 0 }, collapsed: { top: 0, bottom: 0, left: 0, right: 0 } },
}

function safari26(statusBarInset: number): DevicePreset['safari26'] {
  const portraitInsets = (bottom: number) => ({ top: statusBarInset, bottom, left: 0, right: 0 })
  return {
    portrait: {
      toolbarEdge: 'bottom',
      statusBarVisible: true,
      obscured: { expanded: portraitInsets(PORTRAIT_BOTTOM_INSET_EXPANDED), collapsed: portraitInsets(PORTRAIT_BOTTOM_INSET_COLLAPSED) },
    },
    landscape: LANDSCAPE,
  }
}

const DYNAMIC_ISLAND_402: StatusBarLayout = { kind: 'split', timeCenterX: 74, timeBaseline: 38.3, fontSize: 17, iconsCenterY: 33, trailingInset: 35 }

/** Screen sizes, insets and status bar layouts measured on iOS 26.5 Simulator. */
export const DEVICES: readonly DevicePreset[] = [
  {
    id: 'iphone-17-pro', name: 'iPhone 17 Pro', screen: { width: 402, height: 874 }, scale: 3,
    safeArea: { portrait: { top: 62, bottom: 34 }, landscape: { side: 62, bottom: 21 } },
    statusBar: DYNAMIC_ISLAND_402, safari26: safari26(62),
  },
  {
    id: 'iphone-17-pro-max', name: 'iPhone 17 Pro Max', screen: { width: 440, height: 956 }, scale: 3,
    safeArea: { portrait: { top: 62, bottom: 34 }, landscape: { side: 62, bottom: 21 } },
    statusBar: { kind: 'split', timeCenterX: 83.3, timeBaseline: 38.6, fontSize: 17, iconsCenterY: 32.7, trailingInset: 44 },
    safari26: safari26(62),
  },
  {
    id: 'iphone-17', name: 'iPhone 17', screen: { width: 402, height: 874 }, scale: 3,
    safeArea: { portrait: { top: 62, bottom: 34 }, landscape: { side: 62, bottom: 21 } },
    statusBar: DYNAMIC_ISLAND_402, safari26: safari26(62),
  },
  {
    id: 'iphone-air', name: 'iPhone Air', screen: { width: 420, height: 912 }, scale: 3,
    safeArea: { portrait: { top: 68, bottom: 34 }, landscape: { side: 68, bottom: 21 } },
    statusBar: { kind: 'split', timeCenterX: 77.3, timeBaseline: 44.6, fontSize: 17, iconsCenterY: 38.7, trailingInset: 38 },
    safari26: safari26(68),
  },
  {
    id: 'iphone-17e', name: 'iPhone 17e', screen: { width: 390, height: 844 }, scale: 3,
    safeArea: { portrait: { top: 47, bottom: 34 }, landscape: { side: 47, bottom: 21 } },
    statusBar: { kind: 'split', timeCenterX: 51.8, timeBaseline: 30.3, fontSize: 15.3, iconsCenterY: 25.1, trailingInset: 14 },
    safari26: safari26(47),
  },
  {
    id: 'iphone-16e', name: 'iPhone 16e', screen: { width: 390, height: 844 }, scale: 3,
    safeArea: { portrait: { top: 47, bottom: 34 }, landscape: { side: 47, bottom: 21 } },
    statusBar: { kind: 'split', timeCenterX: 51.8, timeBaseline: 30.3, fontSize: 15.3, iconsCenterY: 25.1, trailingInset: 14 },
    safari26: safari26(47),
  },
  {
    id: 'iphone-se-3', name: 'iPhone SE (3rd generation)', screen: { width: 375, height: 667 }, scale: 2,
    safeArea: { portrait: { top: 20, bottom: 0 }, landscape: { side: 0, bottom: 0 } },
    statusBar: { kind: 'classic', timeBaseline: 15, fontSize: 12, iconsCenterY: 10, sideInset: 6 },
    safari26: safari26(20),
  },
]

export const DEFAULT_DEVICE_ID = 'iphone-17-pro'

/**
 * Finds a device preset by id.
 * @param id preset id such as `iphone-17-pro`
 * @returns the preset
 * @throws when no preset has that id
 */
export function findDevice(id: string): DevicePreset {
  const device = DEVICES.find(d => d.id === id)
  if (!device) throw new Error(`unknown device "${id}"; known: ${DEVICES.map(d => d.id).join(', ')}`)
  return device
}

/**
 * Screen size in points for an orientation.
 * @param device device preset
 * @param orientation portrait or landscape
 * @returns width and height in points
 */
export function screenSize(device: DevicePreset, orientation: Orientation) {
  const { width, height } = device.screen
  return orientation === 'portrait' ? { width, height } : { width: height, height: width }
}
