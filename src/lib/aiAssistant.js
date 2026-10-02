/** Conversational assistant policy. Never invents business figures or executes operations. */

export const CHAT_STORAGE_KEY = 'atomic-bar-ai-chat'

export const SUGGESTED_QUESTIONS = [
  'How did recorded sales look for this bar?',
  'Explain gross profit and CMV using only connected figures.',
  'Which products are running low?',
  'Prepare a purchase order for the products running low.',
  'What is open with suppliers and purchase orders?',
  'Is the cash register ready to close?',
  'How do labor and shift costs look?',
  'Compare this venue with the others.',
]

const DEMO_TEXT = 'Local demo did not call a model and did not read sales, profit, inventory, procurement, cash, labor, or reports. Nothing was calculated or saved.'
const UNCONFIGURED_TEXT = 'No model provider is configured. GEMINI_API_KEY is not set on the server, so no response was generated. Operational data is not connected either.'
const DISCONNECTED_TEXT = 'No operational database is connected to this request. Sales, profit, inventory, procurement, cash, labor, and venue comparisons were not read. No figure was calculated or saved.'
const PROVIDER_ERROR_TEXT = 'The model provider failed before a reply was accepted. No business result was calculated or saved.'

export function describeProvider(env = process.env) {
  const configured = Boolean(String(env.GEMINI_API_KEY || '').trim())
  return {
    configured,
    provider: configured ? 'gemini' : null,
    connected: false,
    drafts: false,
  }
}

export function composerAction(event) {
  if (!event || event.key !== 'Enter') return 'idle'
  if (event.isComposing || event.keyCode === 229) return 'idle'
  if (event.shiftKey) return 'newline'
  return 'send'
}

export function classifyIntent(text) {
  const q = String(text || '').toLowerCase()
  if (/purchase order|reorder|running low|restock|発注/.test(q)) return 'draft-purchase'
  if (/close the register|cash closing|close cash|fechamento|レジ締め/.test(q)) return 'draft-close'
  if (/payroll|approve hours|pay staff|folha/.test(q)) return 'draft-payroll'
  return 'question'
}

export function finalizeDraft(intent) {
  if (intent === 'draft-purchase') {
    return {
      supported: false,
      executed: false,
      status: 'not_created',
      title: 'Purchase order',
      reason: 'Stock and supplier costs are not connected. No products, quantities, or estimated cost were drafted.',
    }
  }
  if (intent === 'draft-close') {
    return {
      supported: false,
      executed: false,
      status: 'not_created',
      title: 'Cash closing',
      reason: 'No live register is connected. Approving a note here does not close cash.',
    }
  }
  if (intent === 'draft-payroll') {
    return {
      supported: false,
      executed: false,
      status: 'not_created',
      title: 'Payroll',
      reason: 'Time clock and payroll books are not connected. No pay was approved or written.',
    }
  }
  return null
}

export function assistantSystemPrompt() {
  return [
    'You are the Atomic Bar assistant.',
    'No operational database is attached to this request.',
    'If the user asks for sales, profit, CMV, products, stock, suppliers, cash, labor, reports, or venue comparisons, say the data is not connected.',
    'Do not invent numbers, product names, suppliers, quantities, costs, or comparisons.',
    'Do not say an order, payment, payroll run, stock movement, or cash close was created or executed.',
    'Reply in concise JSON: {"answer":"","detail":"","followups":[]}.',
    'followups must be questions the user could ask, not claims that data exists.',
  ].join(' ')
}

export function containsBusinessClaim(text) {
  const value = String(text || '')
  if (/[¥￥]|[0-9][0-9,]{2,}|\b\d+(?:\.\d+)?\s*%|\b\d+\s*(yen|jpy|units|bottles)\b/i.test(value)) return true
  return /created the|has been created|was created|order sent|closed the register|payroll (was|has been) (approved|paid)|inventory (was|has been) updated|i (ordered|paid|closed)/i.test(value)
}

export function safeErrorMessage(error) {
  return String(error?.message || error || 'Unknown provider error')
    .replace(/AIza[\w-]+/g, '[redacted]')
    .replace(/key=[^&\s]+/gi, 'key=[redacted]')
    .slice(0, 180)
}

export function presentModelAnswer(raw, { intent } = {}) {
  const parsed = parseModelPayload(raw)
  const answer = String(parsed.answer || '').trim()
  const detail = String(parsed.detail || '').trim()
  const draft = finalizeDraft(intent)
  if (!answer || containsBusinessClaim(answer) || containsBusinessClaim(detail)) {
    return {
      state: 'disconnected',
      fromModel: false,
      text: DISCONNECTED_TEXT,
      detail: '',
      followups: [],
      kpis: [],
      table: null,
      chart: null,
      comparison: null,
      draft,
      sources: ['Model reply withheld', 'No operational database attached'],
    }
  }
  return {
    state: 'answer',
    fromModel: true,
    text: answer,
    detail,
    followups: Array.isArray(parsed.followups) ? parsed.followups.map(item => String(item)).filter(Boolean).slice(0, 4) : [],
    kpis: [],
    table: null,
    chart: null,
    comparison: null,
    draft,
    sources: ['Gemini model', 'No operational database attached'],
  }
}

function parseModelPayload(raw) {
  const text = String(raw || '').trim()
  if (!text) return {}
  const cleaned = text.replace(/```json|```/g, '').trim()
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    /* plain text is still subject to the claim check */
  }
  return { answer: text }
}

function responseBody({ state, configured, text, detail = '', fromModel = false, draft = null, sources = [], followups = [] }) {
  return {
    ok: state === 'answer',
    state,
    configured,
    connected: false,
    fromModel,
    text,
    detail,
    followups,
    kpis: [],
    table: null,
    chart: null,
    comparison: null,
    draft,
    sources,
  }
}

export function sanitizeMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter(message => message && (message.role === 'user' || message.role === 'assistant') && String(message.content || '').trim())
    .slice(-20)
    .map(message => ({
      role: message.role,
      content: String(message.content).trim().slice(0, 4000),
    }))
}

export async function answerAssistantTurn({ messages, demo } = {}, { configured = false, generate } = {}) {
  const list = sanitizeMessages(messages)
  if (!list.length || list[list.length - 1].role !== 'user') {
    return {
      status: 400,
      body: responseBody({
        state: 'error',
        configured,
        text: 'Enter a message before asking the assistant.',
        sources: ['Request rejected'],
      }),
    }
  }
  const intent = classifyIntent(list[list.length - 1].content)
  const draft = finalizeDraft(intent)
  if (demo) {
    return {
      status: 200,
      body: responseBody({
        state: 'demo',
        configured,
        text: DEMO_TEXT,
        draft,
        sources: ['Local demo policy', 'Model was not called', 'No operational database attached'],
      }),
    }
  }
  if (!configured) {
    return {
      status: 200,
      body: responseBody({
        state: 'unconfigured',
        configured: false,
        text: UNCONFIGURED_TEXT,
        draft,
        sources: ['GEMINI_API_KEY is not set', 'No operational database attached'],
      }),
    }
  }
  try {
    const raw = await generate({ system: assistantSystemPrompt(), messages: list })
    const presented = presentModelAnswer(raw, { intent })
    return {
      status: 200,
      body: {
        ...presented,
        ok: presented.state === 'answer',
        configured: true,
        connected: false,
      },
    }
  } catch (error) {
    return {
      status: 200,
      body: responseBody({
        state: 'error',
        configured: true,
        text: PROVIDER_ERROR_TEXT,
        detail: safeErrorMessage(error),
        draft,
        sources: ['Model provider error', 'No operational database attached'],
      }),
    }
  }
}

export function createConversation(now = Date.now()) {
  const stamp = new Date(now).toISOString()
  return {
    id: `conv-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'New conversation',
    createdAt: stamp,
    updatedAt: stamp,
    messages: [],
  }
}

export function emptyChatStore(now = Date.now()) {
  const conversation = createConversation(now)
  return { activeId: conversation.id, conversations: [conversation] }
}

export function loadChatStore(storage, now = Date.now()) {
  if (!storage) return emptyChatStore(now)
  try {
    const parsed = JSON.parse(storage.getItem(CHAT_STORAGE_KEY) || '')
    if (!parsed?.conversations?.length) return emptyChatStore(now)
    const conversations = parsed.conversations.slice(0, 12).map(normalizeConversation)
    const activeId = conversations.some(item => item.id === parsed.activeId) ? parsed.activeId : conversations[0].id
    return { activeId, conversations }
  } catch {
    return emptyChatStore(now)
  }
}

export function saveChatStore(storage, store) {
  if (!storage) return
  const conversations = (store?.conversations || []).slice(0, 12)
  storage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ activeId: store.activeId, conversations }))
}

function normalizeConversation(conversation) {
  return {
    id: String(conversation.id || createConversation().id),
    title: String(conversation.title || 'New conversation').slice(0, 80),
    createdAt: conversation.createdAt || new Date().toISOString(),
    updatedAt: conversation.updatedAt || conversation.createdAt || new Date().toISOString(),
    messages: Array.isArray(conversation.messages) ? conversation.messages.slice(-40) : [],
  }
}

export function conversationTitle(messages, fallback = 'New conversation') {
  const first = (messages || []).find(message => message.role === 'user' && String(message.content || '').trim())
  if (!first) return fallback
  const compact = String(first.content).replace(/\s+/g, ' ').trim()
  return compact.length > 42 ? `${compact.slice(0, 42)}…` : compact
}
