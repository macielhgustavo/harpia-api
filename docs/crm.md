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
- `GET /crm/board`
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
- Board: os mesmos da lista exceto `stageId`, mais `stageLimit`.
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

- `/crm`: Kanban e modo lista, busca, filtros por pipeline/etapa/responsável/empreendimento, drag and drop nativo com modal de confirmação, tempo na etapa, estados de atraso e estagnação, criação, edição e movimentação. O funil consome `GET /crm/board`: cada coluna tem paginação própria e os totais vêm do servidor.
- `/crm/opportunities/:id`: resumo comercial, histórico de etapas, timeline unificada, reservas, propostas e atividades. Não possui seção de visitas nem de venda.
- `/crm/tasks`: agenda comercial com as visões Hoje, Atrasadas, Próximas, Concluídas e Todas as abertas, filtros por responsável e prioridade, ações de iniciar/concluir e `Carregar mais` por visão. Cada visão é uma consulta própria ao servidor; ver a semântica abaixo.
- `/crm/visits`: lista paginada com filtros por status, responsável e período; agendamento com busca de oportunidade no servidor, registro de comparecimento com resultado, ausência e cancelamento com motivo. Não permite reagendar nem filtrar por empreendimento.

Todas as telas tratam carregamento, erro com retry e vazio, espelham `CRM_READ`/`CRM_WRITE` e são navegáveis pelo grupo "Comercial" do menu. O backend permanece a autoridade de RBAC.

### Visões da agenda comercial (`/crm/tasks`)

Cada aba é traduzida em uma consulta própria a `GET /crm/activities`. Não há reclassificação no cliente: a aba mostra exatamente o que o servidor devolveu para aquele filtro.

| Aba | Filtros enviados |
| --- | --- |
| Hoje | `openOnly=true`, `scheduledFrom=início do dia local`, `scheduledTo=último milissegundo do dia local` |
| Atrasadas | `openOnly=true`, `scheduledTo=último milissegundo antes do dia local` |
| Próximas | `openOnly=true`, `scheduledFrom=início do dia local seguinte` |
| Concluídas | `status=CONCLUIDA` |
| Todas as abertas | `openOnly=true` |

Hoje, Atrasadas e Próximas particionam a linha do tempo em `(-∞, hoje)`, `[hoje, amanhã)` e `[amanhã, +∞)`. Os intervalos são fechados nas duas pontas no backend (`gte`/`lte`), então os limites usam o último milissegundo para não se sobrepor — `scheduledAt` é `TIMESTAMP(3)`, de modo que não existe instante entre eles. Uma atividade aberta pertence a exatamente uma dessas três visões, e uma atividade de hoje às 09:00 vista às 15:00 continua em Hoje, nunca em Atrasadas.

Regras complementares:

- Concluídas não usa `openOnly`, aproveitando o contrato componível definido em CRM-FIX-02.
- O selo visual "Atrasada" segue a mesma regra da aba Atrasadas, isto é, agendamento anterior ao dia atual. Ele nunca contradiz a aba em que a atividade aparece.
- Atividades abertas **sem** `scheduledAt` não aparecem em Hoje, Atrasadas nem Próximas, porque o filtro de data do Prisma descarta `NULL`. Elas aparecem em "Todas as abertas", que existe justamente para isso.
- Atividades `CANCELADA` não são listadas em nenhuma visão de `/crm/tasks` hoje. É uma lacuna conhecida, não um efeito colateral.
- Os contadores das abas vêm do `pagination.total` da mesma consulta que produziu a lista, e não de recontagem no cliente.
- Concluídas herda a ordenação padrão do endpoint, que ordena `completedAt` de forma ascendente. Exibir as mais recentes primeiro exigiria um parâmetro de ordenação no backend, que não existe; a limitação está registrada no backlog.

#### Política de fuso horário

O dia é o **dia local do navegador**, não o dia UTC.

Os limites são calculados com `setHours(0, 0, 0, 0)` e `setDate(+1)` sobre a data local, e só então serializados com `toISOString()` para a API. Isso mantém duas propriedades: o usuário vê como "hoje" o mesmo dia que o relógio dele mostra, e o backend continua comparando instantes absolutos, sem precisar conhecer o fuso do cliente. Usar `setDate(+1)` em vez de somar 86.400.000 ms preserva a correção em dias de mudança de horário de verão.

Esta é a política adotada para o CRM e deve ser seguida por novas telas com recorte por dia. Nenhuma biblioteca de data foi introduzida.

### Kanban: `GET /crm/board`

Devolve todas as etapas de um pipeline, cada uma com **uma página própria de cards** e **agregados calculados sobre o conjunto filtrado inteiro**, não sobre a página.

```json
{
  "pipeline": { "id": "...", "name": "...", "isDefault": true },
  "stages": [
    {
      "stage": { "id": "...", "name": "Negociação", "defaultProbability": 85 },
      "summary": {
        "total": 87,
        "loaded": 20,
        "hasMore": true,
        "estimatedValue": "14350000.00",
        "weightedValue": "9680000.00"
      },
      "opportunities": [],
      "pagination": { "page": 1, "pageSize": 20, "total": 87, "totalPages": 5 }
    }
  ],
  "summary": { "total": 87, "estimatedValue": "...", "weightedValue": "..." }
}
```

- `total` é a contagem real no tenant com os filtros aplicados; `loaded` é o tamanho da página devolvida; `hasMore` é `total > loaded`.
- `stageLimit` controla quantos cards vêm por etapa (padrão 20, máximo 100). **`stageLimit=0` devolve apenas os agregados**, sem nenhuma linha: é assim que o funil atualiza os totais depois de mover um card, sem recarregar lista alguma.
- Os filtros aceitos são os mesmos da listagem, exceto `stageId` — o board sempre devolve todas as etapas.

#### Paginação por etapa

Cada coluna pagina de forma independente. O board entrega a primeira página; as seguintes vêm de `GET /crm/opportunities?stageId=...&page=N`, o endpoint que já existia. Carregar mais em uma coluna não recarrega as outras.

A ordenação de toda página de oportunidade é `updatedAt desc, id desc`. O `id` como desempate é o que garante que paginar não pule nem repita registros. A listagem de atividades ganhou o mesmo desempate.

#### Agregações

`total`, `estimatedValue` e `weightedValue` saem de **uma única consulta agregada** que cobre todas as etapas de uma vez, agrupada por `(stageId, probability)`. Agrupar também por probabilidade é o que permite calcular o valor ponderado sem SQL bruto: `probability` é inteiro de 0 a 100, então os buckets são poucos e limitados, e a soma ponderada é feita com `Prisma.Decimal`.

`weightedValue` é `Σ (soma do bucket × probabilidade ÷ 100)`. Quando a oportunidade não tem probabilidade própria, usa-se a `defaultProbability` da etapa — o mesmo critério que a interface aplica ao exibir.

**Dinheiro nunca passa por `Number`.** As somas são feitas em `Prisma.Decimal` e serializadas como string decimal canônica com duas casas. O frontend trata esses campos como string opaca e só os converte na formatação para exibição.

#### Custo de consultas

Uma leitura do pipeline, uma agregação cobrindo todas as etapas e uma página por etapa, disparadas em paralelo — cerca de dez round trips no pipeline padrão de oito etapas. Uma única consulta com window function economizaria algumas idas ao banco, mas exigiria SQL bruto reimplementando o predicado compartilhado; a parte que cresce com o volume de dados é a agregação, e essa já é uma consulta só.

O índice `Opportunity_organizationId_stageId_updatedAt_idx` (migration `20260906010000_crm_board_stage_index`) sustenta a paginação por etapa. Os índices anteriores cobriam `createdAt` e `stageEnteredAt`, não a ordenação usada pelas páginas.

#### Filtros e agregados sempre coerentes

Cards, contagem e valores saem do mesmo predicado, montado por `buildOpportunityWhere` (`src/crm/opportunity-filters.ts`) e reutilizado pela listagem, pelas páginas de cada coluna e pela agregação. Não existe uma segunda implementação dos filtros.

### Truncamento no frontend

Nenhuma lista do CRM é apresentada como completa quando não é.

- **Funil**: 20 cards por coluna, com `Carregar mais N` mostrando exatamente quantos faltam. Contagem e valores no cabeçalho da coluna vêm do servidor.
- **Mover card**: a coluna de origem e a de destino são ajustadas localmente e os agregados são relidos com `stageLimit=0`. Se a chamada falhar, o estado anterior das colunas é restaurado.
- **`/crm/tasks`**: 20 atividades por página, com `Carregar mais` por visão. Os badges continuam vindo de `pagination.total`.
- **`/crm/visits`**: o seletor de oportunidade passou a ser busca no servidor com *debounce* de 300 ms, cobrindo qualquer oportunidade do tenant. A quantidade não exibida é informada.

Limites que permanecem, por serem por oportunidade e não por tenant: atividades, reservas e propostas dentro do detalhe da oportunidade carregam até 100 registros cada, e a timeline segue sem paginação.
