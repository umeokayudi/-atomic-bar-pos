/** Shared auth for Vercel cron routes (CRON_SECRET or x-vercel-cron). */
export function authorizeCron(req, res) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.authorization || ''
  const isVercelCron = req.headers['x-vercel-cron'] === '1'
  if (secret && auth !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  if (!secret && !isVercelCron && process.env.VERCEL === '1') {
    res.status(401).json({ error: 'Unauthorized' })
    return false
  }
  return true
}
