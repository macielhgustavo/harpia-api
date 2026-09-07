# CRM comercial

O CRM é isolado por organização em todas as tabelas e consultas. Nenhum endpoint aceita `organizationId`; o tenant e o ator vêm exclusivamente da sessão validada.

Em produção, migrations pendentes são aplicadas pela própria inicialização da API antes de o serviço começar a aceitar requisições (`src/database/run-production-migrations.ts`, chamado por `src/main.ts`). A recuperação automática é limitada à migration idempotente `20260904040000_sales_visits`, caso um deploy anterior tenha deixado somente ela marcada como falha (P3009).

Última verificação contra o código: 2026-09-06 (backend `cfcca47`, frontend `33fc566`).

## Modelo

- `SalesPipeline`: funil comercial configurável. O primeiro acesso cria, sob lock transacional, o pipeline padrão da organização.
- `SalesStage`: etapa ordenada do funil, com `defaultProbability` (`Int`, CHECK 0–100). Cada pipeline possui exatamente uma etapa ganha e uma perdida.
- `Opportunity`: oportunidade ligada a uma pessoa e, opcionalmente, a responsável, empreendimento e unidade.
- `OpportunityStageHistory`: histórico comercial imutável das movimentações de etapa, incluindo a etapa inicial.
- `SalesActivity`: atividade ligada à oportunidade e à sua pessoa, com status, prioridade, lembrete e resultado.
- `SalesVisit`: visita imobiliária estruturada, ligada à oportunidade, pessoa, responsável, empreendimento e unidade, com agenda, duração, comparecimento e resultado.

O pipeline padrão contém: Novo (5%), Contato inicial (15%), Qualificado (30%), Visita (50%), Proposta (70%), Negociação (85%), Ganho (100%) e Perdido (0%).

### Enums vigentes

- `SalesActivityType`: `LIGACAO`, `WHATSAPP`, `EMAIL`, `REUNIAO`, `VISITA`, `FOLLOW_UP`, `OUTRO`. Não existem os tipos `TAREFA` nem `ANOTACAO`.
- `SalesActivityStatus`: `PENDENTE`, `EM_ANDAMENTO`, `CONCLUIDA`, `CANCELADA`.
- `SalesActivityPriority`: `BAIXA`, `NORMAL`, `ALTA`, `URGENTE`.
- `SalesVisitStatus`: `AGENDADA`, `REALIZADA`, `CANCELADA`, `NAO_COMPARECEU`.
- `SalesVisitOutcome`: `INTERESSE_ALTO`, `INTERESSE_MEDIO`, `INTERESSE_BAIXO`, `SEM_INTERESSE`, `REAGENDAR`.

## Regras principais

- Criar uma oportunidade adiciona o papel `LEAD` à pessoa de forma idempotente.
- Uma oportunidade não pode nascer numa etapa terminal.
- A unidade precisa pertencer ao empreendimento indicado; quando apenas a unidade é informada, o empreendimento é derivado dela.
- Responsáveis precisam ser usuários ativos da mesma organização.
- Mover para Perdido exige motivo; Ganho e Perdido geram eventos de auditoria próprios.
- Toda mudança de etapa passa por `applyOpportunityStageChange` (`src/crm/opportunity-stage.ts`), o escritor único de `Opportunity.stageId`. Ele grava `stageEnteredAt`, cria o registro em `OpportunityStageHistory` e devolve os eventos de auditoria, de modo que os três invariantes não podem divergir. Isso vale para a movimentação manual, para o aceite de proposta e para a conversão em venda.
- A função é um no-op quando a oportunidade já está na etapa de destino: não grava histórico, não reemite auditoria e não recarimba `stageEnteredAt`.
- O chamador continua responsável por abrir a transação, aplicar o lock `FOR UPDATE` tenant-scoped na oportunidade e persistir os eventos retornados.
- Quando a probabilidade não é informada na criação, ela herda a probabilidade padrão da etapa inicial. A movimentação de etapa **não** recalcula a probabilidade.
- Atividades possuem ciclo explícito e prioridade. Ao concluir sem informar horário, o backend registra a conclusão; estados não concluídos não mantêm `completedAt`.
- A listagem de atividades aceita filtros por oportunidade, pessoa, responsável, tipo, status, prioridade, intervalo de agendamento e `openOnly`, sempre no tenant da sessão. O predicado é montado num único lugar, `buildSalesActivityWhere` (`src/crm/sales-activity-filters.ts`), de modo que nenhum filtro dependa da ordem de spread nem sobrescreva outro.
- Visitas começam agendadas; realização, ausência ou cancelamento preservam o marco temporal enquanto o status permanecer naquela classe. Cancelamento exige motivo e `outcome` estruturado só pode ser informado para visita realizada.
- `estimatedValue` é recebido como string decimal canônica e armazenado como `Decimal(18,2)`. A API nunca usa ponto flutuante para dinheiro comercial novo.
- O histórico de etapa atende à operação comercial. O `AuditLog` append-only registra autoria e mutações para rastreabilidade.

## Limitações conhecidas do modelo atual

Estes pontos são reais e verificados no código. Não devem ser descritos como resolvidos até que exista correção.

- **Oportunidades ganhas entre 2026-09-04 e 2026-09-06 podem ter `stageEnteredAt` defasado.** O defeito que permitia isso foi corrigido (ver CRM-FIX-01), mas os registros já gravados no período só são reparados por um backfill autorizado. O procedimento está documentado em `docs/crm-master-audit.md`.
- **Timeline e histórico não são paginados.** `findOpportunityTimeline` executa seis consultas sem `take` e ordena em memória; `findOpportunityHistory` também não limita resultados.
- **`lostReason` é apagado ao sair da etapa perdida** e não é replicado nos metadados de auditoria, tornando o motivo irrecuperável.
- **`SalesVisit.companyId` existe no schema e no banco mas não é usado** por nenhum service, DTO ou include. Foi introduzido pela migration `20260905010000_sales_visits_company_scope` para reconciliar drift do Prisma.
- **`reminderAt` é armazenado mas nunca processado.** O CRM não consome o módulo de notificações; não existe worker de lembretes.
- **Não existem endpoints de edição, exclusão ou reordenação de pipelines e etapas.** Só há `GET` e `POST /crm/pipelines`.
- **Origem (`source`) e motivo de perda (`lostReason`) são texto livre.** Não existem catálogos tenant-scoped.

## API

Leitura exige `CRM_READ`; mutações exigem `CRM_WRITE`. O guard é global e fail-closed.

- `GET|POST /crm/pipelines`
- `GET|POST /crm/opportunities`
- `GET|PATCH|DELETE /crm/opportunities/:id`
- `POST /crm/opportunities/:id/move`
- `GET /crm/opportunities/:id/history`
- `GET /crm/opportunities/:id/timeline`
- `GET|POST /crm/activities`
- `PATCH|DELETE /crm/activities/:id`
- `GET|POST /crm/visits`
- `PATCH /crm/visits/:id`

As listagens de oportunidades, atividades e visitas são paginadas no servidor, com limite de 100 registros por página. Não existe `GET /crm/visits/:id`.

### Filtros aceitos

- Oportunidades: `stageId`, `pipelineId`, `assignedUserId`, `developmentId`, `personId`, `source`, `search`, `page`, `pageSize`.
- Atividades: `opportunityId`, `personId`, `assignedUserId`, `type`, `status`, `priority`, `scheduledFrom`, `scheduledTo`, `openOnly`, `page`, `pageSize`.

#### Contrato de `status` e `openOnly`

São filtros independentes, combinados com **E** lógico. Nenhum dos dois sobrescreve o outro.

- `status` fixa exatamente um status.
- `openOnly=true` restringe às atividades **abertas**, hoje `PENDENTE` e `EM_ANDAMENTO`. A lista canônica é `OPEN_SALES_ACTIVITY_STATUSES`, fonte única da definição de "aberta"; acrescentar um status aberto no futuro é editar apenas essa constante.
- `openOnly=false` ou ausente não impõe restrição alguma.

Enviar os dois é uma interseção de conjuntos:

| Requisição | Resultado |
| --- | --- |
| `status=CONCLUIDA` | atividades concluídas |
| `openOnly=true` | pendentes e em andamento |
| `status=PENDENTE&openOnly=true` | apenas pendentes |
| `status=EM_ANDAMENTO&openOnly=true` | apenas em andamento |
| `status=CONCLUIDA&openOnly=true` | **conjunto vazio** |
| `status=CANCELADA&openOnly=true` | **conjunto vazio** |
| nenhum dos dois | qualquer status |

Pedir um status fechado junto de `openOnly` é insatisfazível por definição e devolve página vazia com `total: 0`, em vez de ignorar silenciosamente um dos filtros. A interseção vazia é traduzida para o predicado `status IN ()` do Prisma, que não casa com nenhum registro.
- Visitas: `opportunityId`, `assignedUserId`, `status`, `scheduledFrom`, `scheduledTo`, `page`, `pageSize`. Não há filtro por empreendimento.

## Interface (harpia-web)

- `/crm`: Kanban e modo lista, busca, filtros por pipeline/etapa/responsável/empreendimento, drag and drop nativo com modal de confirmação, tempo na etapa, estados de atraso e estagnação, criação, edição e movimentação. Carrega uma página de 50 oportunidades e distribui as colunas no cliente — totais e contagens por etapa refletem apenas o que foi carregado.
- `/crm/opportunities/:id`: resumo comercial, histórico de etapas, timeline unificada, reservas, propostas e atividades. Não possui seção de visitas nem de venda.
- `/crm/tasks`: agenda comercial com visões Hoje, Atrasadas, Próximas e Todas, filtros por responsável e prioridade, e ações de iniciar/concluir. Consulta sempre com `openOnly`, portanto não existe visão de concluídas.
- `/crm/visits`: lista paginada com filtros por status, responsável e período; agendamento, registro de comparecimento com resultado, ausência e cancelamento com motivo. Não permite reagendar nem filtrar por empreendimento.

Todas as telas tratam carregamento, erro com retry e vazio, espelham `CRM_READ`/`CRM_WRITE` e são navegáveis pelo grupo "Comercial" do menu. O backend permanece a autoridade de RBAC.
