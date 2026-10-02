import assert from 'node:assert/strict'
import {
  answerAssistantTurn,
  composerAction,
  containsBusinessClaim,
  conversationTitle,
  describeProvider,
  emptyChatStore,
  loadChatStore,
  presentModelAnswer,
  saveChatStore,
} from '../src/lib/aiAssistant.js'
import handler from '../api/ai-assistant.js'

function memoryStorage() {
  const data = new Map()
  return {
    getItem: key => data.get(key) || null,
    setItem: (key, value) => data.set(key, String(value)),
  }
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value },
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    end() { return this },
  }
}

assert.equal(composerAction({ key: 'Enter', shiftKey: false }), 'send')
assert.equal(composerAction({ key: 'Enter', shiftKey: true }), 'newline')
assert.equal(composerAction({ key: 'Enter', isComposing: true }), 'idle')
assert.equal(composerAction({ key: 'a' }), 'idle')

const env = { GEMINI_API_KEY: '' }
assert.equal(describeProvider(env).configured, false)
assert.equal(describeProvider(env).provider, null)
assert.equal(describeProvider({ GEMINI_API_KEY: 'present-but-not-printed' }).configured, true)
assert.equal(JSON.stringify(describeProvider({ GEMINI_API_KEY: 'secret-value' })).includes('secret-value'), false)

let calls = 0
const blocked = await answerAssistantTurn({
  demo: true,
  messages: [{ role: 'user', content: 'Prepare a purchase order for the products running low.' }],
}, {
  configured: true,
  generate: async () => { calls += 1; return '{"answer":"Created PO-2048 for ¥184,000"}' },
})
assert.equal(calls, 0)
assert.equal(blocked.body.state, 'demo')
assert.equal(blocked.body.fromModel, false)
assert.equal(blocked.body.connected, false)
assert.equal(blocked.body.kpis.length, 0)
assert.equal(blocked.body.draft.supported, false)
assert.equal(blocked.body.draft.executed, false)
assert.equal(blocked.body.draft.status, 'not_created')
assert.equal(/¥|184,000|PO-2048/.test(blocked.body.text), false)

const unconfigured = await answerAssistantTurn({
  messages: [{ role: 'user', content: 'What was gross profit today?' }],
}, { configured: false, generate: async () => { throw new Error('must not run') } })
assert.equal(unconfigured.body.state, 'unconfigured')
assert.match(unconfigured.body.text, /GEMINI_API_KEY is not set/)
assert.equal(unconfigured.body.chart, null)
assert.equal(unconfigured.body.table, null)

const withheld = presentModelAnswer('{"answer":"Sales were ¥120,000","kpis":[{"label":"Sales","value":"¥120,000"}]}')
assert.equal(withheld.fromModel, false)
assert.equal(withheld.kpis.length, 0)
assert.match(withheld.text, /No operational database is connected/)
assert.equal(containsBusinessClaim('I created the purchase order'), true)

const safe = presentModelAnswer('{"answer":"I cannot see a connected sales book from here.","detail":"The four operating books stay separate, and none was attached.","followups":["Which book should be connected?"]}')
assert.equal(safe.fromModel, true)
assert.equal(safe.connected, undefined)
assert.equal(safe.kpis.length, 0)
assert.deepEqual(safe.followups, ['Which book should be connected?'])

const failed = await answerAssistantTurn({
  messages: [{ role: 'user', content: 'Explain the cash book.' }],
}, {
  configured: true,
  generate: async () => { throw new Error('GEMINI failed key=super-secret') },
})
assert.equal(failed.body.state, 'error')
assert.equal(failed.body.fromModel, false)
assert.equal(/super-secret/.test(failed.body.detail), false)

const storage = memoryStorage()
const initial = emptyChatStore(10)
saveChatStore(storage, initial)
const loaded = loadChatStore(storage, 10)
assert.equal(loaded.conversations.length, 1)
assert.equal(conversationTitle([{ role: 'user', content: 'How did recorded sales look for this bar tonight and last week?' }]).endsWith('…'), true)

delete process.env.GEMINI_API_KEY
const res = fakeRes()
await handler({
  method: 'POST',
  headers: {},
  body: { demo: false, messages: [{ role: 'user', content: 'Show me a sales chart.' }] },
}, res)
assert.equal(res.statusCode, 200)
assert.equal(res.body.state, 'unconfigured')
assert.equal(res.body.configured, false)
assert.equal(res.body.chart, null)
assert.equal(/ojirgkqtqvugqktyuhem|fxsakrshmldmkdmbevna/.test(JSON.stringify(res.body)), false)

const status = fakeRes()
await handler({ method: 'GET', headers: {} }, status)
assert.equal(status.body.configured, false)
assert.equal(status.body.connected, false)
assert.equal(status.body.drafts, false)

console.log('ai assistant tests passed')
