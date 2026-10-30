import { t } from './i18n'
import { notify } from '../components/ui/ConfirmDialog'

/**
 * Runs a Supabase delete/update and tells the person what happened: an error, nothing changed
 * (RLS or the row is gone), or done. Returns true only when at least one row changed.
 *   await runChange(supabase.from('produtos').update({ ativo: false }).eq('id', id))
 */
export async function runChange(query, { okText } = {}) {
  let res
  try {
    res = await query.select('id')
  } catch (e) {
    notify(t('confirm.deleteFailed', { message: e?.message || String(e) }), 'error')
    return false
  }
  if (res?.error) {
    notify(t('confirm.deleteFailed', { message: res.error.message }), 'error')
    return false
  }
  if (!res?.data?.length) {
    notify(t('confirm.deleteBlocked'), 'error')
    return false
  }
  notify(okText || t('confirm.deleted'), 'ok')
  return true
}
