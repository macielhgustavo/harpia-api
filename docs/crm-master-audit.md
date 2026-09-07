# Auditoria técnica — evolução do CRM Harpia

Data da auditoria: 2026-09-04

## Objetivo

Este documento registra o estado real do CRM antes da evolução prevista nas fases B–K. A diretriz central é estender o domínio existente sem duplicar `Person`, `Development`, `Unit`, `UnitReservation`, `SalesProposal`, `Sale`, `Receivable`, `Interaction` ou qualquer outra entidade já responsável pelo ciclo comercial e financeiro.

## Base auditada

- Backend: NestJS, Prisma 5.22 e PostgreSQL, branch `main`, commit de produção `de6dd18`.
- Frontend: Angular 18 standalone, Tailwind, RxJS e Signals, branch `main`, commit `a65ec3c`.
- Produção: API na Render e frontend na Vercel.
- Fontes verificadas: schema Prisma completo, rotas HTTP, matriz de permissões, auditoria, notificações, pessoas, interações, CRM, reservas, propostas, vendas, unidades, empreendimentos, preços e financeiro.

## O que já está sólido

### Domínio e integridade

- `Person` é a pessoa central e recebe o papel `LEAD` de forma idempotente ao entrar no CRM.
- `SalesPipeline` e `SalesStage` já permitem múltiplos funis e etapas ordenadas, com marcadores explícitos de ganho e perda, sem depender do nome da etapa.
- `Opportunity` já se conecta a pessoa, pipeline, etapa, responsável, empreendimento e unidade opcional.
- O vínculo de unidade valida o empreendimento e não obriga a oportunidade inicial a possuir uma unidade.
- `OpportunityStageHistory` preserva a criação e cada troca de etapa.
- `SalesActivity` já cobre ligação, WhatsApp, e-mail, reunião, visita, follow-up e outro.
- Reservas, propostas versionadas, vendas, recebíveis e financeiro já formam uma sequência transacional conectada.

### Segurança e concorrência

- O `organizationId` é derivado da sessão e aplicado nas consultas e mutações.
- CRM, reservas, propostas e vendas usam transações, locks de linha e revalidações nos pontos críticos.
- Constraints impedem reserva ativa concorrente, conversão duplicada de proposta e venda duplicada da unidade.
- O backend é a autoridade de RBAC; o frontend apenas espelha permissões para a experiência do usuário.
- As mutações comerciais relevantes geram auditoria append-only na mesma transação do dado de negócio.

### Experiência atual

- `/crm` já possui funil, modo lista, busca, filtros, paginação, criação, edição e movimentação de oportunidades.
- `/crm/opportunities/:id` já reúne resumo comercial, histórico de etapas, reservas, propostas e atividades.
- Estados de carregamento, erro, vazio e permissão já existem e são responsivos.
- O fluxo comercial continua conectado a empreendimentos, unidades, preços, vendas e financeiro.

## Lacunas por fase

| Fase | Estado atual | Evolução necessária |
| --- | --- | --- |
| B — Pipeline, lista e detalhe | Base funcional pronta | Drag and drop com rollback, gestão completa de pipelines/etapas, tempo na etapa, ordenação e filtros ampliados, cards e detalhe mais densos |
| C — Timeline e follow-up | Histórico e atividades separados | Timeline unificada, estados/prioridade/resultado de atividade, página `/crm/tasks`, lembretes e visões Hoje/Atrasadas/Próximas |
| D — Visitas | `VISITA` é apenas um tipo de atividade | Criar `SalesVisit` explícita com agenda, comparecimento, resultado, auditoria e interface própria |
| E — Interesse e matching | Empreendimento e unidade opcionais | Preferências imobiliárias estruturadas, tipologia/faixa/área/quartos/entrada e recomendação explicável de unidades |
| F — Origem, tags e perdas | Origem e motivo de perda são texto livre | Catálogos tenant-scoped, UTM preparada, tags controladas e motivos de perda configuráveis |
| G — Score, health e próxima ação | Probabilidade manual | Motores determinísticos, explicáveis e testados; IA não participa desta fase |
| H — Dashboard comercial | Dashboard geral existente | Funil, conversão, pipeline ponderado, fontes, perdas, corretores e empreendimentos |
| I — Automações | Cobrança possui fluxo próprio | Motor CRM idempotente, prevenção de loop, condições, ações e log de execução |
| J — IA assistida | Não existe abstração de IA | Provider isolado, resumo e rascunhos revisáveis, limites, custo e validação; nenhuma mutação crítica autônoma |
| K — Polimento | Responsividade básica | Mobile comercial, busca global, acessibilidade, performance, observabilidade e E2E completo |

## Decisões de arquitetura

1. Evoluir `Opportunity` em vez de criar uma entidade paralela de lead ou cliente.
2. Manter `SalesActivity` como base de tarefas e follow-ups; acrescentar estado e metadados antes de considerar especializações.
3. Criar `SalesVisit` apenas porque a visita possui ciclo e resultado próprios, mantendo referência à oportunidade e à pessoa.
4. Modelar interesse imobiliário separadamente da unidade escolhida, pois o lead pode começar sem imóvel definido.
5. Tornar origem, tag e motivo de perda catálogos tenant-scoped; evitar strings livres para dados gerenciais.
6. Calcular score, health e próxima ação em serviços determinísticos com fatores retornados pela API.
7. Introduzir IA somente após dados, timeline, matching, scoring e automações estarem estáveis.
8. Toda nova entidade deve ter tenant, índices de acesso, RBAC, auditoria e testes de isolamento.

## Riscos encontrados

- A tela de funil carrega até 50 oportunidades e distribui os itens no cliente; pipelines maiores exigem paginação por etapa ou estratégia incremental.
- Não existe `stageEnteredAt`; hoje o tempo na etapa exigiria buscar o último histórico para cada oportunidade.
- `SalesStage` ainda não possui probabilidade padrão nem endpoints de edição/reordenação.
- `SalesActivity` usa datas para inferir conclusão e não possui status, prioridade, reminder ou resultado explícitos.
- A timeline do detalhe não combina atividades, reservas, propostas e venda em uma ordenação única.
- Origem e motivo de perda são textos livres, reduzindo a qualidade dos relatórios.
- Notificações internas existem, mas o processamento do outbox de e-mail ainda é acionado manualmente e não é um worker durável.
- Parte do legado financeiro de investimentos e preços ainda usa `Float`; os fluxos comerciais novos usam `Decimal(18,2)`.

## Ordem de entrega aprovada pela auditoria

1. B1: rastrear entrada na etapa e probabilidade padrão; enriquecer consultas e cards.
2. B2: drag and drop robusto, rollback visual e prevenção de submissão duplicada.
3. B3: CRUD/reordenação segura de pipelines e etapas e lista avançada.
4. C: atividades profissionais, página de tarefas e timeline unificada.
5. D–K: seguir a sequência definida no plano mestre, sempre com migrations pequenas e compatíveis.

## Critérios permanentes

- Nenhuma mutação confia em `organizationId` do cliente.
- Nenhuma etapa crítica depende apenas da interface.
- Nenhum histórico existente é apagado.
- Dinheiro comercial novo usa `Decimal`, nunca `Float` de JavaScript.
- Cada bloco significativo termina com build, testes, commit, push e verificação de produção.
- `PROGRESS.md` só é atualizado depois que a funcionalidade estiver realmente concluída.

---

# Atualização — Re-auditoria CRM-A01

Data da re-auditoria: 2026-09-06

Esta seção **não substitui** a auditoria de 2026-09-04 acima; ela registra o que mudou desde então e corrige o que ficou desatualizado. O histórico anterior é preservado integralmente.

## Base auditada nesta rodada

- Backend: `macielhgustavo/harpia-api`, branch `main`, commit `cfcca47` (`fix: add company scope to CRM visits`). Local sincronizado com `origin/main`.
- Frontend: `macielhgustavo/harpia-web`, branch `main`, commit `33fc566` (`feat: add CRM visit management`). A auditoria anterior parou em `a65ec3c`; existem cinco commits de CRM posteriores.
- Método: leitura direta do schema Prisma, das 21 migrations, dos services, controllers e DTOs do CRM, da cadeia comercial (propostas e vendas), da matriz de RBAC, dos eventos de auditoria, do módulo de notificações e de todas as telas de CRM do frontend. Nenhuma afirmação foi aceita a partir da documentação.
- Verificação executada: `npx jest` no backend — 56 suítes, 259 testes, todos passando.

## Riscos da auditoria anterior — reavaliação item a item

| # | Risco registrado em 2026-09-04 | Situação em 2026-09-06 | Evidência |
| --- | --- | --- | --- |
| 1 | Funil carrega até 50 oportunidades e distribui no cliente | AINDA VÁLIDO | `harpia-web/src/app/pages/crm/crm.component.ts:184` (`pageSize: 50`) e `stageItems()` filtrando em memória |
| 2 | Não existe `stageEnteredAt` | RESOLVIDO (com ressalva) | `prisma/schema.prisma:414`; migration `20260904020000_crm_stage_tracking` com backfill a partir do histórico. Ressalva: ver BUG-01 |
| 3a | `SalesStage` sem probabilidade padrão | RESOLVIDO | `prisma/schema.prisma:378` `defaultProbability Int @default(0)` com CHECK 0–100; herdada em `crm.service.ts:317` |
| 3b | `SalesStage` sem endpoints de edição/reordenação | AINDA VÁLIDO | `crm.controller.ts` expõe apenas `GET` e `POST /crm/pipelines` |
| 4 | `SalesActivity` sem status, prioridade, reminder ou resultado | RESOLVIDO | `prisma/schema.prisma:455-484`; enums `SalesActivityStatus` e `SalesActivityPriority`; migration `20260904030000_sales_activity_workflow` |
| 5 | Timeline do detalhe não combina as fontes | RESOLVIDO (com ressalva) | `crm.service.ts:548` agrega etapas, atividades, visitas, reservas, propostas e vendas. Ressalva: sem paginação (BUG-08) |
| 6 | Origem e motivo de perda são texto livre | AINDA VÁLIDO | `Opportunity.source` e `Opportunity.lostReason` são `String?`; nenhum modelo de catálogo existe no schema |
| 7 | Outbox de notificações acionado manualmente | AINDA VÁLIDO | `POST /notifications/process-outbox` exige `USERS_MANAGE`; o único worker recorrente é `collections-automation.service.ts:32` |
| 8 | Legado financeiro em `Float` | AINDA VÁLIDO | `UnitPrice.value`, `Investment.amount`, `Allocation.amount`, `Return.expectedAmount`, `Return.realizedAmount` |

A fase D (visitas), listada como pendente na auditoria anterior, foi parcialmente entregue: `SalesVisit` existe como entidade própria no backend e possui interface dedicada em `/crm/visits`.

## Estado real por fase

| Fase | Estado | Observação |
| --- | --- | --- |
| A — Re-auditoria | CONCLUÍDO | Esta seção |
| B — Pipeline e UX | PARCIAL | Drag and drop, tempo na etapa, probabilidade padrão e estados de risco entregues. Falta gestão de pipelines/etapas, ordenação na lista, paginação por etapa e cards mais densos |
| C — Timeline e produtividade | PARCIAL | Timeline unificada e ciclo de atividades entregues. Falta visão de concluídas em `/crm/tasks`, paginação da timeline e reminders efetivos |
| D — Visitas | PARCIAL | Backend e tela dedicada entregues. Falta seção de visitas no detalhe da oportunidade, filtro por empreendimento, reagendamento e follow-up pós-visita |
| E — Inteligência imobiliária | PENDENTE | Nenhum modelo de interesse ou matching no schema |
| F — Organização comercial | PENDENTE | Nenhum catálogo de origem, tag ou motivo de perda |
| G — Scoring | PENDENTE | Não existe motor de score ou health |
| H — Dashboard comercial | PENDENTE | Não existem endpoints de funil, conversão ou pipeline ponderado |
| I — Automações | PENDENTE | Nenhum motor de automação de CRM |
| J — IA | PENDENTE | Nenhuma abstração de provider |
| K — Polimento | PENDENTE | Sem E2E; nenhuma tela de CRM possui teste de componente |

## Bugs e inconsistências confirmados no código

- **BUG-01 (ALTA) — `stageEnteredAt` não é atualizado no ganho via proposta ou venda.** *(CORRIGIDO em 2026-09-06 por CRM-FIX-01 — ver seção no fim deste documento. O texto abaixo descreve o defeito como encontrado.)* `proposals.service.ts:627` e `sales.service.ts:921` gravam o `stageId` da etapa ganha, criam `OpportunityStageHistory` e auditam, mas não tocam em `stageEnteredAt`. Apenas `crm.service.ts:490` o faz. Consequência: uma oportunidade que entrou em Negociação no dia 1 e foi convertida em venda no dia 30 aparece como "29 dias na etapa" já em Ganho, e `isStalled()` pode marcar como estagnada uma oportunidade recém-ganha. O índice `Opportunity_organizationId_stageId_stageEnteredAt_idx` fica não confiável.
- **BUG-02 (MÉDIA) — truncamento silencioso no Kanban e na agenda.** O funil carrega 50 registros e calcula `stageTotal()` sobre eles; a agenda carrega 100 e filtra as visões no cliente; o seletor de oportunidades em `/crm/visits` carrega 100. Acima desses limites, os totais por etapa, os contadores das abas e a lista de oportunidades agendáveis ficam errados sem qualquer aviso ao usuário.
- **BUG-03 (MÉDIA) — `/crm/tasks` não tem visão de concluídas e as abas se sobrepõem.** `openOnly: true` é fixo na consulta, então nem a aba "Todas" mostra atividades concluídas. Em `matchesView`, uma atividade agendada para hoje mais cedo satisfaz simultaneamente `TODAY` e `OVERDUE`, duplicando a contagem dos badges.
- **BUG-04 (MÉDIA) — `openOnly` sobrescreve `status`.** *(CORRIGIDO em 2026-09-06 por CRM-FIX-02 — ver seção no fim deste documento. O texto abaixo descreve o defeito como encontrado.)* Em `CrmService.findActivities`, o spread de `openOnly` vem depois do de `status`; `?status=CONCLUIDA&openOnly=true` devolve pendentes e em andamento em vez de conjunto vazio.
- **BUG-05 (MÉDIA) — visitas desconectadas do detalhe da oportunidade.** `opportunity-detail.component.html` não possui seção de visitas; elas aparecem apenas como linhas da timeline. Não é possível agendar visita, registrar comparecimento ou ver as visitas da oportunidade a partir do detalhe.
- **BUG-06 (MÉDIA) — `lostReason` é destruído.** `crm.service.ts:487` grava `lostReason: null` ao mover para qualquer etapa não perdida, e os metadados de `OPPORTUNITY_LOST` não guardam o texto. O motivo da perda torna-se irrecuperável após reabertura, contrariando a diretriz de preservar histórico comercial.
- **BUG-07 (BAIXA) — `SalesVisit.companyId` é schema morto.** A coluna e a FK existem no banco (migration `20260905010000_sales_visits_company_scope`) e no schema, mas nenhum service, DTO ou include a escreve ou lê.
- **BUG-08 (BAIXA) — timeline e histórico sem limite.** `findOpportunityTimeline` dispara seis consultas sem `take` e ordena em memória; `findOpportunityHistory` também não limita resultados.
- **BUG-09 (BAIXA) — `result` livre em visita cancelada.** Em `visits.service.ts`, `outcome` é zerado fora de `REALIZADA`, mas `result` não é validado nem limpo.
- **BUG-10 (BAIXA) — `npm run test:e2e` quebrado.** O script aponta para `./test/jest-e2e.json` e o diretório `test/` não existe no repositório.

## Dívida técnica registrada nesta rodada

- `src/database/run-production-migrations.ts` contém recuperação hardcoded de uma migration específica (`20260904040000_sales_visits`). É contorno de um incidente de deploy que permanecerá no caminho de boot até ser removido conscientemente.
- Nenhuma das cinco telas de CRM possui teste de componente, embora o frontend tenha 80 arquivos `.spec.ts` cobrindo áreas menos críticas.
- Os 13 testes de CRM do backend não cobrem `stageEnteredAt` em movimentação, herança de `defaultProbability`, prioridade, `reminderAt`, `openOnly`, exclusão de atividade, ciclo completo de visita nem RBAC no nível de controller.
- `UnitPrice.value` é `Float` embora represente preço comercial de unidade.
- `reminderAt` é dado morto enquanto não houver worker de lembretes.

## Critérios permanentes reconfirmados

Nenhuma violação de tenancy, RBAC ou auditoria foi encontrada no CRM nesta rodada. Todos os endpoints de `CrmController` e `VisitsController` exigem `CRM_READ` por padrão e `CRM_WRITE` nas mutações; todas as consultas derivam `organizationId` da sessão; todas as mutações comerciais gravam `AuditLog` na mesma transação; locks `FOR UPDATE` tenant-scoped protegem oportunidade, atividade e visita.

## Ordem de entrega recomendada após esta re-auditoria

1. Corrigir BUG-01 (propagar `stageEnteredAt` nos caminhos de proposta e venda) com teste de regressão. É a única inconsistência que corrompe dado gerencial já em produção.
2. Corrigir BUG-04 e BUG-03 (contrato de filtros de atividade e visão de concluídas).
3. Endereçar BUG-02 com paginação por etapa ou contadores vindos do servidor.
4. Ligar visitas ao detalhe da oportunidade (BUG-05) antes de avançar para a fase E.

---

# CRM-FIX-01 — Resolução do BUG-01

Data: 2026-09-06

## Situação

**CORRIGIDO no código.** Os registros históricos gravados enquanto o defeito existia continuam pendentes de backfill autorizado (ver abaixo).

## Causa raiz

`Opportunity.stageId` tinha três escritores independentes, cada um reimplementando a mesma sequência de "mover etapa": `CrmService.moveOpportunity`, `ProposalsService.winOpportunity` e `SalesService.ensureOpportunityWon`. Quando a fase B1 acrescentou `stageEnteredAt`, o campo foi adicionado apenas ao primeiro deles. A duplicação era a causa; a ausência do carimbo nos outros dois era o sintoma.

Vale registrar que os caminhos defeituosos **gravavam `OpportunityStageHistory` corretamente** — apenas o campo desnormalizado ficava para trás. É por isso que o histórico serve como fonte confiável de reparo.

## Solução

Criado `src/crm/opportunity-stage.ts`, com `applyOpportunityStageChange(tx, change)` como **escritor único** de `Opportunity.stageId`. A função concentra, numa só operação:

- `UPDATE` de `stageId`, `stageEnteredAt` e `lostReason`;
- criação do registro em `OpportunityStageHistory`;
- construção dos eventos `OPPORTUNITY_STAGE_CHANGED` e, quando terminal, `OPPORTUNITY_WON` ou `OPPORTUNITY_LOST`.

Propriedades relevantes:

- Colunas extras do chamador (`additionalData`, como o `unitId` resolvido pela proposta ou pela venda) são espalhadas **antes** dos campos canônicos, então não há como sobrescrever `stageId` nem `stageEnteredAt`. Há teste cobrindo essa tentativa.
- Chamada com a etapa de destino igual à atual é no-op: retorna lista vazia e não escreve nada, preservando a idempotência que os três fluxos já praticavam.
- A função **não** abre transação nem adquire lock: o chamador continua responsável por isso, o que evita lock duplo e mantém o `FOR UPDATE` tenant-scoped onde já estava.
- A auditoria é **retornada**, não gravada. Cada chamador decide se registra imediatamente (`CrmService`, via `recordMany`) ou se acumula com os próprios eventos (`ProposalsService` e `SalesService`), preservando o lote único por transação e evitando eventos duplicados.

É um módulo de função pura sobre `Prisma.TransactionClient`, no mesmo padrão de `src/prisma/advisory-lock.ts`. Como não é um provider, `ProposalsService` e `SalesService` apenas importam a função: **nenhum módulo Nest novo foi acoplado e não há dependência circular** entre `CrmModule`, `ProposalsModule` e `SalesModule`.

## Dados históricos potencialmente afetados

### Janela de exposição

`stageEnteredAt` foi criado pela migration `20260904020000_crm_stage_tracking`, que fez backfill de todas as oportunidades existentes a partir do histórico. Portanto:

- oportunidades anteriores a 2026-09-04 ficaram corretas pelo backfill da migration;
- a divergência só pôde surgir **entre 2026-09-04 e 2026-09-06**, e somente em oportunidades ganhas via aceite de proposta ou conversão em venda;
- movimentações manuais nunca foram afetadas.

A janela é curta, mas o volume real só pode ser medido no banco. Não foi executada nenhuma consulta em produção.

### Como identificar os registros afetados (somente leitura)

```sql
SELECT
  o."id",
  o."organizationId",
  o."stageId",
  o."stageEnteredAt",
  h."changedAt" AS "expectedStageEnteredAt"
FROM "Opportunity" o
JOIN LATERAL (
  SELECT hh."changedAt", hh."toStageId"
  FROM "OpportunityStageHistory" hh
  WHERE hh."opportunityId" = o."id"
    AND hh."organizationId" = o."organizationId"
  ORDER BY hh."changedAt" DESC, hh."id" DESC
  LIMIT 1
) h ON TRUE
WHERE h."toStageId" = o."stageId"
  AND o."stageEnteredAt" IS DISTINCT FROM h."changedAt";
```

A condição `h."toStageId" = o."stageId"` é o que torna a consulta segura: só entram oportunidades cujo último evento de histórico corresponde à etapa atual. Se os dois discordarem, o registro tem outro problema e **não** deve ser tocado por este reparo.

### Como seria o backfill

```sql
UPDATE "Opportunity" AS o
SET "stageEnteredAt" = h."changedAt"
FROM (
  SELECT DISTINCT ON (hh."opportunityId")
    hh."opportunityId", hh."organizationId", hh."changedAt", hh."toStageId"
  FROM "OpportunityStageHistory" hh
  ORDER BY hh."opportunityId", hh."changedAt" DESC, hh."id" DESC
) AS h
WHERE h."opportunityId" = o."id"
  AND h."organizationId" = o."organizationId"
  AND h."toStageId" = o."stageId"
  AND o."stageEnteredAt" IS DISTINCT FROM h."changedAt";
```

É a mesma regra da migration `20260904020000`, restrita às linhas divergentes.

### Riscos e cuidados

- **Não é migration.** Uma migration rodaria sozinha no boot (`runProductionMigrations`), o que contraria a exigência de autorização explícita. Deve ser um script pontual, revisado e executado manualmente.
- `Opportunity.updatedAt` é `@updatedAt` do Prisma, aplicado pelo client e não por trigger. Um `UPDATE` em SQL puro **não** altera `updatedAt` — o que é desejável, já que o funil ordena por `updatedAt desc` e o reparo não deve reordenar a fila do time comercial. Um backfill via Prisma Client teria esse efeito colateral e por isso não é recomendado.
- A operação é idempotente: reexecutar não muda mais nada, porque a condição de divergência deixa de valer.
- Não há alteração de etapa, de histórico, de auditoria ou de valores comerciais — apenas o campo desnormalizado é realinhado à fonte de verdade.
- Recomenda-se rodar antes a consulta de identificação, guardar o resultado como evidência e, se desejado, aplicar por organização para um rollout gradual.

**O backfill não foi executado.** Depende de autorização explícita.

## Testes de regressão

Onze testes novos, distribuídos em quatro arquivos. Todos validam `stageEnteredAt` diretamente, não apenas `stageId`.

- `src/crm/opportunity-stage.spec.ts` (novo, 6 casos): carimbo do horário e histórico, no-op na mesma etapa, impossibilidade de `additionalData` sobrescrever os invariantes, motivo de perda apenas em etapa perdida, evento único em etapa não terminal, e propagação de tenant e metadados.
- `src/crm/crm.service.spec.ts`: movimentação para a mesma etapa não escreve nada.
- `src/proposals/proposals.service.spec.ts`: aceite carimba `stageEnteredAt` e grava o histórico correto; oportunidade já ganha não é recarimbada.
- `src/sales/sales.service.spec.ts`: conversão carimba `stageEnteredAt`; oportunidade já ganha só recebe `unitId`; o lock da oportunidade permanece parametrizado por `id` e `organizationId`.

Verificação de que os testes realmente detectam o defeito: com o carimbo removido do escritor único, **5 testes falham** em 4 suítes; com ele, todos passam.

Resultado final: `nest build` sem erros e `npx jest` com **57 suítes e 270 testes**, todos passando.

---

# CRM-FIX-02 — Resolução do BUG-04

Data: 2026-09-06

## Situação

**CORRIGIDO.** Nenhum dado precisou de reparo: o defeito afetava apenas o resultado de consultas, nunca o que era gravado.

## Causa raiz

`CrmService.findActivities` montava o `where` como um literal de objeto com spreads condicionais encadeados. `status` e `openOnly` escreviam a **mesma chave** `status`, e o spread de `openOnly` vinha depois:

```ts
...(query.status ? { status: query.status } : {}),
...(query.priority ? { priority: query.priority } : {}),
...(query.openOnly ? { status: { in: [PENDENTE, EM_ANDAMENTO] } } : {}),
```

Em JavaScript a última chave repetida vence, então `openOnly` apagava o `status` explícito. O comportamento dependia da **ordem textual das linhas**, não de uma decisão de domínio — mover a linha de `openOnly` para cima inverteria a precedência sem nenhum aviso do compilador. Era uma armadilha estrutural, não um descuido pontual.

## Contrato definido

`status` e `openOnly` são filtros **independentes, combinados com E lógico**. Pedir os dois é uma interseção de conjuntos:

| Requisição | Resultado |
| --- | --- |
| `status=CONCLUIDA` | atividades concluídas |
| `openOnly=true` | pendentes e em andamento |
| `status=PENDENTE&openOnly=true` | apenas pendentes |
| `status=EM_ANDAMENTO&openOnly=true` | apenas em andamento |
| `status=CONCLUIDA&openOnly=true` | conjunto vazio |
| `status=CANCELADA&openOnly=true` | conjunto vazio |
| nenhum dos dois | qualquer status |

Pedir um status fechado com `openOnly` é insatisfazível por definição e devolve página vazia com `total: 0`. Isso é preferível a ignorar um dos filtros: a resposta vazia é honesta e o cliente percebe que a combinação não faz sentido, enquanto a sobrescrita silenciosa devolvia dados que o chamador não pediu.

## Solução

Criado `src/crm/sales-activity-filters.ts` com duas funções e uma constante:

- `OPEN_SALES_ACTIVITY_STATUSES` — fonte única da definição de "atividade aberta", hoje `PENDENTE` e `EM_ANDAMENTO`. Acrescentar um status aberto no futuro é editar apenas essa constante.
- `buildSalesActivityStatusFilter(status, openOnly)` — resolve os dois num predicado só, por **interseção real de conjuntos** (`OPEN.filter((open) => open === status)`), não por uma cadeia de `if`. A interseção vazia vira `{ in: [] }`.
- `buildSalesActivityWhere(organizationId, query)` — monta o `where` inteiro, com o tenant sempre vindo da sessão validada.

`CrmService.findActivities` passou a delegar a construção do predicado e ficou responsável apenas por paginação e execução. A listagem e a contagem compartilham o mesmo objeto `where`, então a paginação não pode divergir do conjunto retornado — há teste cobrindo isso.

O contrato HTTP não mudou: o DTO segue aceitando exatamente os mesmos parâmetros. Só a semântica da combinação antes quebrada foi corrigida.

### Observação sobre `{ in: [] }`

A interseção vazia é traduzida para o predicado `status IN ()` do Prisma, que não casa com nenhum registro. Os testes validam o predicado gerado; essa semântica específica do Prisma é garantida por contrato da biblioteca e **não é exercitada contra um banco real**, porque o projeto não possui infraestrutura de teste de integração — lacuna já registrada como dívida técnica na re-auditoria.

## Compatibilidade com o frontend

Nenhuma chamada existente envia os dois filtros ao mesmo tempo, então nenhuma tela muda de comportamento:

- `/crm/tasks` (`crm-tasks.component.ts:87`) envia `openOnly: true` com `assignedUserId` e `priority`, nunca `status`.
- Detalhe da oportunidade (`opportunity-detail.component.ts:159` e `:193`) envia apenas `opportunityId` e `pageSize`.
- `/crm` não lista atividades.

Nenhum arquivo do frontend foi alterado. A aba de concluídas em `/crm/tasks` continua pendente e pertence ao CRM-FIX-03; a correção atual é o que torna essa aba implementável, porque agora é possível combinar `status` com os demais filtros sem ambiguidade.

## Testes de regressão

Vinte testes novos, todos validando o predicado gerado ou o resultado retornado, nunca apenas que a função foi chamada.

`src/crm/sales-activity-filters.spec.ts` (novo, 18 casos): a constante de status abertos; `status` isolado; `openOnly` isolado; interseção com `PENDENTE` e com `EM_ANDAMENTO`; interseção vazia com `CONCLUIDA` e com `CANCELADA`; ausência dos dois; `openOnly=false`; tenant aplicado por padrão; tentativa de injetar `organizationId` pela query, que é ignorada; faixa de datas completa e aberta combinada com o status; prioridade combinada; e preservação de todos os demais filtros.

`src/crm/crm.service.spec.ts` (2 casos): a composição chega ao Prisma com `where` idêntico em `findMany` e `count`, com `skip`/`take` corretos; e a agenda de abertas continua funcionando com `openOnly` sozinho.

Verificação de que os testes detectam o defeito: reintroduzindo a semântica antiga de sobrescrita no construtor, **8 testes falham** em 2 suítes; com a correção, todos passam.

Resultado final: `nest build` sem erros e `npx jest` com **58 suítes e 290 testes**, todos passando.
