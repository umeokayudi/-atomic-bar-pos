import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { staffFetch } from '../lib/apiAuth'
import { loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { shiftsDue } from '../lib/autoClose'
import { addDays } from '../lib/barClose'
import { summarizeNight, closeVariance } from '../lib/nightClose'
import { tokyoDateKey, tokyoParts } from '../lib/tokyo'
import { useAuth } from './Auth'

export default function AutoClose({ bar }) {
  const { user } = useAuth()
  const running = useRef(false)

  useEffect(() => {
    if (!bar?.id || running.current) return undefined
    let cancelled = false
    async function run() {
      if (running.current) return
      running.current = true
      try {
        const team = peekBarTeam() || await loadBarTeam()
        const goals = team?.goals || {}
        const due = shiftsDue(goals)
        if (!due.length || cancelled) return
        const from = addDays(tokyoDateKey(), -3)
        const [salesR, shiftsR] = await Promise.all([
          supabase.from('pos_vendas').select('id,total,data,criado_em,metodo_pagamento,obs').eq('bar_id', bar.id).gte('data', from),
          supabase.from('pos_shifts').select('id,night_key,status').eq('bar_id', bar.id).gte('night_key', from),
        ])
        const sales = salesR.data || []
        const existing = new Set((shiftsR.data || []).filter(s => s.status === 'closed').map(s => s.night_key))
        const patch = {}
        for (const item of due) {
          if (existing.has(item.key)) {
            patch[item.kind === 'dia' ? 'fechou_dia' : 'fechou_noite'] = item.kind === 'dia' ? item.day : item.key
            continue
          }
          const nightKey = item.kind === 'dia' ? item.day : item.key
          const daySales = item.kind === 'dia'
            ? sales.filter(s => {
              const stamp = s.criado_em || s.data
              if (!stamp) return false
              const p = tokyoParts(stamp)
              const key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
              return key === item.day && p.hour < (goals.hora_dia == null ? 18 : +goals.hora_dia)
            })
            : sales
          const sum = item.kind === 'dia'
            ? summarizeNight(daySales.map(s => ({ ...s, criado_em: null, data: item.day })), item.day)
            : summarizeNight(sales, nightKey)
          const row = {
            bar_id: bar.id,
            night_key: item.key,
            status: 'closed',
            closed_at: new Date().toISOString(),
            closed_by: user?.id || null,
            ticket_count: sum.ticketCount,
            drinks_total: sum.drinksTotal,
            cash_total: sum.cashTotal,
            card_total: sum.cardTotal,
            other_total: (sum.otherTotal || 0) + (sum.paypayTotal || 0),
            expected_cash: sum.expectedCash,
            counted_cash: sum.expectedCash,
            variance: closeVariance(sum.expectedCash, sum.expectedCash),
          }
          const ins = await supabase.from('pos_shifts').insert(row)
          if (!ins.error) {
            patch[item.kind === 'dia' ? 'fechou_dia' : 'fechou_noite'] = item.kind === 'dia' ? item.day : item.key
          }
        }
        if (Object.keys(patch).length) {
          await staffFetch('/api/bar-staff', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'saveCloseSettings', ...patch }),
          })
        }
      } finally {
        running.current = false
      }
    }
    run()
    const timer = setInterval(run, 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [bar?.id, user?.id])

  return null
}
