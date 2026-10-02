import { isLocalDemo } from '../lib/supabase'

export default function DemoModeBanner() {
  if (!isLocalDemo) return null
  return (
    <div className="demo-mode-banner" role="status">
      DEMO — fictional Atomic Bar books in this browser only. Not connected to a database. Not live sales, cash, stock, payroll, or supplier orders.
    </div>
  )
}
