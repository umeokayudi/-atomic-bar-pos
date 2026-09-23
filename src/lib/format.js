export const fmt = n => '¥' + Math.round(Number(n) || 0).toLocaleString('ja-JP')

export const todayTokyo = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })

export const FUNCOES = [
  { value: 'hostess', label: 'Hostess / Cast' },
  { value: 'barman', label: 'Barman' },
  { value: 'staff', label: 'Staff' },
  { value: 'gerente', label: 'Gerente' },
  { value: 'cozinha', label: 'Cozinha' },
  { value: 'seguranca', label: 'Segurança' },
  { value: 'outro', label: 'Outro' },
]

export const FORMAS_PAGAMENTO = [
  { value: 'hora', label: 'Por hora' },
  { value: 'comissao', label: 'Comissão' },
  { value: 'hora_comissao', label: 'Hora + comissão' },
]

export const CICLOS = [
  { value: 'diario', label: 'Diário' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'quinzenal', label: 'Quinzenal' },
  { value: 'mensal', label: 'Mensal' },
]

export const DIAS_SEMANA = [
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
  { value: 0, label: 'Domingo' },
]

export const CUSTO_CATEGORIAS = [
  'Aluguel',
  'Energia',
  'Gás',
  'Água',
  'Internet',
  'Salários',
  'Fornecedores',
  'Manutenção',
  'Marketing',
  'Impostos',
  'Transporte',
  'Outros',
]

export function labelFuncao(v) {
  return FUNCOES.find(f => f.value === v)?.label || v || '—'
}

export function labelForma(v) {
  return FORMAS_PAGAMENTO.find(f => f.value === v)?.label || v || '—'
}

export function labelCiclo(v) {
  return CICLOS.find(c => c.value === v)?.label || v || '—'
}

export const inputStyle = {
  width: '100%',
  background: 'var(--white05)',
  border: '0.5px solid var(--gold-border)',
  borderRadius: 6,
  color: 'var(--white90)',
  padding: '7px 10px',
  fontSize: 13,
}
