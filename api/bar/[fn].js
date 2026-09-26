/** Bar runtime: /api/bar/:fn — rewrites keep /api/time-clock query string. */
import timeClock from '../_routeTimeClock.js'
import barStaff from '../_routeBarStaff.js'
import posReorder from '../_routePosReorder.js'
import posStatus from '../_routePosStatus.js'
import liveDb from '../_routeBarLive.js'
import laneLogin from '../_routeLaneLogin.js'
import hqSync from '../_routeHqSync.js'

export default async function handler(req, res) {
  const fn = String(req.query?.fn || '')
  if (fn === 'time-clock') return timeClock(req, res)
  if (fn === 'bar-staff') return barStaff(req, res)
  if (fn === 'pos-reorder') return posReorder(req, res)
  if (fn === 'pos-status') return posStatus(req, res)
  if (fn === 'live-db') return liveDb(req, res)
  if (fn === 'lane-login') return laneLogin(req, res)
  if (fn === 'hq-sync') return hqSync(req, res)
  return res.status(404).json({ error: 'Unknown bar route' })
}
