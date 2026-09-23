import { useEffect, useMemo, useState } from 'react'
import { supabase, BAR_ID } from '../../lib/supabase'
import { fmt, todayTokyo, labelForma, inputStyle } from '../../lib/format'
import { calcularAPagar } from '../../lib/payroll'
import { Field, Modal, GoldButton, GhostButton, SolidButton, Empty, Chip } from '../../components/ui'

export default function Pagamentos({ tick }) {
  const [staff, setStaff] = useState([])
  const [horas, setHoras] = useState([])
  const [comissoes, setComissoes] = useState([])
  const [pagamentos, setPagamentos] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useState('a_pagar')
  const [horaModal, setHoraModal] = useState(null)
  const [horaForm, setHoraForm] = useState({ data: todayTokyo(), horas: '', observacao: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const monthStart = todayTokyo().slice(0, 7) + '-01'
    const [{ data: s }, { data: h }, { data: c }, { data: p }] = await Promise.all([
      supabase.from('cast_members').select('*').eq('bar_id', BAR_ID).eq('ativo', true).order('nome'),
      supabase.from('staff_horas').select('*').gte('data', monthStart),
      supabase.from('cast_comissoes').select('*').gte('data', monthStart),
      supabase.from('staff_pagamentos').select('*').order('vencimento', { ascending: true }),
    ])
    setStaff(s || [])
    setHoras(h || [])
    setComissoes(c || [])
    setPagamentos(p || [])
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const monthStart = todayTokyo().slice(0, 7) + '-01'
      const [{ data: s }, { data: h }, { data: c }, { data: p }] = await Promise.all([
        supabase.from('cast_members').select('*').eq('bar_id', BAR_ID).eq('ativo', true).order('nome'),
        supabase.from('staff_horas').select('*').gte('data', monthStart),
        supabase.from('cast_comissoes').select('*').gte('data', monthStart),
        supabase.from('staff_pagamentos').select('*').order('vencimento', { ascending: true }),
      ])
      if (cancelled) return
      setStaff(s || [])
      setHoras(h || [])
      setComissoes(c || [])
      setPagamentos(p || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [tick])

  const rows = useMemo(() => staff.map(s => {
    const due = calcularAPagar(s, { horas, comissoes })
    const jaPago = (pagamentos || []).some(p =>
      p.staff_id === s.id && p.status === 'pago' && p.periodo_inicio === due.inicio && p.periodo_fim === due.fim
    )
    return { staff: s, due, jaPago }
  }), [staff, horas, comissoes, pagamentos])

  const filtered = rows.filter(r => {
    if (filtro === 'a_pagar') return !r.jaPago
    if (filtro === 'atrasado') return r.due.atrasado && !r.jaPago
    if (filtro === 'pago') return r.jaPago
    return true
  })

  const totalAPagar = rows.filter(r => !r.jaPago).reduce((s, r) => s + r.due.total, 0)

  async function registrarHoras() {
    if (!horaModal || !horaForm.horas) return
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('staff_horas').insert({
      staff_id: horaModal.id,
      bar_id: BAR_ID,
      data: horaForm.data,
      horas: Number(horaForm.horas),
      observacao: horaForm.observacao || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setHoraModal(null)
    await load()
  }

  async function marcarPago(row) {
    setSaving(true)
    setError('')
    const { error: err } = await supabase.from('staff_pagamentos').insert({
      staff_id: row.staff.id,
      bar_id: BAR_ID,
      periodo_inicio: row.due.inicio,
      periodo_fim: row.due.fim,
      vencimento: row.due.vencimento,
      valor: row.due.total,
      tipo: row.due.forma,
      status: 'pago',
      pago_em: new Date().toISOString(),
    })
    if (!err && row.due.total > 0) {
      await supabase.from('caixa_movimentos').insert({
        bar_id: BAR_ID,
        tipo: 'saida',
        valor: row.due.total,
        descricao: `Pagamento staff ${row.staff.nome} (${row.due.inicio}–${row.due.fim})`,
        referencia_tipo: 'pagamento_staff',
        data: new Date().toISOString(),
      })
    }
    setSaving(false)
    if (err) { setError(err.message); return }
    await load()
  }

  if (loading) return <div style={{ color: 'var(--gold)', padding: 24 }}>Carregando pagamentos...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--white60)' }}>
          A pagar neste ciclo: <span style={{ color: 'var(--gold)' }}>{fmt(totalAPagar)}</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Chip active={filtro === 'a_pagar'} onClick={() => setFiltro('a_pagar')}>A pagar</Chip>
          <Chip active={filtro === 'atrasado'} onClick={() => setFiltro('atrasado')} danger>Atrasado</Chip>
          <Chip active={filtro === 'pago'} onClick={() => setFiltro('pago')}>Pago</Chip>
          <Chip active={filtro === 'todos'} onClick={() => setFiltro('todos')}>Todos</Chip>
        </div>
      </div>
      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>{error}</div>}

      {filtered.length === 0 && <Empty>Ninguém neste filtro.</Empty>}

      <div style={{ background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 90px 90px 90px 100px 110px 1fr', gap: 8, padding: '10px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.08)', fontSize: 11, color: 'var(--white30)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <span>Staff</span><span>Forma</span><span>Horas</span><span>Comissão</span><span>Vencimento</span><span>A pagar</span><span></span>
        </div>
        {filtered.map(row => (
          <div key={row.staff.id} style={{ display: 'grid', gridTemplateColumns: '1.4fr 90px 90px 90px 100px 110px 1fr', gap: 8, padding: '12px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.04)', fontSize: 13, alignItems: 'center' }}>
            <div>
              <div>{row.staff.nome}</div>
              <div style={{ fontSize: 11, color: 'var(--white30)' }}>{row.due.inicio} → {row.due.fim}</div>
            </div>
            <span style={{ fontSize: 11, color: 'var(--white60)' }}>{labelForma(row.due.forma)}</span>
            <span>{row.due.totalHoras ? `${row.due.totalHoras}h` : '—'}</span>
            <span>{row.due.valorComissao ? fmt(row.due.valorComissao) : '—'}</span>
            <span style={{ color: row.due.atrasado && !row.jaPago ? 'var(--danger)' : 'var(--white90)' }}>
              {row.due.vencimento.slice(8, 10)}/{row.due.vencimento.slice(5, 7)}
            </span>
            <span style={{ color: 'var(--gold)', fontWeight: 500 }}>{fmt(row.due.total)}</span>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              {row.due.forma !== 'comissao' && (
                <GoldButton onClick={() => { setHoraForm({ data: todayTokyo(), horas: '', observacao: '' }); setHoraModal(row.staff) }}>+ Horas</GoldButton>
              )}
              {row.jaPago
                ? <span style={{ color: 'var(--success)', fontSize: 12, alignSelf: 'center' }}>Pago</span>
                : <GoldButton onClick={() => marcarPago(row)} disabled={saving}>Marcar pago</GoldButton>}
            </div>
          </div>
        ))}
      </div>

      {horaModal && (
        <Modal title={`Horas · ${horaModal.nome}`} onClose={() => setHoraModal(null)} width={360}>
          <Field label="Data">
            <input type="date" style={inputStyle} value={horaForm.data} onChange={e => setHoraForm(f => ({ ...f, data: e.target.value }))} />
          </Field>
          <Field label="Horas trabalhadas">
            <input type="number" min="0" step="0.5" style={inputStyle} value={horaForm.horas} onChange={e => setHoraForm(f => ({ ...f, horas: e.target.value }))} />
          </Field>
          <Field label="Obs.">
            <input style={inputStyle} value={horaForm.observacao} onChange={e => setHoraForm(f => ({ ...f, observacao: e.target.value }))} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <GhostButton flex={1} onClick={() => setHoraModal(null)}>Cancelar</GhostButton>
            <SolidButton flex={1} onClick={registrarHoras} disabled={saving || !horaForm.horas}>Salvar</SolidButton>
          </div>
        </Modal>
      )}
    </div>
  )
}
