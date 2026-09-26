export const ALLOWED_ORIGINS = [
  'https://jbm-master.vercel.app',
  'https://bebidas-control.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:4173',
]

export function setCorsHeaders(req, res, methods = 'GET, POST, OPTIONS') {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*')
  } else {
    res.setHeader('Access-Control-Allow-Origin', 'https://jbm-master.vercel.app')
  }
  res.setHeader('Access-Control-Allow-Methods', methods)
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Max-Age', '86400')
}

export function handleCorsPreflight(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res)
    return res.status(200).end()
  }
  return false
}
