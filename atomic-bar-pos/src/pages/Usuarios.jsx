import { useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import { supabase, FALLBACK_BAR_ID } from '../lib/supabase'
import { useAuth } from '../lib/useAuth'
import { useBar } from '../lib/useBar'
import { ROLE_LABEL } from '../lib/roles'

const ROLES_CREATE = [
  { id: 'caixa', label: 'Caixa (só POS)' },
  { id: 'gerente', label: 'Gerente do bar' },
  { id: 'staff', label: 'Equipe do bar' },
  { id: 'bar_staff', label: 'Ponto / staff' },
  { id: 'fornecedor', label: 'Fornecedor' },
  { id: 'admin', label: 'Admin do bar' },
]

function isolatedAuth() {
  return createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

const inputStyle = {
  width: '100%',
  background: 'var(--white05)',
  border: '0.5px solid var(--gold-border)',
  borderRadius: 8,
  color: 'var(--white90)',
  padding: '10px 12px',
  fontSize: 14,
}

export default function Usuarios() {
  const { role } = useAuth()
  const { bars } = useBar()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    nome: '',
    email: '',
    password: '',
    role: 'caixa',
    bar_id: FALLBACK_BAR_ID || '',
  })

  const allowed = role === 'jbm' || role === 'admin'
  const barOptions = useMemo(() => bars.length ? bars : [], [bars])

  useEffect(() => {
    if (!allowed) return undefined
    let cancelled = false
    ;(async () => {
      const { data, error } = await supabase.from('perfis').select('id,nome,email,role,bar_id').order('nome')
      if (cancelled) return
      if (error) setErr(error.message)
      setUsers(data || [])
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [allowed])

  async function createUser(event) {
    event.preventDefault()
    setErr('')
    setMsg('')
    const email = form.email.trim().toLowerCase()
    if (!form.nome.trim() || !email || !form.password) {
      setErr('Preencha nome, e-mail e senha.')
      return
    }
    if (form.password.length < 8) {
      setErr('Senha com no mínimo 8 caracteres.')
      return
    }
    const needsBar = form.role === 'caixa' || form.role === 'gerente' || form.role === 'staff' || form.role === 'bar_staff'
    if (needsBar && !form.bar_id) {
      setErr('Escolha o bar desta conta.')
      return
    }
    setBusy(true)
    try {
      const auth = isolatedAuth()
      const { data, error } = await auth.auth.signUp({
        email,
        password: form.password,
        options: {
          data: {
            nome: form.nome.trim(),
            role: form.role,
            bar_id: needsBar ? form.bar_id : null,
          },
        },
      })
      if (error) throw error
      const uid = data.user?.id
      const fakeNew = data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0
      if (fakeNew) throw new Error('Esse e-mail já existe. Edite o perfil na lista.')
      if (uid) {
        const row = {
          id: uid,
          nome: form.nome.trim(),
          email,
          role: form.role === 'gerente' ? 'cliente' : form.role,
          bar_id: needsBar ? form.bar_id : null,
        }
        const { error: pErr } = await supabase.from('perfis').upsert(row, { onConflict: 'id' })
        if (pErr) throw pErr
      }
      setMsg(`Conta ${email} criada. Depois do login o sistema abre a tela certa.`)
      setForm({ nome: '', email: '', password: '', role: 'caixa', bar_id: form.bar_id })
      const { data: list, error: listErr } = await supabase.from('perfis').select('id,nome,email,role,bar_id').order('nome')
      if (listErr) setErr(listErr.message)
      setUsers(list || [])
    } catch (e) {
      setErr(e.message || 'Não deu para criar a conta.')
    } finally {
      setBusy(false)
    }
  }

  if (!allowed) return <Navigate to="/pos" replace />

  return (
    <div style={{ padding: 24, overflow: 'auto', height: '100%' }}>
      <div className="section-title">Usuários</div>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Um lugar para criar contas</h1>
      <p style={{ color: 'var(--white60)', marginBottom: 20, maxWidth: 560, lineHeight: 1.5 }}>
        Não use várias portas de login. Crie a pessoa aqui. Ela entra com e-mail e senha; o cargo abre caixa, gerente, ponto ou JBM.
      </p>

      <form onSubmit={createUser} className="card" style={{ maxWidth: 560, marginBottom: 24 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <input style={inputStyle} placeholder="Nome" value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} />
          <input style={inputStyle} type="email" placeholder="E-mail" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <input style={inputStyle} type="password" placeholder="Senha (mín. 8)" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
          <select style={inputStyle} value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
            {ROLES_CREATE.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <select style={inputStyle} value={form.bar_id} onChange={e => setForm({ ...form, bar_id: e.target.value })}>
            <option value="">Bar</option>
            {barOptions.map(b => <option key={b.id} value={b.id}>{b.nome}</option>)}
          </select>
          <button type="submit" className="btn btn-gold" disabled={busy}>{busy ? 'Criando...' : 'Adicionar usuário'}</button>
        </div>
      </form>

      {err && <div className="card" style={{ color: 'var(--danger)', marginBottom: 16, maxWidth: 560 }}>{err}</div>}
      {msg && <div className="card" style={{ color: 'var(--success)', marginBottom: 16, maxWidth: 560 }}>{msg}</div>}

      {loading ? (
        <div style={{ color: 'var(--gold)' }}>Carregando...</div>
      ) : (
        <div className="card" style={{ maxWidth: 720, padding: 0, overflow: 'hidden' }}>
          {users.length === 0 && <div style={{ padding: 16, color: 'var(--white60)' }}>Nenhuma conta na tabela perfis ainda.</div>}
          {users.map(u => (
            <div key={u.id} style={{
              display: 'flex', justifyContent: 'space-between', gap: 12,
              padding: '12px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.06)',
            }}>
              <div>
                <div style={{ fontWeight: 600 }}>{u.nome || u.email || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--white30)' }}>{u.email}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--gold)', textAlign: 'right' }}>
                {ROLE_LABEL[u.role] || u.role}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
