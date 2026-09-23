import { useEffect, useMemo, useState } from 'react'
import { supabase, BAR_ID } from '../../lib/supabase'
import { fmt, inputStyle } from '../../lib/format'
import { horaLabel, loadHoras, noiteDoInstante, ocupacaoNoite, valorSessao } from '../../lib/operacao'
import { Field, Modal, GoldButton, GhostButton, SolidButton, Empty } from '../../components/ui'

const emptySala = () => ({ nome: '', capacidade: 6, preco_hora: 8000, taxa_pessoa: 0, minimo_minutos: 60 })

function pct(n) {
  const p = (Number(n) || 0) * 100
  if (p > 0 && p < 1) return '<1%'
  return `${Math.round(p)}%`
}

function tempoLabel(min) {
  if (min > 0 && min < 1) return `${Math.max(1, Math.round(min * 60))} s`
  return `${Math.round(min)} min`
}

export default function SalasVip() {
  const horas = loadHoras()
  const [noite] = useState(() => noiteDoInstante(new Date(), horas.abre, horas.fecha))
  const [agora, setAgora] = useState(() => Date.now())
  const [salas, setSalas] = useState([])
  const [sessoes, setSessoes] = useState([])
  const [modal, setModal] = useState(false)
  const [abrir, setAbrir] = useState(null)
  const [form, setForm] = useState(emptySala())
  const [pessoas, setPessoas] = useState(2)
  const [pagamento, setPagamento] = useState('dinheiro')
  const [erro, setErro] = useState('')
  const [saving, setSaving] = useState(false)

  async function load() {
    const desde = new Date(`${noite}T00:00:00+09:00`).toISOString()
    const [sa, se] = await Promise.all([
      supabase.from('salas_vip').select('*').eq('bar_id', BAR_ID).order('nome'),
      supabase.from('sessoes_vip').select('*').eq('bar_id', BAR_ID).gte('inicio', desde),
    ])
    const err = sa.error || se.error
    if (err) setErro(err.message)
    setSalas(sa.data || [])
    setSessoes(se.data || [])
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const desde = new Date(`${noite}T00:00:00+09:00`).toISOString()
      const [sa, se] = await Promise.all([
        supabase.from('salas_vip').select('*').eq('bar_id', BAR_ID).order('nome'),
        supabase.from('sessoes_vip').select('*').eq('bar_id', BAR_ID).gte('inicio', desde),
      ])
      if (cancelled) return
      const err = sa.error || se.error
      if (err) setErro(err.message)
      setSalas(sa.data || [])
      setSessoes(se.data || [])
    })()
    const id = setInterval(() => setAgora(Date.now()), 15000)
    return () => { cancelled = true; clearInterval(id) }
  }, [noite])

  const relogio = Math.max(agora, ...sessoes.map(s => new Date(s.fim || s.inicio || 0).getTime()), 0)
  const occ = useMemo(
    () => ocupacaoNoite(salas, sessoes, noite, horas.abre, horas.fecha, relogio),
    [salas, sessoes, noite, horas.abre, horas.fecha, relogio],
  )
  const abertas = sessoes.filter(s => s.status === 'aberta')
  const encerradas = sessoes.filter(s => s.status === 'encerrada')
  const salaDe = id => salas.find(s => s.id === id)

  async function criarSala() {
    if (!form.nome.trim()) return
    setSaving(true)
    setErro('')
    const { error } = await supabase.from('salas_vip').insert({
      bar_id: BAR_ID,
      nome: form.nome.trim(),
      capacidade: Number(form.capacidade) || 1,
      preco_hora: Number(form.preco_hora) || 0,
      taxa_pessoa: Number(form.taxa_pessoa) || 0,
      minimo_minutos: Number(form.minimo_minutos) || 0,
      ativo: true,
    })
    setSaving(false)
    if (error) { setErro(error.message); return }
    setModal(false)
    setForm(emptySala())
    await load()
  }

  async function iniciar() {
    if (!abrir) return
    setSaving(true)
    setErro('')
    const { error } = await supabase.from('sessoes_vip').insert({
      sala_id: abrir.id,
      bar_id: BAR_ID,
      inicio: new Date().toISOString(),
      pessoas: Math.min(Number(pessoas) || 1, Number(abrir.capacidade) || 99),
      status: 'aberta',
      forma_pagamento: pagamento,
    })
    setSaving(false)
    if (error) { setErro(error.message); return }
    setAbrir(null)
    await load()
  }

  async function encerrar(sess) {
    const sala = salaDe(sess.sala_id) || {}
    const fimDate = new Date()
    const fim = Math.max(fimDate.getTime(), new Date(sess.inicio).getTime() + 1000)
    const valor = valorSessao(sala, sess.pessoas, new Date(sess.inicio).getTime(), fim)
    setErro('')
    const { error } = await supabase.from('sessoes_vip').update({
      fim: new Date(fim).toISOString(),
      valor,
      status: 'encerrada',
    }).eq('id', sess.id)
    if (error) { setErro(error.message); return }
    await supabase.from('caixa_movimentos').insert({
      bar_id: BAR_ID,
      tipo: 'entrada',
      valor,
      descricao: `Sala VIP ${sala.nome || ''} · ${sess.pessoas} pessoas`,
      referencia_tipo: 'sala_vip',
      referencia_id: sess.id,
      data: new Date(fim).toISOString(),
    })
    await load()
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
        <div className="card">
          <div className="section-title">Dinheiro VIP na noite</div>
          <div style={{ fontSize: 22, color: 'var(--gold)', fontWeight: 500 }}>{fmt(encerradas.reduce((s, x) => s + (Number(x.valor) || 0), 0))}</div>
          <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 4 }}>{encerradas.length} sessões fechadas · entram no caixa</div>
        </div>
        <div className="card">
          <div className="section-title">Tempo das salas</div>
          <div style={{ fontSize: 22, color: 'var(--gold)', fontWeight: 500 }}>{pct(occ.tempo)}</div>
          <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 4 }}>{occ.salas} salas · {tempoLabel(occ.ocupadoMin)} ocupados de {tempoLabel(occ.salas * occ.abertoMin)} possíveis</div>
        </div>
        <div className="card">
          <div className="section-title">Lugares usados</div>
          <div style={{ fontSize: 22, color: 'var(--gold)', fontWeight: 500 }}>{pct(occ.lugares)}</div>
          <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 4 }}>capacidade {occ.capacidade} pessoas · enquanto a casa está aberta</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--white60)' }}>{abertas.length} sala(s) em uso agora</div>
        <GoldButton onClick={() => { setErro(''); setModal(true) }}>+ Sala</GoldButton>
      </div>
      {erro && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>{erro}. Rode o migration.sql se as tabelas de VIP ainda não existirem.</div>}

      {salas.length === 0 && <Empty>Cadastre as salas de karaokê. Cada uma tem capacidade, preço por hora e tempo mínimo.</Empty>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {salas.filter(s => s.ativo !== false).map(sala => {
          const sess = abertas.find(s => s.sala_id === sala.id)
          const estimado = sess ? valorSessao(sala, sess.pessoas, new Date(sess.inicio).getTime(), agora) : 0
          const minutos = sess ? Math.round((agora - new Date(sess.inicio).getTime()) / 60000) : 0
          return (
            <div key={sala.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 500 }}>{sala.nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 2 }}>
                    {sala.capacidade} lugares · {fmt(sala.preco_hora)}/h
                    {Number(sala.taxa_pessoa) > 0 ? ` + ${fmt(sala.taxa_pessoa)}/pessoa` : ''} · mín. {sala.minimo_minutos} min
                  </div>
                </div>
                <span style={{ fontSize: 11, color: sess ? 'var(--success)' : 'var(--white30)' }}>{sess ? 'Em uso' : 'Livre'}</span>
              </div>
              {sess ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 13 }}>{sess.pessoas} / {sala.capacidade} pessoas · {minutos} min</div>
                  <div style={{ fontSize: 18, color: 'var(--gold)', margin: '6px 0 10px' }}>{fmt(estimado)}</div>
                  <div style={{ fontSize: 11, color: 'var(--white30)', marginBottom: 8 }}>desde {horaLabel(new Date(sess.inicio).getTime())} · {sess.forma_pagamento === 'cartao' ? 'cartão' : 'dinheiro'}</div>
                  <GoldButton onClick={() => encerrar(sess)}>Encerrar e lançar no caixa</GoldButton>
                </div>
              ) : (
                <div style={{ marginTop: 12 }}>
                  <GoldButton onClick={() => { setAbrir(sala); setPessoas(2); setPagamento('dinheiro') }}>Abrir sessão</GoldButton>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {encerradas.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="section-title">Cobranças da noite</div>
          <div style={{ background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10 }}>
            {encerradas.map(s => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '0.5px solid rgba(255,255,255,0.04)', fontSize: 13 }}>
                <span>{salaDe(s.sala_id)?.nome || 'Sala'} · {s.pessoas} pessoas · {horaLabel(new Date(s.inicio).getTime())}–{s.fim ? horaLabel(new Date(s.fim).getTime()) : ''}</span>
                <span style={{ color: 'var(--gold)' }}>{fmt(s.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {modal && (
        <Modal title="Nova sala VIP" onClose={() => setModal(false)} width={400}>
          <Field label="Nome"><input style={inputStyle} value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Sala 1 · Karaoke" /></Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="Capacidade"><input type="number" min="1" style={inputStyle} value={form.capacidade} onChange={e => setForm(f => ({ ...f, capacidade: e.target.value }))} /></Field>
            <Field label="Mínimo (min)"><input type="number" min="0" style={inputStyle} value={form.minimo_minutos} onChange={e => setForm(f => ({ ...f, minimo_minutos: e.target.value }))} /></Field>
          </div>
          <Field label="Preço da sala / hora (¥)"><input type="number" min="0" style={inputStyle} value={form.preco_hora} onChange={e => setForm(f => ({ ...f, preco_hora: e.target.value }))} /></Field>
          <Field label="Taxa extra por pessoa / hora (¥)"><input type="number" min="0" style={inputStyle} value={form.taxa_pessoa} onChange={e => setForm(f => ({ ...f, taxa_pessoa: e.target.value }))} /></Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <GhostButton flex={1} onClick={() => setModal(false)}>Cancelar</GhostButton>
            <SolidButton flex={1} onClick={criarSala} disabled={saving || !form.nome.trim()}>Salvar</SolidButton>
          </div>
        </Modal>
      )}

      {abrir && (
        <Modal title={`Abrir ${abrir.nome}`} onClose={() => setAbrir(null)} width={360}>
          <Field label={`Pessoas (máx. ${abrir.capacidade})`}>
            <input type="number" min="1" max={abrir.capacidade} style={inputStyle} value={pessoas} onChange={e => setPessoas(e.target.value)} />
          </Field>
          <Field label="Pagamento na saída">
            <select style={inputStyle} value={pagamento} onChange={e => setPagamento(e.target.value)}>
              <option value="dinheiro">Dinheiro</option>
              <option value="cartao">Cartão</option>
            </select>
          </Field>
          <div style={{ fontSize: 12, color: 'var(--white60)', marginBottom: 12 }}>
            A cobrança entra no caixa quando a sessão fecha. Mínimo {abrir.minimo_minutos} min · {fmt(abrir.preco_hora)}/h.
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <GhostButton flex={1} onClick={() => setAbrir(null)}>Cancelar</GhostButton>
            <SolidButton flex={1} onClick={iniciar} disabled={saving}>Abrir</SolidButton>
          </div>
        </Modal>
      )}
    </div>
  )
}
