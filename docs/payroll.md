# Folha operacional

Este módulo não substitui o cadastro (`perfis`) nem o ponto (`time_clock`). Não altera `sql/procurement.sql`.

O arquivo `sql/payroll.sql` precisa ser aplicado manualmente no Supabase. Ele não foi aplicado daqui. Enquanto isso, a tela mostra que as tabelas ainda não existem.

## O que a folha faz

- Competência com status `draft`, `calculated`, `approved`, `paid`, `cancelled`.
- Lançamentos com `employee_id`, `bar_id`, tipo, origem e `source_id`.
- Hora extra e adicional noturno só entram no dinheiro se a regra da competência tiver multiplicador ou taxa. Sem isso, a hora aparece como indicador.
- Atraso e falta não viram desconto.
- Ocorrência e penalidade de ponto não viram desconto.
- Desconto financeiro só entra se estiver `approved`.
- Comissão e prêmio aprovado viram lançamentos separados, com a origem guardada.
- Depois de `approved` ou `paid`, o saldo antigo não é editado. Correção é um lançamento `adjustment` e uma linha de auditoria.

HQ é `admin` ou `jbm`, nas funções `is_payroll_hq` e `payroll_require_hq`. O funcionário lê só `payroll_my_pack`, que filtra `auth.uid()`.

Não há cálculo de imposto, previdência, férias ou 13º.
