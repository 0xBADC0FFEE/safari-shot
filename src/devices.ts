import type { Orientation } from './scenario.ts'

/** Safari's browser-tab geometry for one orientation, in points. All values measured on the iOS Simulator. */
export interface SafariGeometry {
  /** Area covered by the status bar; the layout viewport starts below it. */
  readonly topInset: number
  /** Area covered by the toolbar while it is expanded (page load, top or bottom of page). */
  readonly bottomInsetExpanded: number
  /** Area covered by the toolbar after scrolling collapses it to the URL pill. */
  readonly bottomInsetCollapsed: number
  readonly leftInset: number
  readonly rightInset: number
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

// iOS 26.5: the toolbar covers the same height on every iPhone (calibration/measure-devices.ts).
const BOTTOM_INSET_EXPANDED = 98
const BOTTOM_INSET_COLLAPSED = 58
const LANDSCAPE_NOT_CALIBRATED: SafariGeometry = { topInset: 0, bottomInsetExpanded: 0, bottomInsetCollapsed: 0, leftInset: 0, rightInset: 0 }

function safari26(topInset: number): DevicePreset['safari26'] {
  return {
    portrait: { topInset, bottomInsetExpanded: BOTTOM_INSET_EXPANDED, bottomInsetCollapsed: BOTTOM_INSET_COLLAPSED, leftInset: 0, rightInset: 0 },
    landscape: LANDSCAPE_NOT_CALIBRATED,
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
