/** NFC punch card: one UID per staff. Read by Web NFC (Chrome on Android) or a USB/Bluetooth reader that types the UID. */

/** "04:a2:3b:91" / "04-A2-3B-91" / "04a23b91\n" → "04A23B91". Empty when nothing usable. */
export function normalizeNfcUid(raw) {
  const s = String(raw || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
  return s.length >= 4 && s.length <= 40 ? s : ''
}

export function webNfcSupported() {
  return typeof window !== 'undefined' && 'NDEFReader' in window
}

/**
 * Wait for one card on the phone's own NFC (Android Chrome). Resolves with the normalized UID.
 * Rejects on abort, permission denied or an unreadable card.
 */
export async function readWebNfcOnce(signal) {
  const reader = new window.NDEFReader()
  await reader.scan({ signal })
  return new Promise((resolve, reject) => {
    const done = () => {
      reader.onreading = null
      reader.onreadingerror = null
    }
    reader.onreading = (event) => {
      const uid = normalizeNfcUid(event.serialNumber)
      if (!uid) return
      done()
      resolve(uid)
    }
    reader.onreadingerror = () => {
      done()
      reject(new Error('card_unreadable'))
    }
    signal?.addEventListener('abort', () => {
      done()
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}
