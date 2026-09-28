import { requireGlobalFinance } from './_requireStaff.js'
import { drinksAdminClient } from './_supabaseAdmin.js'

function needsBar(role) {
  return ['cliente', 'gerente', 'caixa', 'bar_staff'].includes(role)
}

const BAR_JOB = {
  gerente: 'manager',
  cliente: 'manager',
  caixa: 'cashier',
  bar_staff: 'staff',
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
    const auth = await requireGlobalFinance(req, admin)
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
      if (!email || !nome || !role) {
        return res.status(400).json({ error: 'Missing fields: email, name, role' })
      }
      if (needsBar(role) && !bar_id) {
        return res.status(400).json({ error: 'Bar clients/staff must be linked to a bar' })
      }
      if (needsBar(role) && password) {
        return res.status(400).json({ error: 'Do not set a password for a bar employee. Send an invitation.' })
      }
      if (!needsBar(role) && !password) {
        return res.status(400).json({ error: 'Missing fields: email, password, name, role' })
      }

      const emailNorm = email.trim().toLowerCase()
      const created = needsBar(role)
        ? await admin.auth.admin.inviteUserByEmail(emailNorm, { data: { nome } })
        : await admin.auth.admin.createUser({
          email: emailNorm,
          password,
          email_confirm: true,
          user_metadata: { nome },
        })
      const cErr = created.error
      if (cErr) return res.status(400).json({ error: cErr.message })

      const uid = created.data.user.id
      const perfilPayload = {
        id: uid,
        nome,
        email: emailNorm,
        role,
        bar_id: needsBar(role) ? bar_id : null,
      }

      const { error: pErr } = await admin.from('perfis').upsert(perfilPayload, { onConflict: 'id' })
      if (pErr) {
        await admin.auth.admin.deleteUser(uid).catch(() => {})
        return res.status(400).json({ error: 'Profile save failed: ' + pErr.message })
      }

      if (needsBar(role)) {
        const employee = await admin.from('bar_employees').insert({
          id: uid,
          bar_id,
          job_role: BAR_JOB[role] || 'staff',
          permission_role: role === 'cliente' ? 'gerente' : role,
          status: 'invited',
          invited_at: new Date().toISOString(),
        })
        if (employee.error) {
          await admin.from('perfis').delete().eq('id', uid)
          await admin.auth.admin.deleteUser(uid).catch(() => {})
          return res.status(400).json({ error: employee.error.message })
        }
        await admin.from('audit_logs').insert({
          user_id: auth.user?.id || null,
          action: 'employee_invited',
          entity_type: 'bar_employees',
          entity_id: uid,
          metadata: { bar_id, role },
        })
      }

      return res.status(200).json({ success: true, id: uid, invited: needsBar(role) })
    }

    if (req.method === 'PATCH') {
      const { id, email, password, nome, role, bar_id, access } = req.body || {}
      if (!id) return res.status(400).json({ error: 'Missing user id' })
      if (password) return res.status(400).json({ error: 'Administrators cannot set a password. The person uses Forgot password.' })

      if (access === 'suspended' || access === 'active') {
        const ban = access === 'suspended' ? '876000h' : 'none'
        const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: ban })
        if (banErr) return res.status(400).json({ error: banErr.message })
        await admin.from('bar_employees').update({
          status: access === 'suspended' ? 'suspended' : 'active',
          updated_at: new Date().toISOString(),
        }).eq('id', id)
        await admin.from('audit_logs').insert({
          user_id: auth.user?.id || null,
          action: access === 'suspended' ? 'employee_suspended' : 'employee_reactivated',
          entity_type: 'bar_employees',
          entity_id: id,
          metadata: { access },
        })
        return res.status(200).json({ success: true })
      }

      const authPatch = {}
      if (email) authPatch.email = email.trim().toLowerCase()
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
