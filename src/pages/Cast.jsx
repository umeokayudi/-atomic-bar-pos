import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useBar } from '../lib/useBar'

const fmt = n => '¥' + Math.round(n).toLocaleString('ja-JP')

export default function Cast() {
  const { barId } = useBar()
  const [cast, setCast] = useState([])
  const [comissoes, setComissoes] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ nome: '', tipo: 'hostess', contrato: 'inhouse', turno: '21:00–03:00', ativo: true })
  const [saving, setSaving] = useState(false)

  const today = new Date().toISOString().split('T')[0]
  const monthStart = today.slice(0, 7) + '-01'

  useEffect(() => {
    if (!barId) return
    async function load() {
      const [{ data: castData }, { data: comData }] = await Promise.all([
        supabase.from('cast_members').select('id,nome,tipo,contrato,turno,ativo').eq('bar_id', barId).order('nome'),
        supabase.from('cast_comissoes')
          .select('id,cast_id,valor,data,cast_members(nome)')
          .gte('data', monthStart)
      ])
      setCast(castData || [])
      setComissoes((comData || []).filter(c => castData?.some(m => m.id === c.cast_id)))
      setLoading(false)
    }
    load()
  }, [barId])

  // Aggregated commission per cast this month
  const commBycast = cast.reduce((acc, c) => {
    acc[c.id] = comissoes.filter(x => x.cast_id === c.id).reduce((s, x) => s + (x.valor || 0), 0)
    return acc
  }, {})

  const totalCommission = Object.values(commBycast).reduce((s, v) => s + v, 0)

  async function saveCast() {
    setSaving(true)
    const payload = { ...form, bar_id: barId }
    const { error } = await supabase.from('cast_members').insert(payload)
    if (!error) {
      const { data } = await supabase.from('cast_members').select('id,nome,tipo,contrato,turno,ativo').eq('bar_id', barId).order('nome')
      setCast(data || [])
      setModal(false)
      setForm({ nome: '', tipo: 'hostess', contrato: 'inhouse', turno: '21:00–03:00', ativo: true })
    }
    setSaving(false)
  }

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--gold)' }}>Carregando...</div>

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>Cast</h2>
          <div style={{ fontSize: 12, color: 'var(--white60)' }}>
            Comissões do mês: <span style={{ color: 'var(--gold)' }}>{fmt(totalCommission)}</span>
          </div>
        </div>
        <button onClick={() => setModal(true)} style={{
          padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 500,
          background: 'var(--gold-dim)', border: '0.5px solid var(--gold-border)', color: 'var(--gold)', cursor: 'pointer'
        }}>+ Adicionar Cast</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
        {cast.map(c => (
          <div key={c.id} style={{
            background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)',
            borderRadius: 10, padding: 16, opacity: c.ativo ? 1 : 0.5
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'var(--gold-dim)', border: '1px solid var(--gold-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 500, color: 'var(--gold)', flexShrink: 0
              }}>{c.nome[0]}</div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{c.nome}</div>
                <div style={{ fontSize: 11, color: 'var(--white30)', marginTop: 2 }}>
                  {c.tipo} · {c.contrato === 'freelancer' ? 'Freelancer 50%' : 'In-house 30%'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--white60)' }}>Turno</span>
                <span>{c.turno}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--white60)' }}>Comissão mês</span>
                <span style={{ color: 'var(--gold)', fontWeight: 500 }}>{fmt(commBycast[c.id] || 0)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                <span style={{ color: 'var(--white60)' }}>Status</span>
                <span style={{ color: c.ativo ? 'var(--success)' : 'var(--danger)' }}>{c.ativo ? 'Ativo' : 'Inativo'}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Monthly commission table */}
      {comissoes.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--white30)', marginBottom: 10 }}>Comissões Recentes</div>
          <div style={{ background: 'var(--white05)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 10, overflow: 'hidden' }}>
            {comissoes.slice(0, 20).map((c, i) => (
              <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: i < comissoes.length - 1 ? '0.5px solid rgba(255,255,255,0.05)' : 'none', fontSize: 13 }}>
                <span>{c.cast_members?.nome || '—'}</span>
                <span style={{ color: 'var(--white60)', fontSize: 11 }}>{new Date(c.data).toLocaleDateString('pt-BR')}</span>
                <span style={{ color: 'var(--gold)', fontWeight: 500 }}>{fmt(c.valor)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,10,28,0.9)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--navy2)', border: '0.5px solid var(--gold-border)', borderRadius: 12, padding: 24, width: 360 }}>
            <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--gold)', marginBottom: 16 }}>Novo Cast</div>
            {[
              { label: 'Nome', field: 'nome', type: 'text' },
              { label: 'Turno', field: 'turno', type: 'text' },
            ].map(({ label, field, type }) => (
              <div key={field} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: 'var(--white60)', marginBottom: 4 }}>{label}</div>
                <input type={type} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  style={{ width: '100%', background: 'var(--white05)', border: '0.5px solid var(--gold-border)', borderRadius: 6, color: 'var(--white90)', padding: '7px 10px', fontSize: 13 }} />
              </div>
            ))}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--white60)', marginBottom: 4 }}>Tipo</div>
              <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}
                style={{ width: '100%', background: 'var(--white05)', border: '0.5px solid var(--gold-border)', borderRadius: 6, color: 'var(--white90)', padding: '7px 10px', fontSize: 13 }}>
                <option value="hostess">Hostess</option>
                <option value="barman">Barman</option>
                <option value="staff">Staff</option>
              </select>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: 'var(--white60)', marginBottom: 4 }}>Contrato</div>
              <select value={form.contrato} onChange={e => setForm(f => ({ ...f, contrato: e.target.value }))}
                style={{ width: '100%', background: 'var(--white05)', border: '0.5px solid var(--gold-border)', borderRadius: 6, color: 'var(--white90)', padding: '7px 10px', fontSize: 13 }}>
                <option value="inhouse">In-house (30% acima de ¥2.000)</option>
                <option value="freelancer">Freelancer (50% de tudo)</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setModal(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '0.5px solid var(--gold-border)', background: 'none', color: 'var(--white90)', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={saveCast} disabled={saving || !form.nome} style={{ flex: 1, padding: 10, borderRadius: 8, background: 'var(--gold)', color: 'var(--navy)', border: 'none', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
