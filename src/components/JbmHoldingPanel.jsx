import { useState, useEffect } from 'react'
import { Spinner } from './utils'
import {
  DEFAULT_HOLDING,
  loadHoldingLocal,
  saveHoldingLocal,
  syncHoldingFromCloud,
  syncHoldingToCloud,
} from '../lib/jbmHolding'
import JbmHoldingAI from './JbmHoldingAI'
import { useI18n } from '../lib/i18n'

export default function JbmHoldingPanel() {
  const { t } = useI18n()
  const [tab, setTab] = useState('ia')
  const [profile, setProfile] = useState(DEFAULT_HOLDING)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    syncHoldingFromCloud()
      .then(setProfile)
      .catch(() => setProfile(loadHoldingLocal()))
      .finally(() => setLoading(false))
  }, [])

  function updateNegocio(i, patch) {
    setProfile(p => {
      const negocios = [...p.negocios]
      negocios[i] = { ...negocios[i], ...patch }
      return { ...p, negocios }
    })
  }

  function addNegocio() {
    setProfile(p => ({
      ...p,
      negocios: [
        ...p.negocios,
        {
          id: 'neg-' + Date.now(),
          nome: t('holding.newBusiness'),
          tipo: 'servicos',
          custoOportunidadePct: 35,
          prioridade: 'media',
          notas: '',
        },
      ],
    }))
  }

  async function save() {
    setSaving(true)
    setMsg('')
    try {
      await syncHoldingToCloud(profile)
      setMsg(t('holding.synced'))
    } catch (e) {
      saveHoldingLocal(profile)
      setMsg(t('holding.savedLocal', { message: e.message }))
    }
    setSaving(false)
  }

  if (loading) return <Spinner text={t('holding.loading')} />

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>{t('holding.title')}</div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 4, lineHeight: 1.5 }}>
          {t('holding.subtitle')}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[
          ['ia', t('holding.tabAi')],
          ['config', t('holding.tabConfig')],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            style={{
              padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: tab === id ? 'var(--navy)' : 'var(--bg3)',
              color: tab === id ? 'white' : 'var(--text2)', border: 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'ia' && <JbmHoldingAI holdingProfile={profile} />}

      {tab === 'config' && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
              <div>
                <label className="form-label">{t('holding.oppCostBase')}</label>
                <input
                  type="number"
                  value={profile.custoOportunidadeBasePct}
                  onChange={e => setProfile(p => ({ ...p, custoOportunidadeBasePct: +e.target.value }))}
                />
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>{t('holding.oppCostHint')}</div>
              </div>
              <div>
                <label className="form-label">{t('holding.availableCapital')}</label>
                <input
                  type="number"
                  value={profile.capitalDisponivel || 0}
                  onChange={e => setProfile(p => ({ ...p, capitalDisponivel: +e.target.value }))}
                />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">{t('holding.capitalRule')}</label>
              <textarea
                value={profile.regraCapital || ''}
                onChange={e => setProfile(p => ({ ...p, regraCapital: e.target.value }))}
                rows={3}
                style={{ width: '100%', padding: 10, borderRadius: 10, fontSize: 13, resize: 'vertical' }}
                placeholder={t('holding.capitalRulePlaceholder')}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t('holding.businesses')}</div>
            <button type="button" onClick={addNegocio} style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--bg3)', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
              {t('holding.addBusiness')}
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
            {profile.negocios.map((n, i) => (
              <div key={n.id} style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10, marginBottom: 8 }}>
                  <div>
                    <label className="form-label">{t('holding.name')}</label>
                    <input value={n.nome} onChange={e => updateNegocio(i, { nome: e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">{t('holding.type')}</label>
                    <select value={n.tipo} onChange={e => updateNegocio(i, { tipo: e.target.value })}>
                      <option value="bebidas">{t('holding.typeDrinks')}</option>
                      <option value="servicos">{t('holding.typeServices')}</option>
                      <option value="imobiliario">{t('holding.typeRealEstate')}</option>
                      <option value="outro">{t('holding.typeOther')}</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t('holding.oppCostPct')}</label>
                    <input type="number" value={n.custoOportunidadePct} onChange={e => updateNegocio(i, { custoOportunidadePct: +e.target.value })} />
                  </div>
                  <div>
                    <label className="form-label">{t('holding.priority')}</label>
                    <select value={n.prioridade} onChange={e => updateNegocio(i, { prioridade: e.target.value })}>
                      <option value="alta">{t('holding.priorityHigh')}</option>
                      <option value="media">{t('holding.priorityMedium')}</option>
                      <option value="baixa">{t('holding.priorityLow')}</option>
                    </select>
                  </div>
                </div>
                <input
                  value={n.notas || ''}
                  onChange={e => updateNegocio(i, { notas: e.target.value })}
                  placeholder={t('holding.notesPlaceholder')}
                  style={{ width: '100%', fontSize: 12 }}
                />
              </div>
            ))}
          </div>

          <button type="button" className="btn-primary" onClick={save} disabled={saving}>
            {saving ? t('holding.syncing') : t('holding.saveSync')}
          </button>
          {msg && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text2)' }}>{msg}</span>}
        </>
      )}
    </div>
  )
}
