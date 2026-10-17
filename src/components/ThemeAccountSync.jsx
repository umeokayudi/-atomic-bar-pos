import { useEffect, useRef } from 'react'
import { drinksAuth } from '../lib/supabase'
import { normalizeThemePref, useUiPrefs } from '../lib/uiPrefs'
import { useAuth } from './Auth'

/**
 * Keeps the theme choice on the Supabase account (user_metadata.theme), so it follows the person
 * across devices. No table or migration needed. Lane (PIN) logins have no account: device only.
 */
export default function ThemeAccountSync() {
  const { user } = useAuth()
  const { themePref, setThemePref } = useUiPrefs()
  const pulled = useRef(null)

  // On sign-in, adopt the account's choice once.
  useEffect(() => {
    if (!user?.id || pulled.current === user.id) return
    pulled.current = user.id
    const saved = user.user_metadata?.theme
    if (saved) setThemePref(normalizeThemePref(saved))
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // When the person changes it, save it (best effort).
  useEffect(() => {
    if (!user?.id || pulled.current !== user.id) return
    if (user.user_metadata?.theme === themePref) return
    const timer = setTimeout(() => {
      drinksAuth.auth.updateUser({ data: { theme: themePref } }).catch(() => {})
    }, 600)
    return () => clearTimeout(timer)
  }, [themePref, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
