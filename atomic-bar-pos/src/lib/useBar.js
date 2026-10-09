import { createContext, useContext } from 'react'

export const BarContext = createContext(null)

export function useBar() {
  const ctx = useContext(BarContext)
  if (!ctx) throw new Error('useBar deve ficar dentro de BarProvider')
  return ctx
}
