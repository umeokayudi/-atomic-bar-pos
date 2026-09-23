import { requireStaff } from './_requireStaff.js'
import { drinksAdminClient } from './_supabaseAdmin.js'

function needsBar(role) {
  return ['cliente', 'caixa', 'bar_staff'].includes(role)
}

function authEmail(user) {
  return user?.email || ''
}

export default async function handler(req, res) {
  let admin
  try {
    admin = drinksAdminClient()
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const auth = await requireStaff(req, admin)
    if (auth.error) return res.status(auth.status).json({ error: auth.error })

    if (req.method === 'GET') {
      const [{ data: perfis, error: pErr }, { data: authData, error: aErr }] = await Promise.all([
        admin.from('perfis').select('*').order('nome'),
        admin.auth.admin.listUsers({ perPage: 1000 }),
      ])
      if (pErr) return res.status(400).json({ error: pErr.message })
      if (aErr) return res.status(400).json({ error: aErr.message })

      const emailById = Object.fromEntries(
        (authData?.users || []).map(u => [u.id, authEmail(u)])
      )
      const users = (perfis || []).map(p => ({
        ...p,
        email: p.email || emailById[p.id] || '',
      }))
      return res.status(200).json({ users })
    }

    if (req.method === 'POST') {
      const { email, password, nome, role, bar_id } = req.body || {}
      if (!email || !password || !nome || !role) {
        return res.status(400).json({ error: 'Missing fields: email, password, name, role' })
      }
      if (needsBar(role) && !bar_id) {
        return res.status(400).json({ error: 'Bar clients/staff must be linked to a bar' })
      }

      const { data: created, error: cErr } = await admin.auth.admin.createUser({
        email: email.trim().toLowerCase(),
        password,
        email_confirm: true,
        user_metadata: { nome },
      })
      if (cErr) return res.status(400).json({ error: cErr.message })

      const uid = created.user.id
      const perfilPayload = {
        id: uid,
        nome,
        email: email.trim().toLowerCase(),
        role,
        bar_id: needsBar(role) ? bar_id : null,
      }

      const { error: pErr } = await admin.from('perfis').upsert(perfilPayload, { onConflict: 'id' })
      if (pErr) {
        await admin.auth.admin.deleteUser(uid).catch(() => {})
        return res.status(400).json({ error: 'Profile save failed: ' + pErr.message })
      }

      return res.status(200).json({ success: true, id: uid })
    }

    if (req.method === 'PATCH') {
      const { id, email, password, nome, role, bar_id } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Missing user id' })

      const authPatch = {}
      if (email) authPatch.email = email.trim().toLowerCase()
      if (password) authPatch.password = password
      if (Object.keys(authPatch).length > 0) {
        const { error: aErr } = await admin.auth.admin.updateUserById(id, authPatch)
        if (aErr) return res.status(400).json({ error: 'Auth update failed: ' + aErr.message })
      }

      const perfilPatch = {}
      if (nome != null) perfilPatch.nome = nome
      if (role != null) perfilPatch.role = role
      if (email) perfilPatch.email = email.trim().toLowerCase()
      if (needsBar(role)) {
        if (!bar_id) return res.status(400).json({ error: 'Bar clients/staff must be linked to a bar' })
        perfilPatch.bar_id = bar_id
      } else if (role != null) {
        perfilPatch.bar_id = null
      } else if (bar_id !== undefined) {
        perfilPatch.bar_id = bar_id || null
      }

      if (Object.keys(perfilPatch).length > 0) {
        const { error: pErr } = await admin.from('perfis').update(perfilPatch).eq('id', id)
        if (pErr) return res.status(400).json({ error: 'Profile update failed: ' + pErr.message })
      }

      return res.status(200).json({ success: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
