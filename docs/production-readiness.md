# Prontidão

Classificação contra o código deste repositório e a auditoria read-only de produção já feita. Não é uma certificação do ambiente ao vivo.

| Área | Estado | Motivo |
|---|---|---|
| Authentication | NEEDS WORK | Supabase Auth e convite estão no código. Redirect de produção e `bar_employees` não estão confirmados no banco. |
| Authorization | NEEDS WORK | Papéis e policies estão nos scripts. Policies de produção são desconhecidas. |
| RLS | BLOCKED | Não lida em produção nesta passagem. |
| Database | BLOCKED | Produção não tem `pos_vendas`, piso, ponto, fulfillment nem procurement. |
| POS | NEEDS WORK | Fluxo e idempotência existem no SQL do piso. Produção não tem as tabelas. |
| Payments | NEEDS WORK | Confirmação e taxas estão no motor. Gravação da taxa extra depende de `sql/pos_ux.sql`. |
| Inventory | NEEDS WORK | Movimento por bar existe em produção. Saldo global ainda está na tabela `produtos`. A tela de HQ não mostra em trânsito e reservado juntos. |
| Procurement | NEEDS WORK | Código e testes estão fortes. Tabelas ausentes em produção. |
| Supplier | NEEDS WORK | Mesmo caso do procurement. |
| Payroll | BLOCKED | Sem `time_clock` não há hora real. |
| Reports | NEEDS WORK | Relatórios leem `vendas` e `pos_vendas`. O segundo livro não existe em produção. |
| Audit | NEEDS WORK | Eventos estão desenhados. `audit_logs` não está em produção. |
| Error handling | NEEDS WORK | O caixa mostra frase curta para preço, produto inativo e taxa não instalada. Várias telas ainda mostram `error.message`. |
| Monitoring | BLOCKED | Não há monitoramento definido neste repositório. |
| Backups | BLOCKED | Não verificados. Não fazem parte do app. |
| Recovery | NEEDS WORK | Recuperação de senha está no cliente. O allow-list do redirect não foi configurado daqui. |
| Performance | NEEDS WORK | Busca do caixa é local, sem pedido por tecla. Não houve medição de tempo de tela. |

Nada aqui está READY para abrir um bar novo só com o que produção tem hoje. O caixa legado que já roda em `vendas` não deve ser confundido com o piso novo.
