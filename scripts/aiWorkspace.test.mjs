import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planTurn, confirmAiProposal } from '../src/lib/aiWorkspace.js'
import { shellTabIds } from '../src/lib/legacyScope.js'
import { canManageBarTeam } from '../src/lib/access.js'

const read = (path) => readFileSync(path, 'utf8')
const workspace = read('src/components/AiWorkspace.jsx')
const planner = read('src/lib/aiWorkspace.js')

assert.equal(workspace.includes('/api/chat'), false)
assert.equal(workspace.includes('callGeminiChat'), false)
assert.equal(planner.includes('/api/chat'), false)
assert.equal(planner.includes('callGeminiChat'), false)

const cold = planTurn('Como estão as vendas?', { connected: false, modelConfigured: false })
assert.equal(cold.proposal, null)
assert.equal(/¥|\d{2,}/.test(cold.reply), false)
assert.match(cold.reply, /não inventei/i)
assert.match(cold.reply, /modelo externo/i)

const stockQuestion = planTurn('O que falta no estoque?', { connected: false })
assert.equal(stockQuestion.proposal, null)

const close = planTurn('Fecha o caixa de hoje', { demo: true, connected: false })
assert.equal(close.proposal.kind, 'ledger')
assert.equal(close.proposal.executed, false)
assert.match(close.proposal.question, /Confirme/i)

const cancelled = confirmAiProposal(close.proposal, { confirmed: false })
assert.equal(cancelled.executed, false)
assert.equal(cancelled.write, undefined)
assert.match(cancelled.message, /Nada foi alterado/)

const refused = confirmAiProposal(close.proposal, { confirmed: true })
assert.equal(refused.executed, false)
assert.equal(refused.write, undefined)
assert.equal(refused.clock, undefined)
assert.match(refused.message, /Não apliquei/)
assert.doesNotMatch(refused.message, /caixa fechado|drawer closed|aplicad/i)

const note = planTurn('Anota para contar o caixa', { demo: true })
assert.equal(note.proposal.kind, 'note')
assert.equal(note.proposal.executed, false)
const kept = confirmAiProposal(note.proposal, { confirmed: true })
assert.equal(kept.executed, true)
assert.equal(kept.write.table, 'ai_notes')
assert.match(kept.message, /não mudaram/i)

const punch = planTurn('bater ponto', { demo: true, connected: false })
assert.equal(punch.proposal.payload.clockConnected, false)
const punchResult = confirmAiProposal(punch.proposal, { confirmed: true })
assert.equal(punchResult.executed, false)
assert.equal(punchResult.clock, undefined)

const livePunch = planTurn('bater ponto', { demo: false, connected: true })
assert.equal(livePunch.proposal.payload.clockConnected, true)
const liveResult = confirmAiProposal(livePunch.proposal, { confirmed: true })
assert.equal(liveResult.executed, true)
assert.equal(liveResult.clock.tipo, 'in')

const snapshot = {
  mes: '2026-10',
  hoursTotal: 3,
  books: {
    pos: { amount: 100 },
    jbm: { amount: 200 },
    staff: { amount: 50 },
    rent: { amount: 25 },
  },
  pos: { salesCount: 2 },
}
const books = planTurn('Como estão as vendas?', { connected: true, snapshot, modelConfigured: false })
assert.equal(books.proposal, null)
assert.match(books.reply, /não foram somados/i)
assert.equal(books.reply.includes('375'), false)
assert.equal(books.reply.includes('¥375'), false)
assert.ok(books.sources.includes('Four books kept separate'))

assert.equal(shellTabIds('admin').includes('assistant'), true)
assert.equal(shellTabIds('funcionario').includes('assistant'), false)
assert.equal(shellTabIds('staff').includes('assistant'), false)
assert.equal(canManageBarTeam('funcionario'), false)
assert.equal(canManageBarTeam('caixa'), false)
assert.equal(canManageBarTeam('bar_staff'), false)
assert.equal(canManageBarTeam('gerente'), true)

console.log('ai workspace ok')
