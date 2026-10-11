import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useI18n } from '../../lib/i18n'
import { DEFAULT_POS_SETTINGS, settingsFromRow } from '../../lib/nightTicket'
import { normalizeCardMachines } from '../../lib/posFloor'
import Icon from '../ui/Icon'

const pctOk = (v, max) => v !== '' && !Number.isNaN(+v) && +v >= 0 && +v <= max

/**
 * Bar payment settings, kept on the bar's pos_settings row (same row the till already reads):
 * service charge %, card machines (name + fee %) and the optional card surcharge % for the guest.
 */
export default function PosPaySettings({ bar }) {
  const { t } = useI18n()
  const [row, setRow] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const { data, error } = await supabase.from('pos_settings').select('*').eq('bar_id', bar.id).maybeSingle()
    if (error) setErr(error.message)
    const s = settingsFromRow(data)
    setRow(data || null)
    setForm({
      service_pct: String(s.service_pct),
      card_surcharge_pct: String(s.card_surcharge_pct),
      card_machines: s.card_machines.map(m => ({ ...m, fee_pct: String(m.fee_pct) })),
    })
  }

  useEffect(() => { load() }, [bar.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!form) return null

  const setMachine = (i, patch) => setForm(f => ({ ...f, card_machines: f.card_machines.map((m, j) => (j === i ? { ...m, ...patch } : m)) }))
  const addMachine = () => setForm(f => ({
    ...f,
    card_machines: [...f.card_machines, { id: `card-${Date.now().toString(36)}`, nome: '', fee_pct: String(DEFAULT_POS_SETTINGS.card_machines[0].fee_pct) }],
  }))
  const removeMachine = i => setForm(f => ({ ...f, card_machines: f.card_machines.filter((_, j) => j !== i) }))

  const valid = pctOk(form.service_pct, 30) && pctOk(form.card_surcharge_pct, 20)
    && form.card_machines.length > 0
    && form.card_machines.every(m => String(m.nome).trim() && pctOk(m.fee_pct, 20))

  async function save(e) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setErr('')
    setMsg('')
    const card_machines = normalizeCardMachines(form.card_machines)
    const patch = {
      service_pct: +form.service_pct,
      card_surcharge_pct: +form.card_surcharge_pct,
      card_machines,
    }
    try {
      const res = row
        ? await supabase.from('pos_settings').update(patch).eq('bar_id', bar.id)
        : await supabase.from('pos_settings').insert({
          bar_id: bar.id,
          room_min: DEFAULT_POS_SETTINGS.room_min,
          set_minutes: DEFAULT_POS_SETTINGS.set_minutes,
          set_price: DEFAULT_POS_SETTINGS.set_price,
          ...patch,
        })
      if (res.error) throw new Error(res.error.message)
      // Read back: a store that drops unknown fields would silently lose the machines.
      const check = await supabase.from('pos_settings').select('*').eq('bar_id', bar.id).maybeSingle()
      if (check.error) throw new Error(check.error.message)
      if (!Array.isArray(check.data?.card_machines)) throw new Error(t('posCard.notStored'))
      setMsg(t('posCard.saved'))
      await load()
    } catch (e2) {
      setErr(e2.message || String(e2))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="ui-card" onSubmit={save} style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
      <div>
        <div className="ui-card-title">{t('posCard.title')}</div>
        <div className="ui-card-sub">{t('posCard.subtitle')}</div>
      </div>

      <div className="ui-row is-wrap" style={{ alignItems: 'flex-end' }}>
        <label className="ui-field" style={{ width: 160 }}><span>{t('posCard.servicePct')}</span>
          <input type="number" inputMode="decimal" min="0" max="30" step="0.5" value={form.service_pct} onChange={e => setForm(f => ({ ...f, service_pct: e.target.value }))} />
        </label>
        <label className="ui-field" style={{ width: 160 }}><span>{t('posCard.surchargePct')}</span>
          <input type="number" inputMode="decimal" min="0" max="20" step="0.1" value={form.card_surcharge_pct} onChange={e => setForm(f => ({ ...f, card_surcharge_pct: e.target.value }))} />
        </label>
      </div>
      <div className="ui-muted" style={{ fontSize: 12 }}>{t('posCard.surchargeHelp')}</div>

      <div className="ui-card-title">{t('posCard.machines')}</div>
      <div className="ui-muted" style={{ fontSize: 12 }}>{t('posCard.machinesHelp')}</div>
      {form.card_machines.map((m, i) => (
        <div key={m.id} className="ui-row is-wrap" style={{ alignItems: 'flex-end' }}>
          <label className="ui-field" style={{ flex: '1 1 160px', minWidth: 0 }}><span>{t('posCard.machineName')}</span>
            <input value={m.nome} maxLength={40} onChange={e => setMachine(i, { nome: e.target.value })} placeholder="Square, Airペイ…" />
          </label>
          <label className="ui-field" style={{ width: 110 }}><span>{t('posCard.feePct')}</span>
            <input type="number" inputMode="decimal" min="0" max="20" step="0.01" value={m.fee_pct} onChange={e => setMachine(i, { fee_pct: e.target.value })} />
          </label>
          <button type="button" className="ui-btn is-ghost is-icon" disabled={form.card_machines.length <= 1} onClick={() => removeMachine(i)} aria-label={t('posCard.removeMachine', { name: m.nome || '' })}>
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
      <div className="ui-row is-wrap">
        <button type="button" className="ui-btn is-sm" onClick={addMachine}><Icon name="plus" size={14} /> {t('posCard.addMachine')}</button>
        <span className="ui-spacer" />
        <button type="submit" className="ui-btn is-primary" disabled={!valid || busy}>{busy ? t('posQuick.saving') : t('common.save')}</button>
      </div>
      {!valid && <div className="ui-muted" role="status">{t('posCard.invalid')}</div>}
      {msg && <div className="txt-success" role="status">{msg}</div>}
      {err && <div className="pq-alert" role="alert">{err}</div>}
    </form>
  )
}
