import assert from 'node:assert/strict'
import { normalizeNfcUid } from '../src/lib/nfcCard.js'
import { nfcUidHash } from '../api/_nfcCard.js'

assert.equal(normalizeNfcUid('04:a2:3b:91:c2:5e:80'), '04A23B91C25E80')
assert.equal(normalizeNfcUid(' 04-A2-3B-91\n'), '04A23B91')
assert.equal(normalizeNfcUid('0123456789'), '0123456789')
assert.equal(normalizeNfcUid(''), '')
assert.equal(normalizeNfcUid('ab'), '')
assert.equal(nfcUidHash('04:a2:3b:91'), nfcUidHash('04A23B91'))
assert.notEqual(nfcUidHash('04A23B91'), nfcUidHash('04A23B92'))
assert.equal(nfcUidHash(''), '')
console.log('nfcCard ok')
