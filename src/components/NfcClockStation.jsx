import { useEffect, useState } from 'react'
import NfcCardPrompt from './NfcCardPrompt'
import { postClockMark } from '../lib/clockApi'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'

function hhmm(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Start / End shift with the staff NFC card. Press a button, tap the card, done. */
export default function NfcClockStation({ bar, onPunched }) {
  const { t } = useI18n()
  const [waiting, setWaiting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!done) return undefined
    const id = setTimeout(() => setDone(null), 5000)
    return () => clearTimeout(id)
  }, [done])

  function start(tipo) {
    setErr(''); setDone(null); setWaiting(tipo)
  }

  async function punch(uid) {
    const tipo = waiting
    setWaiting(null); setBusy(true)
    try {
      const json = await postClockMark({ barId: bar.id, tipo, nfcUid: uid })
      setDone({ tipo, nome: json.staff?.nome || '', at: json.punch?.punched_at || new Date().toISOString() })
      onPunched?.()
    } catch (e) {
      setErr(errText(e))
    }
    setBusy(false)
  }

  return (
    <div className="card nfc-station">
      <div className="people-me-kicker">{t('nfc.stationKicker')}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', margin: '4px 0 12px' }}>{t('nfc.stationHint')}</div>
      {waiting ? (
        <NfcCardPrompt
          title={waiting === 'in' ? t('nfc.tapToStart') : t('nfc.tapToEnd')}
          onUid={punch}
          onCancel={() => setWaiting(null)}
        />
      ) : (
        <div className="nfc-station-btns">
          <button type="button" className="people-in people-me-btn" disabled={busy} onClick={() => start('in')}>
            {busy ? t('common.wait') : t('nfc.startShift')}
          </button>
          <button type="button" className="people-out people-me-btn" disabled={busy} onClick={() => start('out')}>
            {busy ? t('common.wait') : t('nfc.endShift')}
          </button>
        </div>
      )}
      {done && (
        <div className={`nfc-done ${done.tipo === 'in' ? 'is-in' : 'is-out'}`}>
          {t(done.tipo === 'in' ? 'nfc.startedAt' : 'nfc.endedAt', { name: done.nome, time: hhmm(done.at) })}
        </div>
      )}
      {err && <div className="pos-sale-err" style={{ marginTop: 10 }}>{asReactText(err)}</div>}
    </div>
  )
}
