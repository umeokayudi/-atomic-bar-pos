const EARTH_M = 6371000

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = d => (+d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function isInsideGeofence({ lat, lng, barLat, barLng, radiusM = 150, accuracyM = 0 }) {
  if (barLat == null || barLng == null || lat == null || lng == null) {
    return { ok: false, distance: null, reason: 'no_location' }
  }
  const distance = haversineMeters(lat, lng, barLat, barLng)
  const radius = Math.max(50, +radiusM || 150)
  if (accuracyM > 250) return { ok: false, distance, reason: 'accuracy' }
  if (distance > radius) return { ok: false, distance, reason: 'outside' }
  return { ok: true, distance, reason: null }
}
