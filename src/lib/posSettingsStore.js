import { DEFAULT_POS_SETTINGS } from './nightTicket'

/** Merge a patch into the bar's pos_settings row (creates it with the till defaults when missing). */
export async function savePosSettings(supabase, barId, patch) {
  const cur = await supabase.from('pos_settings').select('*').eq('bar_id', barId).maybeSingle()
  if (cur.error) throw new Error(cur.error.message)
  const res = cur.data
    ? await supabase.from('pos_settings').update(patch).eq('bar_id', barId)
    : await supabase.from('pos_settings').insert({
      bar_id: barId,
      room_min: DEFAULT_POS_SETTINGS.room_min,
      set_minutes: DEFAULT_POS_SETTINGS.set_minutes,
      set_price: DEFAULT_POS_SETTINGS.set_price,
      service_pct: DEFAULT_POS_SETTINGS.service_pct,
      ...patch,
    })
  if (res.error) throw new Error(res.error.message)
  const check = await supabase.from('pos_settings').select('*').eq('bar_id', barId).maybeSingle()
  if (check.error) throw new Error(check.error.message)
  return check.data
}
