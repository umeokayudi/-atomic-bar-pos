import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import timeClock from './api/_routeTimeClock.js'
import barStaff from './api/_routeBarStaff.js'
import posStatus from './api/_routePosStatus.js'
import liveDb from './api/_routeBarLive.js'
import hqSync from './api/_routeHqSync.js'

const LOCAL_API = {
  '/api/time-clock': timeClock,
  '/api/bar-staff': barStaff,
  '/api/pos-status': posStatus,
  '/api/bar/live-db': liveDb,
  '/api/bar/hq-sync': hqSync,
}

function localApi() {
  return {
    name: 'local-bar-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = (req.url || '').split('?')[0]
        const handler = LOCAL_API[path]
        if (!handler) return next()
        try {
          const q = Object.fromEntries(new URL(req.url, 'http://local').searchParams)
          let body = {}
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            body = await new Promise(resolve => {
              const chunks = []
              req.on('data', c => chunks.push(c))
              req.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8')
                try { resolve(JSON.parse(raw || '{}')) } catch { resolve({}) }
              })
            })
          }
          const fakeReq = { method: req.method, headers: req.headers, query: q, body, url: req.url }
          res.status = code => { res.statusCode = code; return res }
          res.json = obj => {
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(obj ?? {}))
            return res
          }
          await handler(fakeReq, res)
          if (!res.writableEnded) res.end()
        } catch (e) {
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e.message }))
          }
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localApi()],
  build: {
    rollupOptions: {
      output: {
        // Libraries change far less often than app code: keep them in their own files so a
        // redeploy only makes browsers download the app part again (assets are cached as immutable).
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/@supabase/') || id.includes('/iceberg-js/') || id.includes('/tslib/')) return 'vendor-supabase'
          if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run)\//.test(id)) return 'vendor-react'
        },
      },
    },
  },
})
