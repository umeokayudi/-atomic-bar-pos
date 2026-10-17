import { useEffect, useState } from 'react'
import { staffFetch } from '../lib/apiAuth'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import { lockNow } from '../lib/vault'
import { forgetVaultStatus, loadVaultStatus } from './VaultGate'
import { PageHeader } from './ui/PageLayout'
import Icon from './ui/Icon'

const AREAS = ['money', 'payroll']
const MINUTES = [5, 15, 30, 60, 240]

/** Owner sets the PIN that opens money and payroll screens, which areas it covers and how long it stays open. */
export default function VaultSettings() {
  const { t } = useI18n()
  const [status, setStatus] = useState(null)
  const [areas, setAreas] = useState(AREAS)
  const [minutes, setMinutes] = useState(15)
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [current, setCurrent] = useState('')
  const [usePassword, setUsePassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)

  useEffect(() => {
    loadVaultStatus({ fresh: true }).then(s => {
      setStatus(s)
      if (s.enabled) setAreas(s.areas)
      setMinutes(s.minutes || 15)
    })
  }, [])

  const hasPin = !!status?.hasPin
  const digits = v => v.replace(/\D/g, '').slice(0, 8)

  async function send(extra) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await staffFetch('/api/bar-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setLock',
          areas,
          minutes,
          ...(usePassword ? { password: current } : { currentPin: current }),
          ...extra,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(errText(j.error, t('vault.failed')))
      const next = { ...status, ...j }
      forgetVaultStatus(next)
      setStatus(next)
      setPin(''); setPin2(''); setCurrent('')
      lockNow()
      setMsg({ tone: 'success', text: t(extra.disable ? 'vault.removed' : 'vault.saved') })
    } catch (e) {
      setMsg({ tone: 'danger', text: errText(e) })
    } finally {
      setBusy(false)
    }
  }

  function save(e) {
    e.preventDefault()
    if (pin && pin !== pin2) { setMsg({ tone: 'danger', text: t('vault.mismatch') }); return }
    if (!hasPin && pin.length < 4) { setMsg({ tone: 'danger', text: t('vault.pinRule') }); return }
    if (!areas.length) { setMsg({ tone: 'danger', text: t('vault.pickArea') }); return }
    send(pin ? { newPin: pin } : {})
  }

  if (!status) return null

  return (
    <div className="fade-in vault-settings">
      <PageHeader title={t('vault.settingsTitle')} subtitle={t('vault.settingsLead')} />

      <div className={`ui-banner ${status.enabled ? 'is-success' : 'is-info'}`}>
        <span className="ui-banner-icon"><Icon name="lock" size={18} /></span>
        <div>
          <strong>{status.enabled ? t('vault.onTitle') : t('vault.offTitle')}</strong>
          <div>{status.enabled ? t('vault.onBody', { areas: status.areas.map(a => t(`vault.area.${a}`)).join(', '), min: status.minutes }) : t('vault.offBody')}</div>
        </div>
      </div>

      {!status.canEdit ? (
        <p className="ui-card desk-note">{t('vault.ownerOnly')}</p>
      ) : (
        <form className="ui-card vault-form" onSubmit={save}>
          <fieldset className="vault-field">
            <legend>{t('vault.whatLocks')}</legend>
            {AREAS.map(a => (
              <label key={a} className="vault-check">
                <input type="checkbox" checked={areas.includes(a)} onChange={e => setAreas(cur => e.target.checked ? [...new Set([...cur, a])] : cur.filter(x => x !== a))} />
                <span><strong>{t(`vault.area.${a}`)}</strong><small>{t(`vault.areaHint.${a}`)}</small></span>
              </label>
            ))}
          </fieldset>

          <div className="vault-field">
            <span className="sord-label">{t('vault.openFor')}</span>
            <div className="ui-seg" role="radiogroup" aria-label={t('vault.openFor')}>
              {MINUTES.map(m => (
                <button key={m} type="button" role="radio" aria-checked={minutes === m} onClick={() => setMinutes(m)}>{m < 60 ? t('vault.min', { n: m }) : t('vault.hours', { n: m / 60 })}</button>
              ))}
            </div>
          </div>

          <div className="vault-pins">
            <label className="ui-field"><span>{hasPin ? t('vault.newPinOptional') : t('vault.newPin')}</span>
              <input type="password" inputMode="numeric" autoComplete="new-password" value={pin} onChange={e => setPin(digits(e.target.value))} placeholder="••••" />
            </label>
            <label className="ui-field"><span>{t('vault.repeatPin')}</span>
              <input type="password" inputMode="numeric" autoComplete="new-password" value={pin2} onChange={e => setPin2(digits(e.target.value))} placeholder="••••" />
            </label>
          </div>
          <p className="desk-note">{t('vault.pinRule')}</p>

          {hasPin && (
            <div className="vault-current">
              <label className="ui-field"><span>{usePassword ? t('vault.accountPassword') : t('vault.currentPin')}</span>
                <input
                  type="password"
                  inputMode={usePassword ? undefined : 'numeric'}
                  autoComplete={usePassword ? 'current-password' : 'off'}
                  value={current}
                  onChange={e => setCurrent(usePassword ? e.target.value : digits(e.target.value))}
                />
              </label>
              <button type="button" className="ui-btn is-ghost is-sm" onClick={() => { setUsePassword(v => !v); setCurrent('') }}>
                {usePassword ? t('vault.useCurrentPin') : t('vault.forgotUsePassword')}
              </button>
            </div>
          )}

          {msg && <div className={msg.tone === 'success' ? 'ui-badge is-success' : 'ui-error'} role={msg.tone === 'success' ? 'status' : 'alert'}>{msg.text}</div>}
          <div className="vault-actions">
            <button type="submit" className="ui-btn is-primary" disabled={busy || (hasPin && !current)}>
              <Icon name="lock" size={15} /> {busy ? t('common.saving') : hasPin ? t('vault.saveChanges') : t('vault.turnOn')}
            </button>
            {hasPin && (
              <button type="button" className="ui-btn is-danger is-ghost" disabled={busy || !current} onClick={() => send({ disable: true })}>
                {t('vault.remove')}
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
