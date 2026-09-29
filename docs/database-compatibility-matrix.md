# Matriz de compatibilidade do banco

Quatro colunas.

- **Current** é o que a auditoria read-only anterior viu em `ojirgkqtqvugqktyuhem`. O que não apareceu está como ausente. Policy, índice e trigger de produção continuam desconhecidos. Esta passagem não consultou o banco.
- **Migration** é o que `sql/migration_final.sql` faz quando alguém o executar. Ele foi desenhado e não foi executado.
- **Final** é o estado esperado depois dessa execução, sem backfill de histórico.
- **Status** diz se a migration cobre o conflito ou se algo continua bloqueado.

Não executar este arquivo em produção.

| Feature | Current | Migration | Final | Status |
|---|---|---|---|---|
| `produtos` catálogo global | existe, com `volume_ml` e estoque global, sem `bar_id` | não adiciona `produtos.bar_id` | catálogo global intacto | PRESERVADO |
| Preço de balcão | `bar_pricing` e `drink_menu` não provados naquela leitura | `CREATE TABLE IF NOT EXISTS` e índice único `(bar_id, produto_id)` em `bar_pricing` | cada bar tem preço e drink próprios | PRONTO PARA REVISÃO; o índice para se já houver par duplicado |
| Preço JBM por bar | `bar_product_prices` ausente | cria a tabela no bloco de procurement | preço de atacado separado do balcão | PRONTO PARA REVISÃO |
| Estoque do bar | `estoque_movimentos` com `bar_id`, `criado_por`, `obs` | `ADD COLUMN IF NOT EXISTS` dessas colunas; sem backfill | saldo do bar = soma do livro; `estoque_atual` permanece legado global | PRESERVADO |
| `vendas` conta JBM | existe; tem `cast_id` e `comissao_total`; faltam colunas de balcão | não adiciona `forma_pagamento`, `mesa`, `status`, `origem`; não liga RLS | continua a conta da JBM | PRESERVADO |
| `pos_vendas` / `pos_vendas_itens` | ausentes | criadas antes do `ALTER` do piso, com `bar_id`, noite, pagamento e ligação ao caixa | caixa do bar separado de `vendas` | PRONTO PARA REVISÃO |
| Idempotência do fechamento | ausente | `pos_idempotency`, `pos_sale_events`, `pos_close_ticket`, `pos_close_with_charges` | a mesma chave não gera segunda venda nem segunda taxa | PRONTO PARA REVISÃO |
| `caixa_movimentos` | `id`, `tipo`, `valor`, `data`, `descricao` | adiciona `bar_id` anulável, `referencia_tipo`, `referencia_id`, `operational_day`; sem `UPDATE` do histórico; liga RLS | linha nova do bar carrega o bar; linha antiga sem bar fica visível só para HQ | PRONTO PARA REVISÃO; RLS muda a visibilidade do caixa legado |
| Piso | `bar_spaces`, `pos_tickets` ausentes | cria `bar_spaces`, `pos_tickets`, `pos_ticket_items` com `open` / `closed` / `void` | ocupado e aguardando pagamento são estado da tela | PRONTO PARA REVISÃO |
| CRM | `bar_guests`, `bar_visits` ausentes | cria as duas com `bar_id` e ligação à visita e à `pos_vendas` | convidado não é o papel `cliente` | PRONTO PARA REVISÃO |
| Ponto | `time_clock` ausente | uma linha por batida (`in` / `out`) e trigger contra entrada dupla, saída sem entrada e sobreposição | sem coluna `break` | PRONTO PARA REVISÃO; intervalo continua bloqueado |
| Folha | tabelas ausentes | `payroll_rules`, `payroll_periods`, `payroll_lines`, `payroll_audit` | horas, extra, adicional noturno, comissão, desconto, bruto e líquido pela soma | PRONTO PARA REVISÃO; tipo `transport` bloqueado |
| Funcionário | `perfis` existe | `bar_employees` como título e status; `user_can_access_bar` final recusa suspenso, inativo e convite pendente | um login, um perfil | PRESERVADO |
| Fulfillment e procurement | tabelas ausentes | fulfillment primeiro, procurement depois, para a função nova prevalecer | pedido → plano → fonte → compra → recebimento → embarque → confirmação → estoque | PRONTO PARA REVISÃO; não reescreve a regra já testada |
| Configuração do caixa | `pos_bar_config` ausente | `sql/pos_ux.sql` no fim: favoritos, destaque, IA, serviço, imposto, acréscimo de cartão | padrão desligado até o bar ligar | PRONTO PARA REVISÃO |
| RLS das tabelas novas | desconhecido em produção | `ENABLE ROW LEVEL SECURITY` e policy por bar ou HQ; sem `USING (true)`; `SECURITY DEFINER` com `search_path` | bar vê o próprio bar; HQ vê a plataforma; fornecedor vê a tarefa atribuída | PRONTO PARA REVISÃO |
| RLS de `vendas`, `pedidos`, `perfis`, `produtos` | desconhecido | não liga | permanece como está em produção | BLOQUEADO até ler as policies atuais |
| `deduct_stock` / `create_order` | não vistos como instalados | excluídos | continuam fora | BLOQUEADO enquanto filtrarem `produtos.bar_id` |
| `pos_settings`, VIP, desconto, `bar_bottle_keeps` | não provados | não criados | o fechamento do piso não depende deles | BLOQUEADO; não inventar um segundo cadastro |

## Como ler o status

`PRESERVADO` significa que a migration não mexe no contrato que já funciona. `PRONTO PARA REVISÃO` significa que o SQL está no arquivo e ainda não rodou. `BLOQUEADO` significa que o arquivo se recusa a improvisar.

Nada disso foi executado.
