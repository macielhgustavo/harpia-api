# CRM comercial

O CRM é isolado por organização em todas as tabelas e consultas. Nenhum endpoint aceita `organizationId`; o tenant e o ator vêm exclusivamente da sessão validada.

## Modelo

- `SalesPipeline`: funil comercial configurável. O primeiro acesso cria, sob lock transacional, o pipeline padrão da organização.
- `SalesStage`: etapa ordenada do funil. Cada pipeline possui exatamente uma etapa ganha e uma perdida.
- `Opportunity`: oportunidade ligada a uma pessoa e, opcionalmente, a responsável, empreendimento e unidade.
- `OpportunityStageHistory`: histórico comercial imutável das movimentações de etapa, incluindo a etapa inicial.
- `SalesActivity`: ligação, e-mail, reunião, visita, tarefa ou anotação ligada à oportunidade e à sua pessoa.

O pipeline padrão contém: Novo, Contato inicial, Qualificado, Visita, Proposta, Negociação, Ganho e Perdido.

## Regras principais

- Criar uma oportunidade adiciona o papel `LEAD` à pessoa de forma idempotente.
- Uma oportunidade não pode nascer numa etapa terminal.
- A unidade precisa pertencer ao empreendimento indicado; quando apenas a unidade é informada, o empreendimento é derivado dela.
- Responsáveis precisam ser usuários ativos da mesma organização.
- Mover para Perdido exige motivo; Ganho e Perdido geram eventos de auditoria próprios.
- `estimatedValue` é recebido como string decimal canônica e armazenado como `Decimal(18,2)`. A API nunca usa ponto flutuante para dinheiro.
- O histórico de etapa atende à operação comercial. O `AuditLog` append-only registra autoria e mutações para rastreabilidade.

## API

Leitura exige `CRM_READ`; mutações exigem `CRM_WRITE`.

- `GET|POST /crm/pipelines`
- `GET|POST /crm/opportunities`
- `GET|PATCH|DELETE /crm/opportunities/:id`
- `POST /crm/opportunities/:id/move`
- `GET /crm/opportunities/:id/history`
- `GET|POST /crm/activities`
- `PATCH|DELETE /crm/activities/:id`

As listagens de oportunidades e atividades são paginadas no servidor, com limite de 100 registros por página.
