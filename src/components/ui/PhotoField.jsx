import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { uploadDrinkPhoto } from '../../lib/drinkPhoto'
import { useI18n } from '../../lib/i18n'
import Icon from './Icon'

/** Photo for a drink: take or pick a picture (shrunk before upload), or paste a link. Value is the image URL. */
export default function PhotoField({ value, onChange, scope, name, client = supabase }) {
  const { t } = useI18n()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setErr('')
    try {
      onChange(await uploadDrinkPhoto(client, file, { scope, name }))
    } catch (x) {
      setErr(x.code === 'bucket' ? t('photo.noBucket') : (x.message || t('photo.failed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="photo-field">
      <div className="photo-field-thumb" aria-hidden={!value}>
        {value ? <img src={value} alt={name || ''} loading="lazy" /> : <Icon name="image" size={22} />}
      </div>
      <div className="photo-field-main">
        <div className="photo-field-actions">
          <button type="button" className="ui-btn is-sm" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="image" size={15} /> {busy ? t('photo.uploading') : (value ? t('photo.change') : t('photo.add'))}
          </button>
          {value && <button type="button" className="ui-btn is-ghost is-sm" disabled={busy} onClick={() => onChange('')}><Icon name="trash" size={15} /> {t('photo.remove')}</button>}
        </div>
        <input type="url" value={value || ''} onChange={e => onChange(e.target.value)} placeholder={t('photo.orLink')} aria-label={t('photo.orLink')} />
        {err && <div className="photo-field-err" role="alert">{err}</div>}
      </div>
      <input ref={input} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
    </div>
  )
}
