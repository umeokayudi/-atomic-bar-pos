import { useState } from 'react'
import { AI_STRATEGIES, favoriteKey, normalizeWeights } from '../../lib/posEngine'

export default function PosBarSettings({ t, config, catalog = [], onSave, onClose, saving }) {
  const [draft, setDraft] = useState(config)
  const weights = normalizeWeights(draft.ai_weights)
  const featured = new Set(draft.featured || [])

  function patch(partial) {
    setDraft(prev => ({ ...prev, ...partial }))
  }

  function setWeight(key, value) {
    patch({ ai_weights: { ...draft.ai_weights, [key]: Math.max(0, Number(value) || 0) } })
  }

  function toggleFeatured(product) {
    const key = favoriteKey(product)
    const next = new Set(featured)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    patch({ featured: [...next] })
  }

  function toggleFavorite(product) {
    const key = favoriteKey(product)
    const next = new Set(draft.favorites || [])
    if (next.has(key)) next.delete(key)
    else next.add(key)
    patch({ favorites: [...next] })
  }

  return (
    <div className="pos-settings-screen">
      <header className="pos-t-top">
        <strong>{t('posFloor.settingsTitle')}</strong>
        <button type="button" onClick={onClose}>{t('posFloor.confirmCancel')}</button>
      </header>

      <section>
        <h3>{t('posFloor.aiTitle')}</h3>
        <label className="pos-check">
          <input type="checkbox" checked={draft.ai_enabled} onChange={event => patch({ ai_enabled: event.target.checked })} />
          {t('posFloor.aiOn')}
        </label>
        {AI_STRATEGIES.map(key => (
          <label key={key} className="pos-weight">
            <span>{t(`posFloor.ai_${key}`)}</span>
            <input
              inputMode="numeric"
              value={draft.ai_weights[key] || ''}
              onChange={event => setWeight(key, event.target.value)}
            />
            <small>{Math.round((weights[key] || 0) * 100)}%</small>
          </label>
        ))}
      </section>

      <section>
        <h3>{t('posFloor.featured')}</h3>
        <div className="pos-chip-row">
          {catalog.filter(product => product.ativo !== false).map(product => (
            <button
              key={favoriteKey(product)}
              type="button"
              className={featured.has(favoriteKey(product)) ? 'is-on' : ''}
              onClick={() => toggleFeatured(product)}
            >
              {product.nome}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>{t('posFloor.favorites')}</h3>
        <div className="pos-chip-row">
          {catalog.filter(product => product.ativo !== false).map(product => (
            <button
              key={`fav-${favoriteKey(product)}`}
              type="button"
              className={(draft.favorites || []).includes(favoriteKey(product)) ? 'is-on' : ''}
              onClick={() => toggleFavorite(product)}
            >
              {product.nome}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>{t('posFloor.chargesTitle')}</h3>
        <label className="pos-check">
          <input type="checkbox" checked={draft.service_enabled} onChange={event => patch({ service_enabled: event.target.checked })} />
          {t('posFloor.serviceOn')}
        </label>
        <div className="pos-chip-row">
          <button type="button" className={draft.service_type === 'percentage' ? 'is-on' : ''} onClick={() => patch({ service_type: 'percentage' })}>{t('posFloor.percent')}</button>
          <button type="button" className={draft.service_type === 'fixed' ? 'is-on' : ''} onClick={() => patch({ service_type: 'fixed' })}>{t('posFloor.fixed')}</button>
        </div>
        <input inputMode="decimal" value={draft.service_value} onChange={event => patch({ service_value: event.target.value })} />
        <label className="pos-check"><input type="checkbox" checked={draft.service_dine_in} onChange={event => patch({ service_dine_in: event.target.checked })} />{t('posFloor.dineIn')}</label>
        <label className="pos-check"><input type="checkbox" checked={draft.service_takeaway} onChange={event => patch({ service_takeaway: event.target.checked })} />{t('posFloor.takeaway')}</label>
        <label className="pos-check"><input type="checkbox" checked={draft.service_delivery} onChange={event => patch({ service_delivery: event.target.checked })} />{t('posFloor.delivery')}</label>

        <label className="pos-check">
          <input type="checkbox" checked={draft.tax_enabled} onChange={event => patch({ tax_enabled: event.target.checked })} />
          {t('posFloor.taxOn')}
        </label>
        <input inputMode="decimal" value={draft.tax_rate} onChange={event => patch({ tax_rate: event.target.value })} />

        <label className="pos-check">
          <input type="checkbox" checked={draft.card_surcharge_enabled} onChange={event => patch({ card_surcharge_enabled: event.target.checked })} />
          {t('posFloor.surchargeOn')}
        </label>
        <label className="pos-weight"><span>{t('posFloor.creditRate')}</span><input inputMode="decimal" value={draft.card_credit_pct} onChange={event => patch({ card_credit_pct: event.target.value })} /></label>
        <label className="pos-weight"><span>{t('posFloor.debitRate')}</span><input inputMode="decimal" value={draft.card_debit_pct} onChange={event => patch({ card_debit_pct: event.target.value })} /></label>
        <label className="pos-weight"><span>{t('posFloor.otherRate')}</span><input inputMode="decimal" value={draft.card_other_pct} onChange={event => patch({ card_other_pct: event.target.value })} /></label>
        <p className="pos-floor-meta">{t('posFloor.chargeNote')}</p>
      </section>

      <button type="button" className="pos-t-charge" disabled={saving} onClick={() => onSave(draft)}>
        {saving ? t('posFloor.saving') : t('posFloor.saveSettings')}
      </button>
    </div>
  )
}
