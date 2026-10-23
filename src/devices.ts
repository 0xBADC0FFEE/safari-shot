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
  readonly safari26: Readonly<Record<Orientation, SafariGeometry>>
}

/** Screen sizes and insets for the devices this tool knows; toolbar geometry is filled per device. */
export const DEVICES: readonly DevicePreset[] = [
  {
    id: 'iphone-17-pro',
    name: 'iPhone 17 Pro',
    screen: { width: 402, height: 874 },
    scale: 3,
    safeArea: { portrait: { top: 62, bottom: 34 }, landscape: { side: 62, bottom: 21 } },
    safari26: {
      portrait: { topInset: 62, bottomInsetExpanded: 98, bottomInsetCollapsed: 58, leftInset: 0, rightInset: 0 },
      landscape: { topInset: 0, bottomInsetExpanded: 0, bottomInsetCollapsed: 0, leftInset: 0, rightInset: 0 },
    },
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
