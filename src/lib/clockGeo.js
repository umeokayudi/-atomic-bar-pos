/**
 * GPS rule for a staff clock-in / clock-out (pure: shared by the staff app and /api/time-clock).
 *
 * The phone sends its position (or why it has none). When the bar has a location set, a punch that is
 * outside the radius or has no usable GPS needs a written justification; the server refuses it without
 * one, so the rule cannot be skipped from the browser. With no bar location the punch goes through as
 * 'no_venue' and the owner is told to set the location.
 */

import { haversineMeters } from './timeClock.js'

export const GEO_STATUSES = ['ok', 'outside', 'denied', 'unavailable', 'no_venue', 'manual']
/** Statuses an owner should look at (a badge on the punch). */
export const GEO_FLAGGED = new Set(['outside', 'denied', 'unavailable'])

export const DEFAULT_RADIUS_M = 150
export const MIN_RADIUS_M = 50
export const MAX_RADIUS_M = 500
export const JUSTIFICATION_MIN = 5
export const JUSTIFICATION_MAX = 500
/** Part of the phone's reported accuracy that counts in its favour (a fix indoors is often 30–80 m off). */
export const ACCURACY_ALLOWANCE_MAX_M = 100

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function clampRadius(value) {
  const n = num(value)
  if (n == null || n <= 0) return DEFAULT_RADIUS_M
  return Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, Math.round(n)))
}

function validLatLng(lat, lng) {
  return lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)
}

/** The bar's clock-in location from a bars / bar_geo row, or null when it is not set. */
export function venueOf(bar) {
  const lat = num(bar?.lat)
  const lng = num(bar?.lng)
  if (!validLatLng(lat, lng)) return null
  return { lat, lng, radius_m: clampRadius(bar?.geofence_m ?? bar?.radius_m) }
}

/** { lat, lng, accuracy } from the request, or null when it is missing or not a real position. */
export function cleanPosition(input) {
  const lat = num(input?.lat)
  const lng = num(input?.lng)
  if (!validLatLng(lat, lng)) return null
  const acc = num(input?.accuracy)
  return { lat, lng, accuracy: acc != null && acc >= 0 ? Math.round(acc) : null }
}

/** Browser GeolocationPositionError code (1/2/3) or a word → 'denied' | 'unavailable' | 'timeout'. */
export function geoErrorKind(code) {
  if (code === 1 || code === 'denied' || code === 'PERMISSION_DENIED') return 'denied'
  if (code === 3 || code === 'timeout' || code === 'TIMEOUT') return 'timeout'
  return 'unavailable'
}

export function cleanJustification(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, JUSTIFICATION_MAX)
}

/**
 * Decide a punch.
 *   venue: venueOf(bar) or null · position: cleanPosition(body) or null · geoError: why there is no position
 *   justification: the staff's text (required when needsJustification)
 * → { ok, geo_status, distance_m, needsJustification, justification, geo_error, code?, error? }
 */
export function evaluatePunchGeo({ venue, position, geoError, justification } = {}) {
  const text = cleanJustification(justification)
  const pos = position ? cleanPosition(position) : null
  const base = { geo: pos, distance_m: null, justification: text || null, geo_error: null }

  if (!venue) {
    return { ...base, ok: true, geo_status: 'no_venue', needsJustification: false }
  }

  let status = 'ok'
  if (!pos) {
    const kind = geoErrorKind(geoError)
    status = kind === 'denied' ? 'denied' : 'unavailable'
    base.geo_error = kind
  } else {
    const distance = Math.round(haversineMeters(pos.lat, pos.lng, venue.lat, venue.lng))
    base.distance_m = distance
    const allowance = Math.min(Math.max(0, pos.accuracy || 0), ACCURACY_ALLOWANCE_MAX_M)
    if (distance > venue.radius_m + allowance) status = 'outside'
  }

  if (status === 'ok') return { ...base, ok: true, geo_status: 'ok', needsJustification: false, justification: null }

  if (text.length < JUSTIFICATION_MIN) {
    return {
      ...base,
      ok: false,
      geo_status: status,
      needsJustification: true,
      code: 'justification_required',
      error: status === 'outside'
        ? `You are ${base.distance_m} m from the bar (limit ${venue.radius_m} m). Write why to clock here (at least ${JUSTIFICATION_MIN} characters).`
        : `GPS could not confirm you are at the bar (${base.geo_error}). Write why to clock now (at least ${JUSTIFICATION_MIN} characters).`,
    }
  }
  return { ...base, ok: true, geo_status: status, needsJustification: true }
}

/** What an owner needs to see on a punch: null when nothing to flag. */
export function punchGeoFlag(punch) {
  const status = punch?.geo_status
  if (!status || !GEO_FLAGGED.has(status)) return null
  return {
    status,
    distance: punch.distance_m != null && status === 'outside' ? Math.round(+punch.distance_m) : null,
    error: punch.geo_error || null,
    justification: punch.justification || '',
  }
}
