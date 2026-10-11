import { useEffect, useRef, useState } from 'react'
import { normalizeNfcUid, readWebNfcOnce, webNfcSupported } from '../lib/nfcCard'
import { useI18n } from '../lib/i18n'

/**
 * "Tap the card now". Listens on the phone's NFC when the browser has it, and always on a hidden
 * field so a USB/Bluetooth reader (types the UID + Enter) works on iPad, PC or any tablet.
 */
export default function NfcCardPrompt({ title, onUid, onCancel }) {
  const { t } = useI18n()
  const inputRef = useRef(null)
  const [typed, setTyped] = useState('')
  const [nfcErr, setNfcErr] = useState('')
  const phoneNfc = webNfcSupported()
  const doneRef = useRef(false)

  function finish(uid) {
    if (doneRef.current || !uid) return
    doneRef.current = true
    onUid(uid)
  }

  useEffect(() => {
    if (!phoneNfc) return undefined
    const ctrl = new AbortController()
    readWebNfcOnce(ctrl.signal)
      .then(finish)
      .catch(e => {
        if (e?.name === 'AbortError') return
        setNfcErr(e?.name === 'NotAllowedError' ? t('nfc.permission') : t('nfc.readFailed'))
      })
    return () => ctrl.abort()
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function onKey(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const uid = normalizeNfcUid(typed)
    setTyped('')
    if (uid) finish(uid)
  }

  return (
    <div className="nfc-prompt" onClick={() => inputRef.current?.focus()}>
      <div className="nfc-prompt-icon" aria-hidden="true">((•))</div>
      <div className="nfc-prompt-title">{title}</div>
      <div className="nfc-prompt-hint">{phoneNfc ? t('nfc.tapPhone') : t('nfc.tapReader')}</div>
      {nfcErr && <div className="pos-sale-err" style={{ marginTop: 8 }}>{nfcErr}</div>}
      <input
        ref={inputRef}
        className="nfc-prompt-input"
        aria-label={t('nfc.readerField')}
        inputMode="none"
        autoComplete="off"
        value={typed}
        onChange={e => setTyped(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => { if (!doneRef.current) setTimeout(() => inputRef.current?.focus(), 50) }}
      />
      <button type="button" className="nfc-prompt-cancel" onClick={onCancel}>{t('common.cancel')}</button>
    </div>
  )
}
