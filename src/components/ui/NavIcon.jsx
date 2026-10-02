/** Inline navigation marks. The app has no icon package. */

const PATHS = {
  dashboard: 'M4 13h7V4H4v9z M13 20h7V11h-7v9z M4 20h7v-5H4v5z M13 9h7V4h-7v5z',
  billingHub: 'M5 4h14v16H5z M8 8h8 M8 12h5 M8 16h7',
  purchases: 'M4 7h16l-2 8H7L4 7z M9 19a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm7 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  sales: 'M4 18h16 M7 15v-4 M12 15V6 M17 15V9',
  fulfillment: 'M3 7h11v8H3z M14 10h4l3 3v2h-7z M7 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  procurement: 'M4 8l8-4 8 4-8 4-8-4z M4 8v8l8 4 8-4V8 M12 12v8',
  relatorio: 'M5 19V5 M5 19h14 M8 15l3-4 3 2 4-6',
  ryoshusho: 'M7 4h10v16l-2-1-2 1-2-1-2 1-2-1z M9 8h6 M9 12h6',
  seikyusho: 'M7 3h7l5 5v13H7z M14 3v5h5 M9 13h6 M9 17h6',
  products: 'M4 8l8-4 8 4-8 4-8-4z M4 8v8l8 4 8-4V8',
  bars: 'M4 20V9l8-5 8 5v11 M8 20v-6h8v6',
  usuarios: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M4 19c.5-2.5 2.4-4 5-4s4.5 1.5 5 4 M15 15c1.8 0 3.4.8 4 3',
  faturas: 'M7 3h7l5 5v13H7z M14 3v5h5 M9 13h6 M9 17h6',
  suppliers: 'M4 20V8l8-4 8 4v12 M9 20v-6h6v6',
  cashflow: 'M4 12h16 M14 6l6 6-6 6 M10 8H6a2 2 0 0 0-2 2v8',
  payroll: 'M4 8h16v10H4z M4 11h16 M8 15h3',
  profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M5 21c.7-4 3.2-6 7-6s6.3 2 7 6',
  shifts: 'M7 4v3 M17 4v3 M4 9h16 M6 6h12a2 2 0 0 1 2 2v10H4V8a2 2 0 0 1 2-2z',
  clock: 'M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  goals: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  result: 'M5 19V5 M5 19h14 M8 15l3-4 3 2 4-6',
  points: 'M12 3l2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9L6.6 20l1-6.1-4.4-4.3 6.1-.9z',
  occurrences: 'M12 3 2 21h20L12 3z M12 9v5 M12 18h.01',
  rewards: 'M4 8h16v12H4z M12 8v12 M4 12h16 M8 8c-2-2-1-4 1-4 2 0 3 4 3 4 M16 8c2-2 1-4-1-4-2 0-3 4-3 4',
  salary: 'M4 8h16v10H4z M4 11h16 M8 15h3',
  inicio: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z',
  pos: 'M6 6h15l-1.5 9h-12z M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  espacos: 'M6 20V9l6-4 6 4v11 M9 20v-6h6v6',
  pedidos: 'M7 4h10v16H7z M9 8h6 M9 12h6 M9 16h4',
  estoque: 'M4 8l8-4 8 4-8 4-8-4z M4 8v8l8 4 8-4V8 M12 12v8',
  entregas: 'M3 7h11v8H3z M14 10h4l3 3v2h-7z M7 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zm10 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  fornecedor: 'M4 20V8l8-4 8 4v12 M9 20v-6h6v6',
  clientes: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M16 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M4 19c.5-2.5 2.4-4 5-4s4.5 1.5 5 4 M15 15c1.8 0 3.4.8 4 3',
  staff: 'M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 19c.6-2.4 2.8-4 6-4s5.4 1.6 6 4',
  ponto: 'M12 7v5l3 2 M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z',
  salarios: 'M4 8h16v10H4z M4 11h16 M8 15h3',
  fechamento: 'M4 7h16v12H4z M8 7V5h8v2 M12 12v4 M10 14h4',
  pagamentos: 'M3 8h18v9H3z M3 11h18 M7 15h4',
  faturas: 'M7 3h7l5 5v13H7z M14 3v5h5 M9 13h6 M9 17h6',
  custos: 'M5 19V5 M5 19h14 M8 15l3-4 3 2 4-6',
  metas: 'M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M12 12h.01',
  eventos: 'M7 4v3 M17 4v3 M4 9h16 M6 6h12a2 2 0 0 1 2 2v10H4V8a2 2 0 0 1 2-2z',
  ia: 'M12 3l1.2 4.2L17 8.5l-3.8 1.3L12 14l-1.2-4.2L7 8.5l3.8-1.3z',
  parceiro: 'M8 13l2 2 4-5 M6 19c.5-2 2-3 4-3 M14 16c1.5 0 3 .7 3.5 2.5',
  drinkback: 'M8 8h8l-1 9H9z M9 8c0-2 1.3-3 3-3s3 1 3 3',
  cartao: 'M3 8h18v9H3z M3 12h18',
  energia: 'M13 3 6 13h6l-1 8 8-12h-6z',
  aluguel: 'M4 20V9l8-5 8 5v11 M10 20v-6h4v6',
  fixo: 'M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4z M12 13V8 M8 9l4-2 4 2',
  variavel: 'M4 16l5-6 4 3 7-8',
  contador: 'M7 4h10v16H7z M9 8h6 M9 12h2 M13 12h2 M9 16h2 M13 16h2',
  imposto: 'M6 20V8l6-4 6 4v12 M10 20v-5h4v5',
  precos: 'M5 8h14v10H5z M8 8V6h8v2 M9 13h6',
  recibos: 'M7 4h10v16l-2-1-2 1-2-1-2 1-2-1z M9 8h6 M9 12h6',
  more: 'M5 7h14 M5 12h14 M5 17h14',
}

export default function NavIcon({ name }) {
  const d = PATHS[name] || PATHS.more
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}
