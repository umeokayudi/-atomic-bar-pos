import { setCorsHeaders, handleCorsPreflight } from './_cors.js'
import { holdingAdminClient, fetchAllHoldingModules } from './_holdingData.js'
import { requireStaffOrTrustedOrigin } from './_requireStaff.js'
import { drinksAdminClient } from './_supabaseAdmin.js'

export default async function handler(req, res) {
  if (handleCorsPreflight(req, res)) return
  setCorsHeaders(req, res)

  try {
    const auth = await requireStaffOrTrustedOrigin(req, drinksAdminClient())
    if (auth.error) return res.status(auth.status).json({ error: auth.error })

    const sb = await holdingAdminClient()

    if (req.method === 'GET') {
      const data = await fetchAllHoldingModules(sb)
      return res.status(200).json({ ok: true, ...data })
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const { action, form, personMeta } = body

      if (action === 'saveInvestment') {
        const { error } = await sb.from('jbm_financeiro').insert({
          unit: 'Investimentos',
          type: 'despesa',
          category: 'investimento',
          amount: Number(form.amount_invested) || 0,
          date: form.invested_at,
          due_date: form.expected_return_date || null,
          paid: false,
          description: JSON.stringify({
            module: 'investment',
            person_name: form.person_name,
            person_unit: form.unit || 'HR',
            investment_type: form.investment_type || 'formacao',
            expected_return_date: form.expected_return_date,
            expected_return_amount: Number(form.expected_return_amount) || 0,
            status: 'ativo',
            notes: form.notes || '',
          }),
        })
        if (error) throw new Error(error.message)
        return res.status(200).json({ ok: true })
      }

      if (action === 'saveInvestmentReturn') {
        const { error } = await sb.from('jbm_financeiro').insert({
          unit: 'Investimentos',
          type: 'receita',
          category: 'retorno',
          amount: Number(form.amount) || 0,
          date: form.return_date,
          paid: true,
          description: JSON.stringify({
            module: 'investment_return',
            investment_id: form.investment_id,
            source: form.source || 'trabalho',
            person_name: personMeta?.person_name,
            person_unit: personMeta?.unit,
            notes: form.notes || '',
          }),
        })
        if (error) throw new Error(error.message)
        return res.status(200).json({ ok: true })
      }

      return res.status(400).json({ error: 'action inválida' })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
