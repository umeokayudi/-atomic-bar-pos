/* JBM service worker: only push notifications (no offline cache, so app updates are never held back). */
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { data = { body: event.data ? event.data.text() : '' } }
  const title = data.title || 'JBM'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png?v=2',
    badge: data.badge || '/icons/icon-192.png?v=2',
    tag: data.tag,
    renotify: !!data.tag,
    data: { url: data.url || '/', type: data.type || '' },
    vibrate: [80, 40, 80],
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus()
        if ('navigate' in c) { try { await c.navigate(url) } catch { /* keep the open page */ } }
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
