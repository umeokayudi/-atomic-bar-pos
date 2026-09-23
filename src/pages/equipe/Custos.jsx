import { useEffect, useState } from 'react'
import { supabase, BAR_ID } from '../../lib/supabase'
import { CUSTO_CATEGORIAS, fmt, todayTokyo, inputStyle } from '../../lib/format'
import { custoMensalEstimado } from '../../lib/payroll'
import { Field, Modal, GoldButton, GhostButton, SolidButton, Empty, Chip } from '../../components/ui'

const emptyCusto = () => ({
  nome: '',
  categoria: 'Aluguel',
  natureza: 'fixo',
  valor: '',
  frequencia: 'mensal',
  dia_vencimento: 10,
  data: todayTokyo(),
  observacao: '',
  ativo: true,
})

export default function Custos({ locais, onLocaisChange }) {
  const [localId, setLocalId] = useState('')
  const [custos, setCustos] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [localModal, setLocalModal] = useState(false)
  const [form, setForm] = useState(emptyCusto())
  const [novoLocal, setNovoLocal] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [naturezaFiltro, setNaturezaFiltro] = useState('todos')
  const [reload, setReload] = useState(0)

  const selectedLocal = locais.some(l => l.id === localId) ? localId : (locais[0]?.id || '')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!selectedLocal) {
        setCustos([])
        setLoading(false)
        return
      }
      const { data, error: err } = await supabase.from('custos_locais').select('*').eq('local_id', selectedLocal).order('natureza').order('nome')
      if (cancelled) return
      if (err) setError(err.message)
      setCustos(data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [selectedLocal, reload])

  const filtered = custos.filter(c => naturezaFiltro === 'todos' || c.natureza === naturezaFiltro)
  const fixos = custos.filter(c => c.natureza === 'fixo' && c.ativo !== false)
  const variaveis = custos.filter(c => c.natureza === 'variavel')
  const totalFixoMes = fixos.reduce((s, c) => s + custoMensalEstimado(c), 0)
  const totalVarMes = variaveis.filter(c => String(c.data || '').slice(0, 7) === todayTokyo().slice(0, 7)).reduce((s, c) => s + (Number(c.valor) || 0), 0)

  async function saveCusto() {
    if (!form.nome.trim() || !selectedLocal) return
    setSaving(true)
    setError('')
    const payload = {
      local_id: selectedLocal,
      bar_id: BAR_ID,
      nome: form.nome.trim(),
      categoria: form.categoria,
      natureza: form.natureza,
      valor: Number(form.valor) || 0,
      frequencia: form.natureza === 'fixo' ? form.frequencia : 'unico',
      dia_vencimento: form.natureza === 'fixo' ? Number(form.dia_vencimento) || null : null,
      data: form.natureza === 'variavel' ? form.data : null,
      observacao: form.observacao || null,
      ativo: true,
    }
    const { error: err } = await supabase.from('custos_locais').insert(payload)
    setSaving(false)
    if (err) { setError(err.message); return }
    setModal(false)
    setReload(n => n + 1)
  }

  async function toggleCusto(c) {
    await supabase.from('custos_locais').update({ ativo: !c.ativo }).eq('id', c.id)
    setReload(n => n + 1)
  }

  async function saveLocal() {
    if (!novoLocal.trim()) return
    setSaving(true)
    const { data, error: err } = await supabase.from('locais').insert({ nome: novoLocal.trim(), ativo: true }).select().single()
    setSaving(false)
    if (err) { setError(err.message); return }
    setNovoLocal('')
    setLocalModal(false)
    await onLocaisChange?.()
    if (data?.id) setLocalId(data.id)
  }

  const localNome = locais.find(l => l.id === selectedLocal)?.nome || '—'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={{ ...inputStyle, width: 'auto', minWidth: 180 }} value={selectedLocal} onChange={e => setLocalId(e.target.value)}>
            {locais.length === 0 && <option value="">Nenhum local</option>}
            {locais.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
          </select>
          <GoldButton onClick={() => { setError(''); setLocalModal(true) }}>+ Local</GoldButton>
        </div>
        <GoldButton onClick={() => { setForm(emptyCusto()); setError(''); setModal(true) }} disabled={!selectedLocal}>+ Custo</GoldButton>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
        <div className="card">
          <div className="section-title">Fixos / mês · {localNome}</div>
          <div style={{ fontSize: 22, color: 'var(--gold)', fontWeight: 500 }}>{fmt(totalFixoMes)}</div>
          <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 4 }}>{fixos.length} custos recorrentes</div>
        </div>
        <div className="card">
          <div className="section-title">Variáveis neste mês</div>
          <div style={{ fontSize: 22, color: 'var(--gold)', fontWeight: 500 }}>{fmt(totalVarMes)}</div>
          <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 4 }}>Alimenta o relatório do local</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        <Chip active={naturezaFiltro === 'todos'} onClick={() => setNaturezaFiltro('todos')}>Todos</Chip>
        <Chip active={naturezaFiltro === 'fixo'} onClick={() => setNaturezaFiltro('fixo')}>Fixos</Chip>
        <Chip active={naturezaFiltro === 'variavel'} onClick={() => setNaturezaFiltro('variavel')}>Variáveis</Chip>
      </div>

      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>{error}</div>}
      {loading && <div style={{ color: 'var(--gold)' }}>Carregando custos...</div>}
      {!loading && filtered.length === 0 && <Empty>Cadastre aluguel, contas, compras e demais custos deste local.</Empty>}

      {!loading && filtered.length > 0 && (
        <div style={{ background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
          {filtered.map((c, i) => (
            <div key={c.id} style={{
              display: 'grid', gridTemplateColumns: '1.4fr 90px 80px 100px 80px', gap: 8,
              padding: '12px 16px', fontSize: 13, alignItems: 'center',
              borderBottom: i < filtered.length - 1 ? '0.5px solid rgba(255,255,255,0.04)' : 'none',
              opacity: c.ativo === false ? 0.45 : 1
            }}>
              <div>
                <div>{c.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--white30)' }}>{c.categoria}{c.observacao ? ` · ${c.observacao}` : ''}</div>
              </div>
              <span style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 10, width: 'fit-content',
                background: c.natureza === 'fixo' ? 'var(--gold-dim)' : 'var(--success-dim)',
                color: c.natureza === 'fixo' ? 'var(--gold)' : 'var(--success)'
              }}>{c.natureza === 'fixo' ? 'Fixo' : 'Variável'}</span>
              <span style={{ color: 'var(--white60)', fontSize: 12 }}>
                {c.natureza === 'fixo' ? (c.frequencia || 'mensal') : (c.data || '')}
              </span>
              <span style={{ color: 'var(--gold)', fontWeight: 500 }}>{fmt(c.valor)}</span>
              <button onClick={() => toggleCusto(c)} style={{ background: 'none', border: 'none', color: 'var(--white60)', fontSize: 12, textAlign: 'right' }}>
                {c.ativo === false ? 'Reativar' : 'Pausar'}
              </button>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <Modal title="Novo custo" onClose={() => setModal(false)} width={400}>
          <Field label="Nome">
            <input style={inputStyle} value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="ex: Aluguel Shinjuku" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Natureza">
              <select style={inputStyle} value={form.natureza} onChange={e => setForm(f => ({ ...f, natureza: e.target.value }))}>
                <option value="fixo">Fixo</option>
                <option value="variavel">Variável</option>
              </select>
            </Field>
            <Field label="Categoria">
              <select style={inputStyle} value={form.categoria} onChange={e => setForm(f => ({ ...f, categoria: e.target.value }))}>
                {CUSTO_CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Valor (¥)">
            <input type="number" min="0" style={inputStyle} value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} />
          </Field>
          {form.natureza === 'fixo' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <Field label="Frequência">
                <select style={inputStyle} value={form.frequencia} onChange={e => setForm(f => ({ ...f, frequencia: e.target.value }))}>
                  <option value="mensal">Mensal</option>
                  <option value="semanal">Semanal</option>
                  <option value="anual">Anual</option>
                </select>
              </Field>
              <Field label="Dia vencimento">
                <input type="number" min="1" max="28" style={inputStyle} value={form.dia_vencimento} onChange={e => setForm(f => ({ ...f, dia_vencimento: e.target.value }))} />
              </Field>
            </div>
          ) : (
            <Field label="Data">
              <input type="date" style={inputStyle} value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} />
            </Field>
          )}
          <Field label="Obs.">
            <input style={inputStyle} value={form.observacao} onChange={e => setForm(f => ({ ...f, observacao: e.target.value }))} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <GhostButton flex={1} onClick={() => setModal(false)}>Cancelar</GhostButton>
            <SolidButton flex={1} onClick={saveCusto} disabled={saving || !form.nome.trim()}>{saving ? 'Salvando...' : 'Salvar'}</SolidButton>
          </div>
        </Modal>
      )}

      {localModal && (
        <Modal title="Novo local" onClose={() => setLocalModal(false)} width={360}>
          <Field label="Nome do local">
            <input style={inputStyle} value={novoLocal} onChange={e => setNovoLocal(e.target.value)} placeholder="ex: Atomic Shinjuku" />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <GhostButton flex={1} onClick={() => setLocalModal(false)}>Cancelar</GhostButton>
            <SolidButton flex={1} onClick={saveLocal} disabled={saving || !novoLocal.trim()}>Salvar</SolidButton>
          </div>
        </Modal>
      )}
    </div>
  )
}
