// The opening animation lives in index.html so it shows before any JS arrives.
// The app calls this once it has something real to show (login, the bar portal, HQ).
export function hideBootSplash() {
  if (typeof window !== 'undefined' && typeof window.__jbmHideSplash === 'function') window.__jbmHideSplash()
}
