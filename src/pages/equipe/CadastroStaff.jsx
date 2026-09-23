import { useEffect, useState } from 'react'
import { supabase, BAR_ID } from '../../lib/supabase'
import { FUNCOES, FORMAS_PAGAMENTO, CICLOS, DIAS_SEMANA, fmt, labelFuncao, labelForma, labelCiclo, inputStyle } from '../../lib/format'
import { Field, Modal, GoldButton, GhostButton, SolidButton, Empty } from '../../components/ui'

const emptyForm = () => ({
  nome: '',
  tipo: 'staff',
  contrato: 'inhouse',
  turno: '21:00–03:00',
  ativo: true,
  local_id: '',
  forma_pagamento: 'hora',
  valor_hora: '',
  percentual_comissao: '',
  ciclo_pagamento: 'mensal',
  dia_pagamento: 25,
  pix: '',
})

export default function CadastroStaff({ locais, onChanged }) {
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    const { data, error: err } = await supabase.from('cast_members').select('*').eq('bar_id', BAR_ID).order('nome')
    if (err) setError(err.message)
    setStaff(data || [])
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data, error: err } = await supabase.from('cast_members').select('*').eq('bar_id', BAR_ID).order('nome')
      if (cancelled) return
      if (err) setError(err.message)
      setStaff(data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [])

  function openNew() {
    setEditing(null)
    setForm({ ...emptyForm(), local_id: locais[0]?.id || BAR_ID || '' })
    setError('')
    setModal(true)
  }

  function openEdit(s) {
    setEditing(s)
    setForm({
      nome: s.nome || '',
      tipo: s.tipo || 'staff',
      contrato: s.contrato || 'inhouse',
      turno: s.turno || '',
      ativo: s.ativo !== false,
      local_id: s.local_id || s.bar_id || '',
      forma_pagamento: s.forma_pagamento || (s.contrato === 'freelancer' ? 'comissao' : 'hora'),
      valor_hora: s.valor_hora ?? '',
      percentual_comissao: s.percentual_comissao ?? '',
      ciclo_pagamento: s.ciclo_pagamento || 'mensal',
      dia_pagamento: s.dia_pagamento ?? 25,
      pix: s.pix || '',
    })
    setError('')
    setModal(true)
  }

  async function save() {
    if (!form.nome.trim()) return
    setSaving(true)
    setError('')
    const payload = {
      nome: form.nome.trim(),
      tipo: form.tipo,
      contrato: form.contrato,
      turno: form.turno,
      ativo: form.ativo,
      bar_id: BAR_ID,
      local_id: form.local_id || null,
      forma_pagamento: form.forma_pagamento,
      valor_hora: form.forma_pagamento === 'comissao' ? null : (form.valor_hora === '' ? null : Number(form.valor_hora)),
      percentual_comissao: form.forma_pagamento === 'hora' ? null : (form.percentual_comissao === '' ? null : Number(form.percentual_comissao)),
      ciclo_pagamento: form.ciclo_pagamento,
      dia_pagamento: form.dia_pagamento === '' ? null : Number(form.dia_pagamento),
      pix: form.pix || null,
    }
    const q = editing
      ? supabase.from('cast_members').update(payload).eq('id', editing.id)
      : supabase.from('cast_members').insert(payload)
    const { error: err } = await q
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    setModal(false)
    await load()
    onChanged?.()
  }

  async function toggleAtivo(s) {
    await supabase.from('cast_members').update({ ativo: !s.ativo }).eq('id', s.id)
    await load()
    onChanged?.()
  }

  const localNome = id => locais.find(l => l.id === id)?.nome || '—'

  if (loading) return <div style={{ color: 'var(--gold)', padding: 24 }}>Carregando equipe...</div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--white60)' }}>{staff.length} pessoas cadastradas</div>
        <GoldButton onClick={openNew}>+ Cadastrar staff</GoldButton>
      </div>

      {staff.length === 0 && <Empty>Nenhum staff cadastrado. Adicione a equipe (bar, cast, cozinha, gestão).</Empty>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {staff.map(s => (
          <div key={s.id} style={{
            background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)',
            borderRadius: 10, padding: 16, opacity: s.ativo ? 1 : 0.5
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'var(--gold-dim)', border: '1px solid var(--gold-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 500, color: 'var(--gold)', flexShrink: 0
              }}>{(s.nome || '?')[0]}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{s.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 2 }}>
                  {labelFuncao(s.tipo)} · {labelForma(s.forma_pagamento || (s.contrato === 'freelancer' ? 'comissao' : 'hora'))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              <Row k="Local" v={localNome(s.local_id || s.bar_id)} />
              {(s.forma_pagamento || 'hora') !== 'comissao' && (
                <Row k="Valor/hora" v={s.valor_hora != null ? fmt(s.valor_hora) : '—'} />
              )}
              {(s.forma_pagamento || '') !== 'hora' && (
                <Row k="% comissão" v={s.percentual_comissao != null ? `${s.percentual_comissao}%` : (s.contrato === 'freelancer' ? '50%' : '30% premium')} />
              )}
              <Row k="Pagamento" v={`${labelCiclo(s.ciclo_pagamento)}${s.ciclo_pagamento === 'semanal' ? ' · ' + (DIAS_SEMANA.find(d => d.value === Number(s.dia_pagamento))?.label || '') : s.ciclo_pagamento === 'mensal' && s.dia_pagamento ? ` · dia ${s.dia_pagamento}` : ''}`} />
              {s.turno && <Row k="Turno" v={s.turno} />}
              {s.pix && <Row k="PIX" v={s.pix} />}
              <Row k="Status" v={s.ativo ? 'Ativo' : 'Inativo'} color={s.ativo ? 'var(--success)' : 'var(--danger)'} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <GhostButton onClick={() => openEdit(s)}>Editar</GhostButton>
              <GhostButton onClick={() => toggleAtivo(s)}>{s.ativo ? 'Desativar' : 'Ativar'}</GhostButton>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <Modal title={editing ? 'Editar staff' : 'Novo staff'} onClose={() => setModal(false)} width={440}>
          <Field label="Nome">
            <input style={inputStyle} value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Função">
              <select style={inputStyle} value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                {FUNCOES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Local">
              <select style={inputStyle} value={form.local_id} onChange={e => setForm(f => ({ ...f, local_id: e.target.value }))}>
                <option value="">—</option>
                {locais.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Forma de ganho">
            <select style={inputStyle} value={form.forma_pagamento} onChange={e => setForm(f => ({ ...f, forma_pagamento: e.target.value }))}>
              {FORMAS_PAGAMENTO.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {form.forma_pagamento !== 'comissao' && (
            <Field label="Valor por hora (¥)">
              <input type="number" min="0" style={inputStyle} value={form.valor_hora} onChange={e => setForm(f => ({ ...f, valor_hora: e.target.value }))} />
            </Field>
          )}
          {form.forma_pagamento !== 'hora' && (
            <Field label="% comissão">
              <input type="number" min="0" max="100" step="0.5" style={inputStyle} value={form.percentual_comissao} onChange={e => setForm(f => ({ ...f, percentual_comissao: e.target.value }))} placeholder="ex: 30" />
            </Field>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Quando pagar">
              <select style={inputStyle} value={form.ciclo_pagamento} onChange={e => setForm(f => ({ ...f, ciclo_pagamento: e.target.value }))}>
                {CICLOS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label={form.ciclo_pagamento === 'semanal' ? 'Dia da semana' : 'Dia do mês'}>
              {form.ciclo_pagamento === 'semanal' ? (
                <select style={inputStyle} value={form.dia_pagamento} onChange={e => setForm(f => ({ ...f, dia_pagamento: Number(e.target.value) }))}>
                  {DIAS_SEMANA.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : form.ciclo_pagamento === 'mensal' ? (
                <input type="number" min="1" max="28" style={inputStyle} value={form.dia_pagamento} onChange={e => setForm(f => ({ ...f, dia_pagamento: e.target.value }))} />
              ) : (
                <input style={inputStyle} disabled value="Automático" />
              )}
            </Field>
          </div>
          <Field label="Contrato (cast / drink-back)">
            <select style={inputStyle} value={form.contrato} onChange={e => setForm(f => ({ ...f, contrato: e.target.value }))}>
              <option value="inhouse">In-house</option>
              <option value="freelancer">Freelancer</option>
            </select>
          </Field>
          <Field label="Turno">
            <input style={inputStyle} value={form.turno} onChange={e => setForm(f => ({ ...f, turno: e.target.value }))} />
          </Field>
          <Field label="PIX / dados de pagamento">
            <input style={inputStyle} value={form.pix} onChange={e => setForm(f => ({ ...f, pix: e.target.value }))} />
          </Field>
          {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <GhostButton flex={1} onClick={() => setModal(false)}>Cancelar</GhostButton>
            <SolidButton flex={1} onClick={save} disabled={saving || !form.nome.trim()}>{saving ? 'Salvando...' : 'Salvar'}</SolidButton>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Row({ k, v, color }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: 'var(--white60)' }}>{k}</span>
      <span style={{ color: color || 'var(--white90)', textAlign: 'right' }}>{v}</span>
    </div>
  )
}
