import { useEffect, useMemo, useState } from 'react'
import { supabase, BAR_ID } from '../../lib/supabase'
import { fmt, inputStyle } from '../../lib/format'
import { loadHoras, saveHoras, noiteDoInstante, montarPulso, horaLabel } from '../../lib/operacao'
import { GoldButton } from '../../components/ui'

const input = inputStyle

export default function Pulso() {
  const horasIniciais = loadHoras()
  const [abre, setAbre] = useState(horasIniciais.abre)
  const [fecha, setFecha] = useState(horasIniciais.fecha)
  const [noite, setNoite] = useState(() => noiteDoInstante(new Date(), horasIniciais.abre, horasIniciais.fecha))
  const [agora, setAgora] = useState(() => Date.now())
  const [vendas, setVendas] = useState([])
  const [comissoes, setComissoes] = useState([])
  const [turnos, setTurnos] = useState([])
  const [custos, setCustos] = useState([])
  const [sessoes, setSessoes] = useState([])
  const [salas, setSalas] = useState([])
  const [staff, setStaff] = useState([])
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 30000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const desde = new Date(`${noite}T00:00:00+09:00`).toISOString()
      const [v, c, t, cu, se, sa, st] = await Promise.all([
        supabase.from('vendas').select('*').eq('bar_id', BAR_ID).gte('data_venda', desde),
        supabase.from('cast_comissoes').select('*').gte('data', desde),
        supabase.from('staff_turnos').select('*').eq('bar_id', BAR_ID).gte('entrada', desde),
        supabase.from('custos_locais').select('*').eq('ativo', true),
        supabase.from('sessoes_vip').select('*').eq('bar_id', BAR_ID).gte('inicio', desde),
        supabase.from('salas_vip').select('*').eq('bar_id', BAR_ID),
        supabase.from('cast_members').select('*').eq('bar_id', BAR_ID).eq('ativo', true),
      ])
      if (cancelled) return
      const err = [v, c, t, cu, se, sa, st].map(r => r.error).find(Boolean)
      if (err) setErro(err.message)
      setVendas(v.data || [])
      setComissoes(c.data || [])
      setTurnos(t.data || [])
      setCustos(cu.data || [])
      setSessoes(se.data || [])
      setSalas(sa.data || [])
      setStaff(st.data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [noite])

  const pulso = useMemo(() => montarPulso({
    noite, abre, fecha, agora, vendas, comissoes, turnos, custos, sessoes, salas,
  }), [noite, abre, fecha, agora, vendas, comissoes, turnos, custos, sessoes, salas])

  const abertos = turnos.filter(t => !t.saida)
  const nomeStaff = id => staff.find(s => s.id === id)?.nome || '—'

  async function entrar(pessoa) {
    setErro('')
    const { error } = await supabase.from('staff_turnos').insert({
      staff_id: pessoa.id,
      bar_id: BAR_ID,
      entrada: new Date().toISOString(),
      valor_hora: Number(pessoa.valor_hora) || 0,
    })
    if (error) { setErro(error.message); return }
    const { data } = await supabase.from('staff_turnos').select('*').eq('bar_id', BAR_ID).gte('entrada', new Date(`${noite}T00:00:00+09:00`).toISOString())
    setTurnos(data || [])
  }

  async function sair(turno) {
    setErro('')
    const saidaDate = new Date()
    const saida = saidaDate.toISOString()
    const horas = Math.max(0, (saidaDate.getTime() - new Date(turno.entrada).getTime()) / 3600000)
    const { error } = await supabase.from('staff_turnos').update({ saida }).eq('id', turno.id)
    if (error) { setErro(error.message); return }
    await supabase.from('staff_horas').insert({
      staff_id: turno.staff_id,
      bar_id: BAR_ID,
      data: noite,
      horas: Math.round(horas * 100) / 100,
      observacao: 'Turno da operação',
    })
    const { data } = await supabase.from('staff_turnos').select('*').eq('bar_id', BAR_ID).gte('entrada', new Date(`${noite}T00:00:00+09:00`).toISOString())
    setTurnos(data || [])
  }

  function mudarHoras(nextAbre, nextFecha) {
    setAbre(nextAbre)
    setFecha(nextFecha)
    saveHoras(nextAbre, nextFecha)
  }

  const a = pulso.acumulado
  const cards = [
    { label: 'Faturamento', val: fmt(a.faturamento), sub: `Bar ${fmt(a.fatBar)} · VIP ${fmt(a.fatVip)}` },
    { label: 'Custo staff', val: fmt(a.staff + a.comissao), sub: `Hora ${fmt(a.staff)} · comissão ${fmt(a.comissao)}` },
    { label: 'Custo da casa', val: fmt(a.rateio + a.taxa), sub: `Rateio ${fmt(a.rateio)} · taxa cartão ${fmt(a.taxa)}` },
    { label: 'Lucro da noite', val: fmt(a.lucro), sub: a.falta > 0 ? `Falta vender ${fmt(a.falta)}` : 'Acima do equilíbrio' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'end', marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11, color: 'var(--white60)' }}>Noite
          <input type="date" style={{ ...input, display: 'block', marginTop: 4 }} value={noite} onChange={e => setNoite(e.target.value)} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--white60)' }}>Abre
          <input type="time" style={{ ...input, display: 'block', marginTop: 4 }} value={abre} onChange={e => mudarHoras(e.target.value, fecha)} />
        </label>
        <label style={{ fontSize: 11, color: 'var(--white60)' }}>Fecha
          <input type="time" style={{ ...input, display: 'block', marginTop: 4 }} value={fecha} onChange={e => mudarHoras(abre, e.target.value)} />
        </label>
        <div style={{ fontSize: 12, color: 'var(--white60)', paddingBottom: 8 }}>
          Agora {horaLabel(agora)} · faixas de 30 min · casa do dia {fmt(pulso.fixosDia + pulso.varDia)}
        </div>
      </div>

      {erro && <div style={{ color: 'var(--danger)', fontSize: 12, marginBottom: 10 }}>{erro}. Rode o migration.sql no Supabase se as tabelas ainda não existirem.</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
        {cards.map(m => (
          <div key={m.label} className="card">
            <div className="section-title">{m.label}</div>
            <div style={{ fontSize: 22, fontWeight: 500, color: m.label === 'Lucro da noite' && a.lucro < 0 ? 'var(--danger)' : 'var(--gold)' }}>{m.val}</div>
            <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 4 }}>{m.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 0.9fr', gap: 12, alignItems: 'start' }}>
        <div style={{ background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 1fr 1fr 1fr 72px', gap: 8, padding: '10px 12px', fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--white30)' }}>
            <span>Faixa</span><span>Faturamento</span><span>Staff</span><span>Casa</span><span>Lucro</span><span>VIP</span>
          </div>
          {loading && <div style={{ padding: 16, color: 'var(--gold)' }}>Carregando operação...</div>}
          {pulso.linhas.map(l => (
            <div key={l.start} style={{
              display: 'grid', gridTemplateColumns: '92px 1fr 1fr 1fr 1fr 72px', gap: 8,
              padding: '8px 12px', fontSize: 12, alignItems: 'center',
              background: l.emCurso ? 'var(--gold-dim)' : 'transparent',
              opacity: l.futuro ? 0.35 : 1,
              borderTop: '0.5px solid rgba(255,255,255,0.04)',
            }}>
              <span>{l.label}</span>
              <span>
                <div style={{ color: 'var(--gold)' }}>{fmt(l.faturamento)}</div>
                <div style={{ fontSize: 10, color: 'var(--white30)' }}>bar {fmt(l.fatBar)}</div>
              </span>
              <span>{fmt(l.staff + l.comissao)}</span>
              <span>{fmt(l.rateioFixo + l.rateioVar + l.taxa)}</span>
              <span style={{ color: l.lucro < 0 ? 'var(--danger)' : 'var(--success)' }}>
                {l.futuro ? '—' : l.falta > 0 ? `falta ${fmt(l.falta)}` : fmt(l.lucro)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--white60)' }}>
                {salas.length ? `${Math.round(l.ocupacaoTempo * 100)}%` : '—'}
              </span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="section-title">Equipe no turno</div>
          <div style={{ fontSize: 12, color: 'var(--white60)', marginBottom: 10 }}>
            O custo por hora só conta quem entrou. Ao sair, as horas vão para Pagamentos.
          </div>
          {staff.length === 0 && <div style={{ fontSize: 12, color: 'var(--white30)' }}>Cadastre a equipe em Pessoal.</div>}
          {staff.map(p => {
            const turno = abertos.find(t => t.staff_id === p.id)
            return (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', padding: '8px 0', borderTop: '0.5px solid rgba(255,255,255,0.06)', fontSize: 13 }}>
                <div>
                  <div>{p.nome}</div>
                  <div style={{ fontSize: 11, color: 'var(--white30)' }}>
                    {turno ? `desde ${horaLabel(new Date(turno.entrada).getTime())} · ${fmt(p.valor_hora || 0)}/h` : `${fmt(p.valor_hora || 0)}/h`}
                  </div>
                </div>
                {turno
                  ? <GoldButton onClick={() => sair(turno)}>Sair</GoldButton>
                  : <GoldButton onClick={() => entrar(p)}>Entrar</GoldButton>}
              </div>
            )
          })}
          {abertos.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--white30)' }}>
              Em turno: {abertos.map(t => nomeStaff(t.staff_id)).join(', ')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
