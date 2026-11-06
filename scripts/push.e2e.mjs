/**
 * End-to-end check of the push server without a phone: a fake push service on localhost receives what
 * api/_push.js sends and decrypts it with the "phone" keys (RFC 8291, aes128gcm), like Chrome/Safari do.
 */
import assert from 'node:assert/strict'
import https from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import crypto from 'node:crypto'
import { saveSubscription, sendPushEvent, saveStyle } from '../api/_push.js'

const files = new Map()
const admin = {
  storage: { from: () => ({
    download: async p => files.has(p) ? { data: { text: async () => files.get(p) } } : { data: null, error: { message: 'not found' } },
    upload: async (p, body) => { files.set(p, Buffer.from(body).toString()); return { error: null } },
  }) },
  from: table => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => (table === 'bars' ? { data: { id: 'bar1', nome: 'Atomic Bar', cor: '#d7191f' } } : { data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } }), then: r => r({ data: null, error: { code: '42P01', message: `relation "${table}" does not exist` } }) }
    return q
  },
}

// The "phone": its own key pair and auth secret.
const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys()
const authSecret = crypto.randomBytes(16)
const b64u = b => Buffer.from(b).toString('base64url')

function decrypt(body) {
  const salt = body.subarray(0, 16); const rs = body.readUInt32BE(16); const idlen = body[20]
  const serverPub = body.subarray(21, 21 + idlen); const ct = body.subarray(21 + idlen)
  const shared = ecdh.computeSecret(serverPub)
  const hkdf = (salt, ikm, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len))
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), serverPub]), 32)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce)
  d.setAuthTag(ct.subarray(ct.length - 16))
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])
  assert.ok(rs > 0)
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString())
}

const got = []
let status = 201
// A local HTTPS push service with its own certificate; the sender trusts only that certificate (no TLS switch-off).
const dir = mkdtempSync(join(tmpdir(), 'push-e2e-'))
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'ignore' })
const cert = readFileSync(join(dir, 'c.pem'))
const agent = new https.Agent({ ca: cert })
const server = https.createServer({ key: readFileSync(join(dir, 'k.pem')), cert }, (req, res) => {
  const chunks = []
  req.on('data', c => chunks.push(c))
  req.on('end', () => { got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(status); res.end() })
})
await new Promise(r => server.listen(0, r))
const endpoint = `https://localhost:${server.address().port}/push/abc`
const owner = { user: { id: 'u1' }, perfil: { id: 'u1', role: 'cliente', bar_id: 'bar1', nome: 'Owner' } }
await saveSubscription(admin, owner, { subscription: { endpoint, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(authSecret) } }, prefs: { clock_in: false }, lang: 'en' })

await saveStyle(admin, 'bar1', { tone: 'party', congratsText: 'Parabéns! 🎉' })
const r1 = await sendPushEvent(admin, { barId: 'bar1', type: 'sale', vars: { amount: 12800, tab: 'Mesa 3', method: 'card' }, key: 's1', agent })
assert.equal(r1.sent, 1, JSON.stringify(r1))
const msg = decrypt(got[0].body)
assert.equal(msg.title, 'Atomic Bar')
assert.equal(msg.body, 'Parabéns! 🎉 Sale of ¥12,800 · Mesa 3 · card')
assert.match(msg.icon, /action=icon&bar=bar1/)
assert.equal(msg.url, '/bar/pos')
assert.match(got[0].headers.authorization, /^vapid t=.+, k=.+/)
assert.equal(got[0].headers['content-encoding'], 'aes128gcm')

// Same event again (retry) is not sent twice; a kind turned off is not sent; another bar is not sent.
assert.equal((await sendPushEvent(admin, { barId: 'bar1', type: 'sale', vars: { amount: 1 }, key: 's1' })).skipped, 'duplicate')
assert.equal((await sendPushEvent(admin, { barId: 'bar1', type: 'clock_in', vars: { who: 'Ken' }, agent })).sent, 0)
assert.equal((await sendPushEvent(admin, { barId: 'bar2', type: 'sale', vars: { amount: 1 }, agent })).sent, 0)

// The push service says the phone is gone (410): the subscription is removed.
status = 410
const r2 = await sendPushEvent(admin, { barId: 'bar1', type: 'order', vars: { amount: 500 }, agent })
assert.equal(r2.removed, 1)
assert.equal(JSON.parse(files.get('push/subs.json')).rows.length, 0)
server.close()
console.log('push e2e ok')
