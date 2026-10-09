/** Saved till layout. Viewport may suggest a choice. It never overwrites a saved one. */

export function posDeviceModeKey(userId) {
  return userId ? `POS_DEVICE_MODE:${userId}` : 'POS_DEVICE_MODE'
}

export function readPosDeviceMode(userId, storage = globalThis.localStorage) {
  if (!storage) return null
  const raw = storage.getItem(posDeviceModeKey(userId)) || storage.getItem('POS_DEVICE_MODE')
  return raw === 'mobile' || raw === 'tablet' ? raw : null
}

export function writePosDeviceMode(userId, mode, storage = globalThis.localStorage) {
  if (mode !== 'mobile' && mode !== 'tablet') throw new Error('unknown pos device mode')
  if (!storage) return mode
  storage.setItem(posDeviceModeKey(userId), mode)
  storage.setItem('POS_DEVICE_MODE', mode)
  return mode
}

/** Hint for the first question only. Short side and width, not the user agent. */
export function suggestPosDeviceMode(viewport = {}) {
  const width = Number(viewport.width) || 0
  const height = Number(viewport.height) || 0
  const shortSide = Math.min(width, height)
  if (shortSide >= 700 || width >= 1024) return 'tablet'
  return 'mobile'
}
