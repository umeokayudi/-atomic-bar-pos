import { useEffect, useMemo, useRef, useState } from 'react'
import { staffFetch } from '../lib/apiAuth'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { areaForTab, lockNow, onVault, setVault, timeLeft, vaultState } from '../lib/vault'
import Icon from './ui/Icon'

const STATUS_TTL = 60_000
let cached = null
let cachedAt = 0
let inflight = null

/** The bar's lock settings (never the PIN). Fails open on the screen; the API still refuses locked changes. */
export function loadVaultStatus({ fresh } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < STATUS_TTL) return Promise.resolve(cached)
  if (!fresh && inflight) return inflight
  inflight = staffFetch('/api/bar-staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'lockStatus' }),
  })
    .then(r => r.json())
    .then(j => {
      cached = j?.error ? { enabled: false, areas: [], minutes: 15, canEdit: false } : j
      cachedAt = Date.now()
      return cached
    })
    .catch(() => ({ enabled: false, areas: [], minutes: 15, canEdit: false }))
    .finally(() => { inflight = null })
  return inflight
}

export function forgetVaultStatus(next) {
  cached = next || null
  cachedAt = next ? Date.now() : 0
}

/** Is this screen behind the owner's PIN right now? Returns the lock screen or the "unlocked" strip to show. */
export function useVaultLock(tab) {
  const area = tab ? areaForTab(tab) : null
  const [status, setStatus] = useState(() => cached)
  const [open, setOpen] = useState(() => vaultState())

  useEffect(() => onVault(v => { setOpen(v); loadVaultStatus().then(setStatus) }), [])
  useEffect(() => {
    if (!area) return undefined
    let alive = true
    loadVaultStatus().then(s => { if (alive) setStatus(s) })
    return () => { alive = false }
  }, [area])
  useEffect(() => {
    if (!open) return undefined
    const id = setTimeout(() => setOpen(vaultState()), Math.max(0, open.exp - Date.now()) + 50)
    return () => clearTimeout(id)
  }, [open])

  const guarded = !!(area && status?.enabled && (status.areas || []).includes(area))
  const loading = !!area && !status
  return {
    area,
    locked: loading || (guarded && !open),
    loading,
    gate: <VaultGate area={area} loading={loading} />,
    strip: guarded && open ? <VaultStrip exp={open.exp} /> : null,
  }
}

function VaultStrip({ exp }) {
  const { t } = useI18n()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const left = timeLeft(exp, now)
  return (
    <div className="vault-strip" role="status">
      <Icon name="lock" size={14} />
      <span>{t('vault.unlockedFor', { time: `${left.min}:${String(left.sec).padStart(2, '0')}` })}</span>
      <button type="button" className="ui-btn is-sm is-ghost" onClick={lockNow}>{t('vault.lockNow')}</button>
    </div>
  )
}

function VaultGate({ area, loading }) {
  const { t } = useI18n()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [retryAt, setRetryAt] = useState(0)
  const input = useRef(null)
  const waiting = retryAt > Date.now()

  useEffect(() => { if (!loading) input.current?.focus() }, [loading])
  useEffect(() => {
    if (!waiting) return undefined
    const id = setTimeout(() => setRetryAt(0), retryAt - Date.now() + 50)
    return () => clearTimeout(id)
  }, [retryAt, waiting])

  async function unlock(e) {
    e.preventDefault()
    if (!/^\d{4,8}$/.test(pin) || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await staffFetch('/api/bar-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlock', pin }),
      })
      const j = await r.json().catch(() => ({}))
      if (r.ok && j.token) {
        setPin('')
        setVault(j.token, j.exp)
        return
      }
      setPin('')
      if (r.status === 429) {
        setRetryAt(+j.retryAt || Date.now() + 5 * 60000)
        setErr(t('vault.tooMany'))
      } else if (r.status === 401) {
        setErr(t('vault.wrong', { n: j.left ?? 0 }))
      } else {
        setErr(errText(j.error, t('vault.failed')))
      }
    } catch (e2) {
      setErr(errText(e2, t('vault.failed')))
    } finally {
      setBusy(false)
    }
  }

  const dots = useMemo(() => Array.from({ length: Math.max(4, pin.length) }, (_, i) => i < pin.length), [pin])

  if (loading) return <div className="vault-gate is-loading" aria-busy="true" />

  return (
    <section className="vault-gate" aria-labelledby="vault-title">
      <form className="ui-card vault-card" onSubmit={unlock}>
        <span className="vault-icon" aria-hidden="true"><Icon name="lock" size={26} /></span>
        <h1 id="vault-title">{t(`vault.title.${area}`)}</h1>
        <p className="desk-note">{t('vault.lead')}</p>
        <div className="vault-dots" aria-hidden="true">{dots.map((on, i) => <span key={i} className={on ? 'is-on' : ''} />)}</div>
        <label className="vault-input">
          <span className="sr-only">{t('vault.pin')}</span>
          <input
            ref={input}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            pattern="\d*"
            maxLength={8}
            value={pin}
            disabled={waiting}
            placeholder={t('vault.pinPlaceholder')}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
          />
        </label>
        {err && <div className="ui-error" role="alert">{err}</div>}
        <button type="submit" className="ui-btn is-primary is-lg" disabled={busy || waiting || pin.length < 4}>
          <Icon name="lock" size={16} /> {busy ? t('vault.checking') : t('vault.unlock')}
        </button>
        <p className="desk-note vault-forgot">{t('vault.forgot')}</p>
      </form>
    </section>
  )
}
