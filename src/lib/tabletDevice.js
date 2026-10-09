const KEY = barId => `jbm_tablet_${barId}`

export function getTabletToken(barId) {
  try { return localStorage.getItem(KEY(barId)) || '' } catch { return '' }
}

export function setTabletToken(barId, token) {
  try { localStorage.setItem(KEY(barId), token) } catch {}
}

export function clearTabletToken(barId) {
  try { localStorage.removeItem(KEY(barId)) } catch {}
}

export function readGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GPS unavailable'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      err => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    )
  })
}
