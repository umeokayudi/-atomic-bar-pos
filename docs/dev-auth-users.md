# Development Auth users

POS, employee, and manager logins use Supabase Auth. A row in `perfis` is not a session.

The browser signs in with `signInWithPassword`. The session is stored by the Supabase client under `sb-<project>-auth-token` in `localStorage`, and the client refreshes the access token. Logout calls `signOut`.

Suspended and inactive bar accounts are signed out. Reactivating them clears the Auth ban from the staff API. Invited people set their own password from the Supabase email. Managers never type that password.

## Provision disposable users

Do not run this against the live Drinks project. The script refuses any `*.supabase.co` host.

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_SERVICE_ROLE_KEY=...   # server only, never VITE_

export TEST_BAR_ID=<bar uuid>
export TEST_POS_EMAIL=pos-test@atomicbar.local
export TEST_POS_PASSWORD=...
export TEST_EMPLOYEE_EMAIL=employee-test@atomicbar.local
export TEST_EMPLOYEE_PASSWORD=...
export TEST_MANAGER_EMAIL=manager-test@atomicbar.local
export TEST_MANAGER_PASSWORD=...

node scripts/provisionDevAuth.mjs
```

The script does not print passwords. Each account gets `auth.users`, a `perfis` row with the role and `bar_id`, and a `bar_employees` row when that table exists.

## Role landing

| Role | Lands on |
| --- | --- |
| caixa | POS |
| bar_staff | Time clock |
| gerente, cliente | Bar dashboard |
| admin, jbm, staff, funcionario | HQ |
| fornecedor | Supplier portal |

A cashier or bar employee is not an HQ role. Bar id on API staff routes comes from the signed-in profile, not from the request body.

Password reset is the login screen “Forgot password?” action, which calls `resetPasswordForEmail`. Signed-in managers and cashiers can change their password from the account control, which checks the current password with Auth first.
