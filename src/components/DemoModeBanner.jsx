import { isLocalDemo } from '../lib/supabase'

export default function DemoModeBanner() {
  if (!isLocalDemo) return null
  return (
    <div className="demo-mode-banner" role="status">
      DEMO / LOCAL MODE — this browser is not connected to a database. Sales, cash, stock, and payroll figures are empty, not live results.
    </div>
  )
}
