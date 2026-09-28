import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  jobToPermission,
  canManageEmployees,
  sameBar,
  barPortalAllowed,
  nextEmployeeStatus,
  publicEmployee,
  invitePayload,
} from '../src/lib/employeeAccess.js'

assert.equal(jobToPermission('manager'), 'gerente')
assert.equal(jobToPermission('cashier'), 'caixa')
assert.equal(jobToPermission('bartender'), 'bar_staff')
assert.equal(jobToPermission('hostess'), 'bar_staff')
assert.equal(jobToPermission('staff'), 'bar_staff')
assert.equal(jobToPermission('cleaner'), 'bar_staff')
assert.equal(jobToPermission('admin'), null)
assert.equal(jobToPermission('jbm'), null)

assert.equal(canManageEmployees('gerente'), true)
assert.equal(canManageEmployees('cliente'), true)
assert.equal(canManageEmployees('caixa'), false)
assert.equal(canManageEmployees('bar_staff'), false)
assert.equal(canManageEmployees('funcionario'), false)

assert.equal(sameBar('bar-a', 'bar-a'), true)
assert.equal(sameBar('bar-a', 'bar-b'), false)
assert.equal(sameBar('', 'bar-a'), false)

assert.equal(barPortalAllowed('caixa', 'active'), true)
assert.equal(barPortalAllowed('caixa', null), true)
assert.equal(barPortalAllowed('gerente', 'invited'), false)
assert.equal(barPortalAllowed('bar_staff', 'suspended'), false)
assert.equal(barPortalAllowed('bar_staff', 'inactive'), false)
assert.equal(barPortalAllowed('admin', 'active'), false)
assert.equal(barPortalAllowed('fornecedor', 'active'), false)

assert.equal(nextEmployeeStatus('invited', 'accept'), 'active')
assert.equal(nextEmployeeStatus('active', 'suspend'), 'suspended')
assert.equal(nextEmployeeStatus('suspended', 'reactivate'), 'active')
assert.equal(nextEmployeeStatus('active', 'deactivate'), 'inactive')
assert.equal(nextEmployeeStatus('inactive', 'reactivate'), 'active')
assert.equal(nextEmployeeStatus('suspended', 'accept'), null)

const visible = publicEmployee({ id: '1', nome: 'Aki', password: 'secret', clock_pin_hash: 'hash', pin: '2468' })
assert.equal(visible.nome, 'Aki')
assert.equal('password' in visible, false)
assert.equal('clock_pin_hash' in visible, false)
assert.equal('pin' in visible, false)

assert.equal(invitePayload({ password: 'secret', email: 'a@b.co', nome: 'Aki', job_role: 'cashier' }).error.includes('password'), true)
assert.equal(invitePayload({ email: 'a@b.co', nome: 'Aki', job_role: 'admin' }).error, 'Unknown role')
const invite = invitePayload({ email: 'A@B.co', nome: 'Aki', job_role: 'bartender', phone: '090', employee_id: 'E1', start_date: '2026-09-01', notes: 'floor' })
assert.equal(invite.email, 'a@b.co')
assert.equal(invite.permission, 'bar_staff')
assert.equal(invite.job_role, 'bartender')
assert.equal(invite.employee_code, 'E1')
assert.equal('password' in invite, false)

const route = readFileSync(new URL('../api/_routeBarStaff.js', import.meta.url), 'utf8')
assert.match(route, /action === 'inviteEmployee'/)
assert.match(route, /inviteUserByEmail/)
assert.doesNotMatch(route, /password, nome \}/)
assert.match(route, /Managers cannot set an employee password/)
const inviteReturn = route.slice(route.indexOf('return res.status(200).json({\n        ok: true,\n        id: uid,'), route.indexOf("action === 'updateEmployee'"))
assert.doesNotMatch(inviteReturn, /password/)

const admin = readFileSync(new URL('../api/admin-user.js', import.meta.url), 'utf8')
assert.match(admin, /Administrators cannot set a password/)
assert.match(admin, /inviteUserByEmail/)
assert.doesNotMatch(admin, /authPatch\.password/)

const sql = readFileSync(new URL('../sql/bar_employees.sql', import.meta.url), 'utf8')
assert.match(sql, /p\.bar_id = target_bar/)
assert.match(sql, /p\.role IN \('cliente', 'gerente', 'caixa', 'bar_staff'\)/)
assert.match(sql, /'suspended', 'inactive', 'invited'/)
assert.match(sql, /user_can_manage_bar_staff\(bar_id\)/)
assert.match(sql, /is_procurement_hq\(\)/)
assert.match(sql, /bar_employees_read/)
assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
assert.doesNotMatch(sql, /DROP TABLE public\.perfis/)
assert.doesNotMatch(sql, /password\s+text/i)
assert.match(sql, /password_recovery_requested/)
assert.doesNotMatch(sql, /INSERT INTO public\.perfis/)
assert.match(sql, /employee_invited|employee_suspended|invitation_accepted|password_recovery_requested/)
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.bar_note_password_recovery\(text\) TO anon, authenticated/)
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.bar_set_employee_access\(uuid, text, text\) TO authenticated/)

const access = readFileSync(new URL('../src/lib/access.js', import.meta.url), 'utf8')
assert.match(access, /role === ROLES\.caixa\) return CAIXA_NAV/)
assert.match(access, /role === ROLES\.bar_staff\) return STAFF_NAV/)

console.log('employee access tests passed')
