import { useSearchParams } from 'react-router-dom'
import { Chip } from '../components/ui'
import Pulso from './operacao/Pulso'
import SalasVip from './operacao/SalasVip'

export default function Operacao() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'vip' ? 'vip' : 'pulso'

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>Operação</h2>
          <div style={{ fontSize: 12, color: 'var(--white60)' }}>
            A cada 30 minutos: faturamento, custo da equipe, lucro e quanto falta vender para empatar
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Chip active={tab === 'pulso'} onClick={() => setParams({})}>Pulso 30 min</Chip>
          <Chip active={tab === 'vip'} onClick={() => setParams({ tab: 'vip' })}>Salas VIP</Chip>
        </div>
      </div>
      {tab === 'pulso' ? <Pulso /> : <SalasVip />}
    </div>
  )
}
