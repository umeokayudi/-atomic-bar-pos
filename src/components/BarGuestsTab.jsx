import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtYen, fmtDate, Spinner, Empty, SectionTitle } from './utils'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import {
  GUEST_TAGS,
  searchGuests,
  toggleTag,
  guestSpendFromPos,
  birthdayThisMonth,
  birthdayToday,
  activeKeeps,
  keepExpiringSoon,
  crmTableMissing,
  withTimeout,
} from '../lib/barCrm'

const emptyForm = {
  nome: '', telefone: '', line_id: '', email: '', aniversario: '',
  preferencias: '', alergias: '', notas: '', preferred_host: '', tags: [], vip_member_id: '',
}

export default function BarGuestsTab({ bar }) {
  const { t } = useI18n()
  const [ready, setReady] = useState(null)
  const [guests, setGuests] = useState([])
  const [sales, setSales] = useState([])
  const [vips, setVips] = useState([])
  const [keeps, setKeeps] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState('')
  const [formErr, setFormErr] = useState('')
  const [q, setQ] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [editId, setEditId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [saving, setSaving] = useState(false)
  const [keepForm, setKeepForm] = useState({ nome: '', remaining_pct: 100, expires_on: '' })

  async function load() {
    setLoading(true)
    setLoadErr('')
    try {
      const [gR, sR, vR, kR] = await withTimeout(Promise.all([
        supabase.from('bar_guests').select('*').eq('bar_id', bar.id).order('nome'),
        supabase.from('pos_vendas').select('id,guest_id,total,data,criado_em,space_id').eq('bar_id', bar.id).order('criado_em', { ascending: false }).limit(400),
        supabase.from('vip_members').select('id,nome').eq('bar_id', bar.id).eq('ativo', true),
        supabase.from('bar_bottle_keeps').select('*').eq('bar_id', bar.id).eq('ativo', true).order('criado_em', { ascending: false }),
      ]))
      const err = gR.error || sR.error
      if (err && crmTableMissing(err)) {
        setReady({ ready: false, error: errText(err) })
        setGuests([])
        setSales([])
        setVips([])
        setKeeps([])
      } else {
        setReady({ ready: true })
        setGuests(gR.data || [])
        setSales(sR.data || [])
        setVips(vR.data || [])
        setKeeps(kR.error ? [] : (kR.data || []))
        if (err) setLoadErr(errText(err))
      }
    } catch (e) {
      setReady({ ready: false, error: errText(e) })
      setLoadErr(errText(e, t('guests.loadError')))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [bar.id])

  const list = searchGuests(guests.filter(g => g.ativo !== false), q)
  const monthBirthdays = birthdayThisMonth(guests.filter(g => g.ativo !== false))
  const todayBirthdays = birthdayToday(guests.filter(g => g.ativo !== false))

  async function save() {
    if (!form.nome.trim()) {
      setFormErr(t('guests.nameRequired'))
      return
    }
    setSaving(true)
    setFormErr('')
    const payload = {
      bar_id: bar.id,
      nome: form.nome.trim(),
      telefone: form.telefone || null,
      line_id: form.line_id || null,
      email: form.email || null,
      aniversario: form.aniversario || null,
      preferencias: form.preferencias || null,
      alergias: form.alergias || null,
      notas: form.notas || null,
      preferred_host: form.preferred_host || null,
      tags: form.tags || [],
      vip_member_id: form.vip_member_id || null,
      atualizado_em: new Date().toISOString(),
    }
    if (editId) await supabase.from('bar_guests').update(payload).eq('id', editId)
    else await supabase.from('bar_guests').insert(payload)
    setForm(emptyForm)
    setEditId(null)
    setSaving(false)
    load()
  }

  function startEdit(g) {
    setEditId(g.id)
    setForm({
      nome: g.nome || '',
      telefone: g.telefone || '',
      line_id: g.line_id || '',
      email: g.email || '',
      aniversario: g.aniversario || '',
      preferencias: g.preferencias || '',
      alergias: g.alergias || '',
      notas: g.notas || '',
      preferred_host: g.preferred_host || '',
      tags: g.tags || [],
      vip_member_id: g.vip_member_id || '',
    })
  }

  async function addKeep(guestId) {
    if (!keepForm.nome.trim()) return
    setSaving(true)
    await supabase.from('bar_bottle_keeps').insert({
      bar_id: bar.id,
      guest_id: guestId,
      nome: keepForm.nome.trim(),
      remaining_pct: Math.min(100, Math.max(0, +keepForm.remaining_pct || 100)),
      expires_on: keepForm.expires_on || null,
    })
    setKeepForm({ nome: '', remaining_pct: 100, expires_on: '' })
    setSaving(false)
    load()
  }

  async function finishKeep(id) {
    await supabase.from('bar_bottle_keeps').update({ ativo: false }).eq('id', id)
    load()
  }

  if (loading) return <Spinner text={t('guests.loading')} />
  if (!ready?.ready) {
    return (
      <div className="card guests-book" style={{ padding: 20 }}>
        <SectionTitle>{t('guests.title')}</SectionTitle>
        <p style={{ fontSize: 13, color: 'var(--text2)' }}>{asReactText(loadErr) || t('guests.setupHint')}</p>
        <button type="button" className="btn-primary" onClick={load} style={{ marginTop: 12 }}>{t('common.retry')}</button>
      </div>
    )
  }

  const profile = selected && guests.find(g => g.id === selected)
  const spend = profile ? guestSpendFromPos(sales, profile.id) : null
  const guestKeeps = profile ? activeKeeps(keeps, profile.id) : []

  return (
    <div className="fade-in guests-book">
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>{t('guests.title')}</div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>{t('guests.subtitle')}</div>
      {loadErr && <div className="pos-sale-err" style={{ marginBottom: 12 }}>{asReactText(loadErr)}</div>}

      {(todayBirthdays.length > 0 || monthBirthdays.length > 0) && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          {todayBirthdays.length > 0 && (
            <div style={{ fontWeight: 800, marginBottom: 4 }}>
              🎂 {t('guests.birthdayToday')}: {todayBirthdays.map(g => g.nome).join(', ')}
            </div>
          )}
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            {t('guests.birthdayMonth')}: {monthBirthdays.length ? monthBirthdays.map(g => g.nome).join(', ') : '—'}
          </div>
        </div>
      )}

      <div className="fluid-2">
        <div>
          <input className="guests-search" placeholder={t('guests.search')} value={q} onChange={e => setQ(e.target.value)} />
          {list.length === 0 ? <Empty text={t('guests.empty')} icon="🥂" /> : list.map(g => {
            const st = guestSpendFromPos(sales, g.id)
            const nKeeps = activeKeeps(keeps, g.id).length
            return (
              <button key={g.id} onClick={() => setSelected(g.id)} className="card" style={{
                width: '100%', textAlign: 'left', marginBottom: 8, padding: 14, cursor: 'pointer',
                borderColor: selected === g.id ? 'var(--navy)' : 'var(--border)',
              }}>
                <div style={{ fontWeight: 800 }}>{g.nome}</div>
                <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                  {g.line_id ? `LINE ${g.line_id}` : g.telefone || t('guests.noContact')}
                  {st.count ? ` · ${st.count} · ${fmtYen(st.total)}` : ''}
                  {nKeeps ? ` · キープ ${nKeeps}` : ''}
                </div>
                {(g.tags || []).length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {g.tags.map(tag => {
                      const meta = GUEST_TAGS.find(x => x.id === tag)
                      return (
                        <span key={tag} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: 'var(--bg3)' }}>
                          {meta ? t(meta.labelKey) : tag}
                        </span>
                      )
                    })}
                  </div>
                )}
              </button>
            )
          })}
        </div>

        <div>
          <div className="card guests-form" style={{ marginBottom: 16 }}>
            <SectionTitle>{editId ? t('guests.edit') : t('guests.new')}</SectionTitle>
            {formErr && <div className="pos-sale-err" style={{ marginBottom: 8 }}>{formErr}</div>}
            <label className="form-label">{t('guests.name')}
              <input placeholder={t('guests.name')} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <label className="form-label">{t('guests.phone')}
                <input placeholder={t('guests.phone')} value={form.telefone} onChange={e => setForm({ ...form, telefone: e.target.value })} />
              </label>
              <label className="form-label">{t('guests.lineId')}
                <input placeholder={t('guests.lineId')} value={form.line_id} onChange={e => setForm({ ...form, line_id: e.target.value })} />
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <label className="form-label">{t('guests.email')}
                <input placeholder={t('guests.email')} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </label>
              <label className="form-label">{t('guests.birthday')}
                <input type="date" value={form.aniversario} onChange={e => setForm({ ...form, aniversario: e.target.value })} />
              </label>
            </div>
            <label className="form-label">{t('guests.prefs')}
              <input placeholder={t('guests.prefs')} value={form.preferencias} onChange={e => setForm({ ...form, preferencias: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
            </label>
            <label className="form-label">{t('guests.allergies')}
              <input placeholder={t('guests.allergies')} value={form.alergias} onChange={e => setForm({ ...form, alergias: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
            </label>
            <label className="form-label">{t('guests.preferredHost')}
              <input placeholder={t('guests.preferredHost')} value={form.preferred_host} onChange={e => setForm({ ...form, preferred_host: e.target.value })} style={{ width: '100%', marginBottom: 8 }} />
            </label>
            <label className="form-label">{t('guests.notes')}
              <textarea placeholder={t('guests.notes')} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} rows={2} style={{ width: '100%', marginBottom: 8, resize: 'vertical' }} />
            </label>
            <label className="form-label">{t('guests.linkVipOptional')}
              <select value={form.vip_member_id} onChange={e => setForm({ ...form, vip_member_id: e.target.value })} style={{ width: '100%', marginBottom: 10 }}>
                <option value="">{t('guests.linkVipOptional')}</option>
                {vips.map(v => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              {GUEST_TAGS.map(tag => (
                <button key={tag.id} type="button" onClick={() => setForm({ ...form, tags: toggleTag(form.tags, tag.id) })} style={{
                  padding: '6px 10px', borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none',
                  background: (form.tags || []).includes(tag.id) ? 'var(--navy)' : 'var(--bg3)',
                  color: (form.tags || []).includes(tag.id) ? '#fff' : 'var(--text2)',
                }}>{t(tag.labelKey)}</button>
              ))}
            </div>
            <button type="button" className="btn-primary" disabled={saving} onClick={save} style={{ width: '100%', padding: 10 }}>
              {saving ? t('common.saving') : t('guests.save')}
            </button>
            {editId && (
              <button type="button" onClick={() => { setEditId(null); setForm(emptyForm); setFormErr('') }} style={{ width: '100%', marginTop: 8, padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent' }}>
                {t('common.cancel')}
              </button>
            )}
          </div>

          {profile && (
            <div className="card">
              <SectionTitle>{profile.nome}</SectionTitle>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 10 }}>
                {profile.line_id && <div>LINE {profile.line_id}</div>}
                {profile.telefone && <div>{profile.telefone}</div>}
                {profile.aniversario && <div>{t('guests.birthday')}: {fmtDate(profile.aniversario)}</div>}
                {profile.preferred_host && <div>{t('guests.preferredHost')}: {profile.preferred_host}</div>}
                {profile.preferencias && <div>{t('guests.prefs')}: {profile.preferencias}</div>}
                {profile.alergias && <div style={{ color: 'var(--red)' }}>{t('guests.allergies')}: {profile.alergias}</div>}
                {profile.notas && <div>{t('guests.notes')}: {profile.notas}</div>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div><div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('guests.visits')}</div><div style={{ fontWeight: 800 }}>{spend.count}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--text2)' }}>{t('guests.posSpend')}</div><div style={{ fontWeight: 800 }}>{fmtYen(spend.total)}</div></div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>{t('guests.spendHint')}</div>

              <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 8 }}>{t('guests.keepTitle')}</div>
              {guestKeeps.length === 0 && <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>{t('guests.keepEmpty')}</div>}
              {guestKeeps.map(k => (
                <div key={k.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 13 }}>
                  <div>
                    <span style={{ fontWeight: 700 }}>{k.nome}</span>
                    <span style={{ color: keepExpiringSoon(k) ? 'var(--red)' : 'var(--text2)' }}>
                      {` · ${k.remaining_pct}%`}
                      {k.expires_on ? ` · ${fmtDate(k.expires_on)}` : ''}
                    </span>
                  </div>
                  <button onClick={() => finishKeep(k.id)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}>
                    {t('guests.keepDone')}
                  </button>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 1fr auto', gap: 6, marginTop: 8, marginBottom: 12 }}>
                <input placeholder={t('guests.keepName')} value={keepForm.nome} onChange={e => setKeepForm({ ...keepForm, nome: e.target.value })} />
                <input type="number" min="0" max="100" value={keepForm.remaining_pct} onChange={e => setKeepForm({ ...keepForm, remaining_pct: e.target.value })} />
                <input type="date" value={keepForm.expires_on} onChange={e => setKeepForm({ ...keepForm, expires_on: e.target.value })} />
                <button className="btn-primary" disabled={saving} onClick={() => addKeep(profile.id)} style={{ padding: '8px 10px' }}>{t('guests.keepAdd')}</button>
              </div>

              <button onClick={() => startEdit(profile)} className="btn-primary" style={{ width: '100%', padding: 8 }}>{t('guests.edit')}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
