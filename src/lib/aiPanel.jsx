import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'

/**
 * One AI layer for every admin page.
 * - Pages publish what they show with useAiPageContext({ module, title, period, unit, filters, kpis }).
 * - The header's "Ask AI" opens a single side panel that reads that context; the page underneath stays mounted.
 * - Conversations are kept per user: in Supabase (ai_conversations) when that table exists, else on this device.
 */

const AiPanelContext = createContext(null)
const LOCAL_KEY = 'jbm_ai_threads_v1'
const MAX_LOCAL = 40

/** Keep only what helps the model and is safe to send: no ids of people, no free-form personal fields. */
export function compactContext(ctx = {}) {
  const out = {}
  if (ctx.module) out.module = String(ctx.module)
  if (ctx.title) out.page = String(ctx.title).slice(0, 80)
  if (ctx.unit) out.unit = String(ctx.unit).slice(0, 80)
  if (ctx.period) out.period = String(ctx.period).slice(0, 60)
  if (ctx.filters && typeof ctx.filters === 'object') {
    out.filters = Object.fromEntries(Object.entries(ctx.filters)
      .filter(([, v]) => v !== '' && v != null && typeof v !== 'object')
      .slice(0, 12)
      .map(([k, v]) => [k, String(v).slice(0, 60)]))
  }
  if (Array.isArray(ctx.kpis)) {
    out.visible = ctx.kpis.slice(0, 16).map(k => ({ label: String(k.label).slice(0, 60), value: String(k.value).slice(0, 40) }))
  }
  return out
}

export function contextToScreen(ctx = {}) {
  const c = compactContext(ctx)
  const lines = [`Page: ${c.page || c.module || 'admin'}`]
  if (c.unit) lines.push(`Unit: ${c.unit}`)
  if (c.period) lines.push(`Period on screen: ${c.period}`)
  if (c.filters && Object.keys(c.filters).length) lines.push(`Filters: ${Object.entries(c.filters).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  if (c.visible?.length) lines.push(`Numbers on screen: ${c.visible.map(k => `${k.label}: ${k.value}`).join('; ')}`)
  return lines.join('\n')
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || [] } catch { return [] }
}
function writeLocal(list) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, MAX_LOCAL))) } catch { /* private mode */ }
}
function isMissing(error) {
  return !!error && (error.code === 'PGRST205' || error.code === '42P01' || /does not exist|could not find the table/i.test(error.message || ''))
}

/** Conversation history: server table when available, else localStorage. */
export const aiHistory = {
  mode: 'unknown',
  async list() {
    if (this.mode !== 'local') {
      const { data, error } = await supabase.from('ai_conversations').select('id,module,titulo,atualizado_em').order('atualizado_em', { ascending: false }).limit(50)
      if (!error) { this.mode = 'server'; return data.map(r => ({ id: r.id, module: r.module, title: r.titulo, updated: r.atualizado_em })) }
      if (!isMissing(error)) throw error
      this.mode = 'local'
    }
    return readLocal().map(({ id, module, title, updated }) => ({ id, module, title, updated }))
  },
  async get(id) {
    if (this.mode === 'server') {
      const { data, error } = await supabase.from('ai_conversations').select('*').eq('id', id).single()
      if (error) throw error
      return { id: data.id, module: data.module, title: data.titulo, messages: data.mensagens || [] }
    }
    return readLocal().find(t => t.id === id) || null
  },
  async save(thread) {
    const title = thread.title || thread.messages.find(m => m.role === 'user')?.content?.slice(0, 80) || 'Conversation'
    const messages = thread.messages.map(m => ({ role: m.role, content: m.content, sources: m.sources || undefined }))
    if (this.mode !== 'local') {
      const row = { module: thread.module, titulo: title, mensagens: messages, atualizado_em: new Date().toISOString(), bar_id: thread.barId || null }
      const q = thread.serverId
        ? supabase.from('ai_conversations').update(row).eq('id', thread.serverId).select('id').single()
        : supabase.from('ai_conversations').insert(row).select('id').single()
      const { data, error } = await q
      if (!error) { this.mode = 'server'; return data.id }
      if (!isMissing(error)) throw error
      this.mode = 'local'
    }
    const id = thread.serverId || thread.id
    const list = readLocal().filter(t => t.id !== id)
    list.unshift({ id, module: thread.module, title, messages, updated: new Date().toISOString() })
    writeLocal(list)
    return id
  },
  async remove(id) {
    if (this.mode === 'server') {
      const { error } = await supabase.from('ai_conversations').delete().eq('id', id)
      if (error) throw error
      return
    }
    writeLocal(readLocal().filter(t => t.id !== id))
  },
}

export function AiPanelProvider({ children, enabled = true }) {
  const [open, setOpen] = useState(false)
  // base: set by the shell for the current screen. pages: richer context published by the screen itself.
  const [base, setCtx] = useState({ module: 'overview' })
  const [pages, setPages] = useState({})
  const [seed, setSeed] = useState('')
  const ctx = useMemo(() => ({ ...base, ...(pages[base.screen || base.module] || {}) }), [base, pages])
  const setPageCtx = useCallback((screen, value) => setPages(prev => ({ ...prev, [screen]: value })), [])

  const openAi = useCallback((prompt = '') => {
    setSeed(prompt)
    setOpen(true)
  }, [])
  const closeAi = useCallback(() => setOpen(false), [])

  // Ctrl/Cmd + J toggles the panel on admin screens.
  useEffect(() => {
    if (!enabled) return undefined
    const onKey = e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])

  const value = useMemo(() => ({ enabled, open, ctx, seed, setSeed, openAi, closeAi, setCtx, setPageCtx }), [enabled, open, ctx, seed, openAi, closeAi, setPageCtx])
  return <AiPanelContext.Provider value={value}>{children}</AiPanelContext.Provider>
}

export function useAiPanel() {
  return useContext(AiPanelContext) || { enabled: false, open: false, ctx: {}, openAi: () => {}, closeAi: () => {}, setCtx: () => {}, setPageCtx: () => {}, seed: '', setSeed: () => {} }
}

/**
 * Publish what a screen shows (period, unit, filters, visible numbers) under its screen id.
 * The panel merges it over the shell's base context while that screen is current.
 */
export function useAiPageContext(screen, ctx) {
  const panel = useContext(AiPanelContext)
  const key = JSON.stringify(compactContext(ctx || {})) + (ctx?.barId || '') + (ctx?.days || '')
  useEffect(() => {
    if (!panel || !screen) return
    panel.setPageCtx(screen, ctx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, key])
}

/** Render-nothing helper for screens that prefer JSX over calling the hook. */
export function AiContextPublisher({ screen, ctx }) {
  useAiPageContext(screen, ctx)
  return null
}

/** Turn an existing screen snapshot ({ label: value }) into the panel's "numbers on screen". */
export function snapshotToKpis(snap = {}) {
  return Object.entries(snap)
    .filter(([, v]) => v !== '' && v != null && typeof v !== 'object')
    .slice(0, 16)
    .map(([label, value]) => ({ label, value: String(value).replace(/\n/g, '; ').slice(0, 300) }))
}
