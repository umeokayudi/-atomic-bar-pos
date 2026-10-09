import { useEffect, useMemo, useState } from 'react'
import { supabase, FALLBACK_BAR_ID } from './supabase'
import { useAuth } from './useAuth'
import { canSwitchBars } from './roles'
import { BarContext } from './useBar'
const STORAGE_KEY = 'atomic_active_bar_id'

export function BarProvider({ children }) {
  const { user, role, loading: authLoading } = useAuth()
  const [bars, setBars] = useState([])
  const [barId, setBarIdState] = useState(FALLBACK_BAR_ID)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (authLoading) return
    let active = true

    async function load() {
      const locked = user?.user_metadata?.bar_id || null
      const { data } = await supabase.from('bars').select('id,nome,cor').order('nome')
      if (!active) return
      const list = data?.length ? data : [{ id: FALLBACK_BAR_ID, nome: 'Atomic Bar', cor: '#C19C56' }]
      setBars(list)

      const saved = localStorage.getItem(STORAGE_KEY)
      const preferred = canSwitchBars(role)
        ? (list.some(b => b.id === saved) ? saved : list[0].id)
        : (locked && list.some(b => b.id === locked) ? locked : (list[0]?.id || FALLBACK_BAR_ID))

      setBarIdState(preferred)
      setLoading(false)
    }

    load().catch(() => {
      if (!active) return
      setBars([{ id: FALLBACK_BAR_ID, nome: 'Atomic Bar', cor: '#C19C56' }])
      setBarIdState(FALLBACK_BAR_ID)
      setLoading(false)
    })

    return () => { active = false }
  }, [authLoading, user, role])

  function setBarId(id) {
    if (!canSwitchBars(role)) return
    setBarIdState(id)
    localStorage.setItem(STORAGE_KEY, id)
  }

  const bar = useMemo(() => bars.find(b => b.id === barId) || bars[0] || null, [bars, barId])

  return (
    <BarContext.Provider value={{ bars, bar, barId: bar?.id || FALLBACK_BAR_ID, setBarId, loading, canSwitch: canSwitchBars(role) }}>
      {children}
    </BarContext.Provider>
  )
}
