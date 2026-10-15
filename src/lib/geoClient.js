/**
 * One GPS reading for a clock punch. Safari / iOS: works only on https and from a tap (user gesture),
 * so call it straight from the button's click handler.
 * Resolves { position: { lat, lng, accuracy } } or { error: 'denied' | 'unavailable' | 'timeout' }.
 */
import { geoErrorKind } from './clockGeo.js'

export function readPosition({ timeoutMs = 10000 } = {}) {
  return new Promise(resolve => {
    try {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({ error: 'unavailable', reason: 'unsupported' })
      if (typeof window !== 'undefined' && window.isSecureContext === false) return resolve({ error: 'unavailable', reason: 'insecure' })
      let settled = false
      const done = v => { if (!settled) { settled = true; resolve(v) } }
      // Some browsers never call back when the permission prompt is ignored: give up a little after the timeout.
      const guard = setTimeout(() => done({ error: 'timeout' }), timeoutMs + 2500)
      navigator.geolocation.getCurrentPosition(
        pos => {
          clearTimeout(guard)
          done({ position: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy || 0) } })
        },
        err => {
          clearTimeout(guard)
          done({ error: geoErrorKind(err?.code) })
        },
        { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
      )
    } catch {
      resolve({ error: 'unavailable' })
    }
  })
}
