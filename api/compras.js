import { requireStaff } from './_requireStaff.js'
import { drinksAdminClient } from './_supabaseAdmin.js'

/** Compras via service role — contorna RLS quando scripts importam sem criado_por */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const admin = drinksAdminClient()
    const auth = await requireStaff(req, admin)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })

    const month = req.query?.month || ''

    const { data, error } = await admin
      .from('compras')
      .select('*, compras_itens(*)')
      .order('data', { ascending: true })

    if (error) return res.status(400).json({ error: error.message })

    let compras = data || []
    if (month) {
      compras = compras.filter(c => {
        const keys = [c.data, c.data_compra].map(d => String(d || '').slice(0, 7))
        return keys.includes(month)
      })
    }

    return res.status(200).json({ compras })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
