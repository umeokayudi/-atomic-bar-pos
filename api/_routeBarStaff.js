/** Dono do bar gerencia equipe, PIN, GPS e tablet. Não toca no fornecimento JBM. */

import { drinksAdminClient } from './_supabaseAdmin.js'
import { requireBarAccount } from './_requireStaff.js'
import { hashSecret, randomTabletCode } from './_hash.js'
import { loadBarWithGeo, listStaffWithExtras, saveBarGeo, saveStaffExtras } from './_barLiveStore.js'

function bodyOf(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end()

  let admin
  try { admin = drinksAdminClient() } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  const auth = await requireBarAccount(req, admin, { roles: ['cliente', 'gerente'] })
  if (auth.error) return res.status(auth.status).json({ error: auth.error })
  const barId = auth.perfil.bar_id

  try {
    if (req.method === 'GET') {
      const [staff, bar] = await Promise.all([
        listStaffWithExtras(admin, barId),
        loadBarWithGeo(admin, barId),
      ])
      return res.status(200).json({
        staff: staff || [],
        bar: {
          id: bar?.id,
          nome: bar?.nome,
          lat: bar?.lat,
          lng: bar?.lng,
          geofence_m: bar?.geofence_m || 150,
          tabletPaired: Boolean(bar?.tablet_token_hash),
        },
      })
    }

    const body = bodyOf(req)

    if (req.method === 'POST' && body.action === 'pairTablet') {
      const code = randomTabletCode()
      const saved = await saveBarGeo(admin, barId, { tablet_token_hash: hashSecret(code) })
      if (!saved.ok) return res.status(400).json({ error: saved.error })
      return res.status(200).json({ ok: true, tabletToken: code })
    }

    if (req.method === 'POST' && body.action === 'saveLocation') {
      const saved = await saveBarGeo(admin, barId, {
        lat: +body.lat,
        lng: +body.lng,
        geofence_m: Math.max(50, Math.min(500, +body.geofence_m || 150)),
      })
      if (!saved.ok) return res.status(400).json({ error: saved.error })
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'POST' && body.action === 'createStaff') {
      const { email, password, nome, role, cargo, salario_hora, pin } = body
      if (!email || !password || !nome) return res.status(400).json({ error: 'email, password, name required' })
      const staffRole = role === 'caixa' ? 'caixa' : 'bar_staff'
      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: String(email).trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: { nome },
      })
      if (cErr) return res.status(400).json({ error: cErr.message })
      const uid = created.user.id
      const { error: pErr } = await admin.from('perfis').upsert({
        id: uid,
        nome,
        email: String(email).trim().toLowerCase(),
        role: staffRole,
        bar_id: barId,
      }, { onConflict: 'id' })
      if (pErr) {
        await admin.auth.admin.deleteUser(uid).catch(() => {})
        return res.status(400).json({ error: pErr.message })
      }
      const extraPatch = {}
      if (cargo || staffRole) extraPatch.cargo = cargo || staffRole
      if (salario_hora != null) extraPatch.salario_hora = +salario_hora || 0
      if (pin) extraPatch.clock_pin_hash = hashSecret(String(pin))
      extraPatch.ativo = true
      const extras = await saveStaffExtras(admin, uid, extraPatch)
      if (!extras.ok && extras.error) {
        return res.status(400).json({ error: extras.error })
      }
      return res.status(200).json({ ok: true, id: uid })
    }

    if (req.method === 'PATCH') {
      const { id } = body
      if (!id) return res.status(400).json({ error: 'id required' })
      const { data: existing } = await admin.from('perfis').select('id,bar_id,role').eq('id', id).single()
      if (!existing || existing.bar_id !== barId) return res.status(404).json({ error: 'Staff not found' })
      if (existing.role === 'cliente' && existing.id !== auth.user.id) {
        return res.status(403).json({ error: 'Cannot edit another owner' })
      }
      const patch = {}
      const extraPatch = {}
      if (body.nome != null) patch.nome = body.nome
      if (body.cargo != null) extraPatch.cargo = body.cargo
      if (body.salario_hora != null) extraPatch.salario_hora = +body.salario_hora
      if (body.ativo != null) extraPatch.ativo = !!body.ativo
      if (body.pin) extraPatch.clock_pin_hash = hashSecret(String(body.pin))
      if (body.role === 'caixa' || body.role === 'bar_staff') patch.role = body.role
      if (Object.keys(patch).length) {
        const { error } = await admin.from('perfis').update(patch).eq('id', id)
        if (error) return res.status(400).json({ error: error.message })
      }
      if (Object.keys(extraPatch).length) {
        const extras = await saveStaffExtras(admin, id, extraPatch)
        if (!extras.ok) return res.status(400).json({ error: extras.error })
      }
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
