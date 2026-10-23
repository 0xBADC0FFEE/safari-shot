export const SCROLL_STATES = ['initial', 'scrolled', 'overscroll-top', 'overscroll-bottom'] as const
export type ScrollState = typeof SCROLL_STATES[number]

export const THEMES = ['light', 'dark'] as const
export type Theme = typeof THEMES[number]

export const ORIENTATIONS = ['portrait', 'landscape'] as const
export type Orientation = typeof ORIENTATIONS[number]

export const MODES = ['browser', 'standalone'] as const
export type Mode = typeof MODES[number]

export const IOS_VERSIONS = ['26', '18'] as const
export type IosVersion = typeof IOS_VERSIONS[number]

/** One rendering of a page: everything that changes what Safari paints around it. */
export interface Scenario {
  readonly state: ScrollState
  readonly theme: Theme
  readonly orientation: Orientation
  readonly mode: Mode
}

/**
 * Builds the stable file-name stem for a scenario on a device.
 * @param deviceId device preset id
 * @param scenario scenario to name
 * @returns a stem such as `iphone-17-pro.portrait.light.initial`
 */
export function scenarioStem(deviceId: string, scenario: Scenario) {
  const mode = scenario.mode === 'standalone' ? '.standalone' : ''
  return `${deviceId}.${scenario.orientation}.${scenario.theme}.${scenario.state}${mode}`
}
