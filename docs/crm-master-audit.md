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
- **BUG-02 (MÉDIA) — truncamento silencioso no Kanban e na agenda.** *(CORRIGIDO em 2026-09-06 por CRM-FIX-04 — ver seção no fim deste documento. O texto abaixo descreve o defeito como encontrado.)* O funil carrega 50 registros e calcula `stageTotal()` sobre eles; a agenda carrega 100 e filtra as visões no cliente; o seletor de oportunidades em `/crm/visits` carrega 100. Acima desses limites, os totais por etapa, os contadores das abas e a lista de oportunidades agendáveis ficam errados sem qualquer aviso ao usuário.
- **BUG-03 (MÉDIA) — `/crm/tasks` não tem visão de concluídas e as abas se sobrepõem.** *(CORRIGIDO em 2026-09-06 por CRM-FIX-03 — ver seção no fim deste documento. O texto abaixo descreve o defeito como encontrado.)* `openOnly: true` é fixo na consulta, então nem a aba "Todas" mostra atividades concluídas. Em `matchesView`, uma atividade agendada para hoje mais cedo satisfaz simultaneamente `TODAY` e `OVERDUE`, duplicando a contagem dos badges.
- **BUG-04 (MÉDIA) — `openOnly` sobrescreve `status`.** *(CORRIGIDO em 2026-09-06 por CRM-FIX-02 — ver seção no fim deste documento. O texto abaixo descreve o defeito como encontrado.)* Em `CrmService.findActivities`, o spread de `openOnly` vem depois do de `status`; `?status=CONCLUIDA&openOnly=true` devolve pendentes e em andamento em vez de conjunto vazio.
- **BUG-05 (MÉDIA) — visitas desconectadas do detalhe da oportunidade.** *(CORRIGIDO em 2026-09-07 por CRM-FIX-05 — ver seção no fim deste documento. O texto abaixo descreve o defeito como encontrado.)* `opportunity-detail.component.html` não possui seção de visitas; elas aparecem apenas como linhas da timeline. Não é possível agendar visita, registrar comparecimento ou ver as visitas da oportunidade a partir do detalhe.
- **BUG-06 (MÉDIA) — `lostReason` é destruído.** *(CORRIGIDO em 2026-09-15 por CRM-FIX-06 — ver seção no fim deste documento. O texto abaixo descreve o defeito como encontrado.)* `crm.service.ts:487` grava `lostReason: null` ao mover para qualquer etapa não perdida, e os metadados de `OPPORTUNITY_LOST` não guardam o texto. O motivo da perda torna-se irrecuperável após reabertura, contrariando a diretriz de preservar histórico comercial.
- **BUG-07 (BAIXA) — `SalesVisit.companyId` é schema morto.** *(CORRIGIDO em 2026-09-15 por CRM-FIX-07 — ver seção no fim deste documento. O texto abaixo descreve o defeito como encontrado.)* A coluna e a FK existem no banco (migration `20260905010000_sales_visits_company_scope`) e no schema, mas nenhum service, DTO ou include a escreve ou lê.
- **BUG-08 (BAIXA) — timeline e histórico sem limite.** `findOpportunityTimeline` dispara seis consultas sem `take` e ordena em memória; `findOpportunityHistory` também não limita resultados.
- **BUG-09 (BAIXA) — `result` livre em visita cancelada.** Em `visits.service.ts`, `outcome` é zerado fora de `REALIZADA`, mas `result` não é validado nem limpo.
- **BUG-10 (BAIXA) — `npm run test:e2e` quebrado.** *(CORRIGIDO em 2026-09-18 por CRM-052 — ver seção no fim deste documento. O texto seguinte preserva o defeito como encontrado.)* O script aponta para `./test/jest-e2e.json` e o diretório `test/` não existe no repositório.

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

---

# CRM-FIX-03 — Resolução do BUG-03

Data: 2026-09-06

## Situação

**CORRIGIDO.** Alteração exclusivamente no frontend (`harpia-web`); o backend não precisou de nenhuma mudança.

## Causa raiz

A agenda carregava **uma única consulta** de atividades abertas (`openOnly: true` fixo, `pageSize: 100`) e reclassificava tudo no cliente, em `matchesView`. Dois defeitos vinham daí:

1. **Visão de concluídas impossível.** Como `openOnly: true` era enviado sempre, nem a aba "Todas" conseguia mostrar uma atividade `CONCLUIDA`. A aba não existia porque a consulta a proibia.
2. **Abas sobrepostas.** `TODAY` usava fronteiras de dia (`date >= início do dia && date < início do dia seguinte`), mas `OVERDUE` usava `date < now`. As duas regras não eram do mesmo tipo: uma comparava **dia**, a outra comparava **instante**. Uma atividade de hoje às 09:00, vista às 15:00, satisfazia as duas ao mesmo tempo, aparecendo em Hoje e em Atrasadas e sendo contada duas vezes nos badges.

O erro conceitual foi misturar duas unidades de comparação para particionar o mesmo conjunto.

## Solução

Cada aba passou a ser **uma consulta própria ao servidor**, aproveitando o contrato componível entregue por CRM-FIX-02. Não há mais reclassificação no cliente.

| Aba | Filtros |
| --- | --- |
| Hoje | `openOnly=true`, `scheduledFrom=início do dia local`, `scheduledTo=último ms do dia local` |
| Atrasadas | `openOnly=true`, `scheduledTo=último ms antes do dia local` |
| Próximas | `openOnly=true`, `scheduledFrom=início do dia local seguinte` |
| Concluídas | `status=CONCLUIDA` |
| Todas as abertas | `openOnly=true` |

As três visões de abertas particionam a linha do tempo em `(-∞, hoje)`, `[hoje, amanhã)` e `[amanhã, +∞)`. Como o backend usa intervalos fechados (`gte`/`lte`) e `scheduledAt` é `TIMESTAMP(3)`, os limites usam o último milissegundo: não há sobreposição nem lacuna. Toda comparação passou a ser de **dia**, eliminando a mistura de unidades.

Decisões associadas:

- **Badges vêm do `pagination.total` da mesma consulta que produziu a lista.** Não há recontagem no cliente, então contador e lista não podem divergir.
- **Trocar de aba não dispara requisição.** As cinco visões são carregadas em paralelo por um `forkJoin`; a troca só alterna dados já carregados, o que elimina flicker. Recarregar acontece apenas em "Atualizar", ao mudar filtros e após concluir/iniciar uma atividade.
- **Guarda de sequência** (`loadSequence`, mesmo padrão de `crm.component.ts`) descarta respostas antigas que cheguem depois de um carregamento mais novo.
- **O selo "Atrasada" passou a usar a mesma regra da aba Atrasadas**, isto é, agendamento anterior ao dia atual. Antes ele comparava com `now` e marcava como atrasada uma atividade que estava listada em Hoje, contradizendo a própria aba.
- **`loadError` e `actionError` foram separados.** Falha de carregamento bloqueia a lista e oferece "Tentar novamente"; falha de ação vira apenas um aviso, sem destruir a lista já carregada.
- **A aba "Todas" foi mantida e renomeada para "Todas as abertas".** Ela é a única visão onde aparecem atividades abertas **sem** `scheduledAt`, já que o filtro de data do Prisma descarta `NULL`. O rótulo antigo prometia mais do que a consulta entregava.

## Limitações registradas, não corrigidas aqui

- **Concluídas herda a ordenação padrão do endpoint**, que ordena `completedAt` de forma **ascendente** — as mais antigas primeiro. Exibir as mais recentes exigiria um parâmetro de ordenação em `GET /crm/activities`, que não existe. Ordenar só a página carregada no cliente seria pior, porque ordenaria as 100 mais antigas e pareceria correto. Fica como item de backlog.
- **Atividades `CANCELADA` não aparecem em nenhuma visão de `/crm/tasks`.** Todas as abas de abertas usam `openOnly`, e Concluídas filtra `CONCLUIDA`. É lacuna conhecida e deliberada nesta tarefa.
- **A lista de cada visão continua limitada a 100 registros.** Isso é CRM-FIX-04. Para que o badge não passe a mentir agora que mostra o total real do servidor, a tela exibe um aviso explícito quando `total > registros exibidos`. O aviso torna o truncamento visível; eliminá-lo continua sendo o escopo do CRM-FIX-04.

## Política de fuso horário

O projeto não tinha política explícita. Fica definida: **o dia é o dia local do navegador**, não o dia UTC.

Os limites são calculados com `setHours(0, 0, 0, 0)` e `setDate(+1)` sobre a data local e só então serializados com `toISOString()` para a API. O usuário vê como "hoje" o mesmo dia do relógio dele, e o backend continua comparando instantes absolutos sem precisar conhecer o fuso do cliente. `setDate(+1)` foi escolhido em vez de somar 86.400.000 ms porque preserva a correção em dias de mudança de horário de verão. Nenhuma biblioteca de data foi introduzida.

## Testes

`src/app/pages/crm/crm-tasks.component.spec.ts` é **o primeiro teste de componente de uma tela de CRM**, começando a fechar a lacuna registrada na re-auditoria. São 28 casos, com relógio fixo em 15/09/2026 15:30 local via `spyOn(Date, 'now')` — nenhum depende da data da máquina.

Cobrem: os filtros exatos de cada uma das cinco abas; a exclusividade mútua verificada nos limites (último instante de ontem, início de hoje, hoje de manhã, último instante de hoje, início de amanhã), incluindo ausência de lacuna; atividade de hoje já passada permanecendo só em Hoje; ontem só em Atrasadas; amanhã só em Próximas; concluída fora das visões de abertas; lista e badge saindo da mesma consulta; troca de aba sem novas requisições; descarte de resposta obsoleta; preservação de prioridade e responsável em todas as visões; omissão de responsável vazio; empty state próprio de cada aba; loading pendente e resolvido; erro com retry; e falha de ação sem bloquear a lista.

Verificação de que os testes detectam o defeito: reintroduzindo as duas causas originais (`scheduledTo=now` em Atrasadas e `openOnly` fixo em Concluídas), **4 testes falham**, exatamente nos sintomas do BUG-03.

Resultado: suíte do frontend com **448 testes** passando (eram 420) e `ng build` sem erros. O backend permaneceu intocado, com 58 suítes e 290 testes passando.

---

# CRM-FIX-04 — Resolução do BUG-02

Data: 2026-09-06

## Situação

**CORRIGIDO** nos dois repositórios. Uma migration aditiva de índice foi criada; nenhum dado foi alterado.

## Causa raiz

O funil pedia uma página de 50 oportunidades do pipeline inteiro e montava as colunas no cliente. Disso decorriam três problemas encadeados:

1. A distribuição por etapa dependia de quais registros caíram naquela página. Uma etapa podia aparecer vazia só porque suas oportunidades não estavam entre as 50 mais recentes.
2. `stageTotal()` somava `estimatedValue` apenas dos registros carregados, então o valor financeiro da coluna era **plausível e errado** acima do limite, sem nenhum sinal ao usuário.
3. O contador da coluna era o tamanho do array local, não a contagem real.

Os mesmos limites arbitrários existiam na agenda (100) e no seletor de oportunidades das visitas (100), este último impedindo agendar visita para qualquer oportunidade fora das 100 mais recentes.

A raiz comum: **agregação e paginação estavam no cliente, sobre um recorte parcial**.

## Arquitetura escolhida

Endpoint novo `GET /crm/board`, mais reuso do endpoint de listagem já existente para as páginas seguintes.

- O board devolve todas as etapas do pipeline com `summary` (`total`, `loaded`, `hasMore`, `estimatedValue`, `weightedValue`), a primeira página de cards e a `pagination` no formato padrão do projeto.
- `stageLimit` controla os cards por etapa; `stageLimit=0` devolve **apenas agregados**, usado para atualizar os totais depois de mover um card sem recarregar lista alguma.
- "Carregar mais" de uma coluna usa `GET /crm/opportunities?stageId=...&page=N`, que já existia e já suportava tudo que era preciso. Nenhum endpoint novo foi inventado para isso.

Foi descartado um endpoint único devolvendo todas as oportunidades do pipeline: adiaria o problema em vez de resolvê-lo.

## Agregação

Uma única consulta agregada cobre todas as etapas, agrupada por `(stageId, probability)`. Agrupar também por probabilidade é o que permite calcular o valor ponderado **sem SQL bruto**: `probability` é inteiro de 0 a 100, então os buckets são poucos e limitados, e a soma ponderada é feita com `Prisma.Decimal` sobre eles.

Isso preserva um ganho do CRM-FIX-02: existe **uma só implementação dos filtros**. `buildOpportunityWhere` alimenta a listagem, as páginas de cada coluna e a agregação. SQL bruto teria exigido uma segunda representação do mesmo predicado.

`weightedValue` = `Σ (soma do bucket × probabilidade ÷ 100)`, com fallback para a `defaultProbability` da etapa quando a oportunidade não tem probabilidade — o mesmo critério que a interface já usava para exibir.

**Dinheiro nunca passa por `Number`.** Somas em `Prisma.Decimal`, serialização como string decimal de duas casas, e o frontend trata o valor como string opaca até a formatação.

## Drag and drop

O movimento passou a ser otimista com rollback real:

1. Um snapshot das colunas é tirado antes.
2. O card é removido da origem e inserido no topo do destino, com `total` e `loaded` ajustados em uma unidade.
3. Em sucesso, os agregados monetários são relidos com `stageLimit=0` — de propósito, em vez de recalculados no cliente, porque são decimais e não devem passar por float.
4. Em erro, o snapshot é restaurado por inteiro, colunas e summaries.

Nenhuma lista é recarregada no caminho feliz.

## Outros truncamentos

Varredura feita no CRM por `pageSize`, `take` e `slice`:

| Ponto | Antes | Agora |
| --- | --- | --- |
| Funil (`/crm`) | 50 no pipeline inteiro, distribuído no cliente | 20 por etapa, com `Carregar mais` e agregados do servidor |
| Agenda (`/crm/tasks`) | 100 por visão | 20 por visão, com `Carregar mais` |
| Seletor de oportunidade em `/crm/visits` | 100 fixos | busca no servidor com debounce de 300 ms |
| Lista de visitas | 50 por página | inalterado: já tinha paginação real |
| Atividades no detalhe da oportunidade | 100 | inalterado: limite por oportunidade, não por tenant |
| Reservas e propostas no detalhe | 100 cada | inalterado: limite por oportunidade; fora do módulo CRM |
| Timeline da oportunidade | sem limite | inalterado: BUG-08, ainda pendente |

Os `slice` encontrados em `opportunity-form-modal.component.ts` são formatação de data, não truncamento de lista.

## Índice

`20260906010000_crm_board_stage_index` cria `Opportunity_organizationId_stageId_updatedAt_idx`. Justificativa: cada coluna pagina com `WHERE organizationId AND pipelineId AND stageId ORDER BY updatedAt DESC LIMIT n`, e os índices existentes cobriam `createdAt` e `stageEnteredAt`, não a ordenação usada. É `CREATE INDEX IF NOT EXISTS`: aditivo, idempotente, não derruba nada e não reescreve dados.

## Determinismo da paginação

A ordenação de oportunidade já tinha `id` como desempate. A de atividades não tinha, e passou a ter. Sem isso, empates em `completedAt`/`scheduledAt`/`createdAt` poderiam fazer o `Carregar mais` pular ou repetir um registro.

## Testes

**Backend** — `src/crm/crm-board.service.spec.ts`, 15 casos: etapa que cabe numa página; etapa com mais registros que a página; soma financeira sobre todos os registros e não sobre a página; ponderação por bucket sem ponto flutuante; fallback para a probabilidade da etapa; soma ausente tratada como zero; etapa vazia; consolidação do pipeline; mesmo predicado na agregação e em cada página; tenant nunca vindo do cliente; pipeline de outro tenant recusado; ordenação e limite por etapa; uma página por etapa e uma só agregação; e `stageLimit=0` sem nenhuma consulta de linhas.

**Frontend** — `crm.component.spec.ts` (14 casos): contagem e valores do servidor; `stageLimit` enviado; quantos faltam carregar; coluna completa sem botão; `Carregar mais` afetando só a própria coluna; sem duplicar registros entre páginas; total do servidor preservado; DnD movendo card e atualizando summaries; DnD relendo apenas agregados; rollback restaurando colunas e summaries; filtros no board e no `Carregar mais`; troca para a lista com paginação de servidor.

`crm-visits.component.spec.ts` (7 casos): página inicial limitada; overflow informado; busca no servidor após o debounce; rajada de teclas gerando uma requisição só; oportunidade além das antigas 100 sendo encontrada; termo repetido não reconsultando; resultado vazio.

`crm-tasks.component.spec.ts` ganhou 3 casos de paginação: aviso e botão com o restante, página seguinte sem duplicar registros, e nenhuma requisição quando não há mais páginas.

Resultado: backend com **59 suítes e 304 testes**, frontend com **472 testes**, ambos os builds limpos.

## Limitações que permanecem

- Timeline e histórico da oportunidade seguem sem paginação (BUG-08).
- Atividades, reservas e propostas no detalhe da oportunidade seguem em 100 por bloco. São limites por oportunidade, não por tenant, e reservas/propostas ficam fora do módulo CRM.
- A ordenação de Concluídas em `/crm/tasks` continua herdando `completedAt` ascendente, como registrado no CRM-FIX-03.
- O `Carregar mais` do funil não tem contrapartida de "carregar menos": recolher uma coluna exige recarregar o board.

---

# CRM-FIX-05 — Resolução do BUG-05

Data: 2026-09-07

## Situação

**CORRIGIDO**, somente no frontend. O backend não foi alterado: `GET|POST /crm/visits` e `PATCH /crm/visits/:id` já cobriam todo o ciclo pedido.

## A lacuna

`SalesVisit` existia como entidade completa desde 2026-09-04 e a tela `/crm/visits` já agendava, registrava comparecimento, ausência e cancelamento. O detalhe da oportunidade, porém, não tinha nenhuma seção de visitas: elas apareciam apenas como linhas da timeline, sem estado operacional e sem ação.

Na prática o corretor abria a oportunidade para decidir o próximo passo, via que houve uma visita, e precisava sair para `/crm/visits`, encontrar aquela visita no meio da agenda do tenant e agir lá. O ciclo de visitas do lead não era gerenciável de dentro do lead.

## Verificação do contrato antes de escrever código

Cada parte do ciclo foi conferida contra o backend atual antes de decidir se havia mudança a fazer:

| Necessidade | Contrato existente | Mudança no backend |
| --- | --- | --- |
| Listar visitas de uma oportunidade | `GET /crm/visits?opportunityId=` | nenhuma |
| Agendar com contexto | `POST /crm/visits` deriva pessoa e tenant da oportunidade | nenhuma |
| Visita sem unidade | `resolveLocation` aceita só `developmentId` | nenhuma |
| Visita sem empreendimento | `resolveLocation` aceita ambos nulos e valida o par | nenhuma |
| Reagendar | `PATCH` aceita `scheduledAt` e `durationMinutes` | nenhuma |
| Realizar com resultado | `PATCH` com `status=REALIZADA` e `outcome` | nenhuma |
| Não comparecimento | `PATCH` com `status=NAO_COMPARECEU` | nenhuma |
| Cancelar com motivo | `PATCH` exige `cancellationReason` | nenhuma |
| Timeline | `GET /crm/opportunities/:id/timeline` já agrega visitas | nenhuma |

A conclusão é que o BUG-05 era exclusivamente uma lacuna de interface. Nenhuma migration, nenhum DTO e nenhuma regra de domínio foram tocados.

## Arquitetura escolhida

Componente próprio `VisitsSectionComponent` (`src/app/pages/crm/visits-section.component.ts`), no mesmo padrão de `ReservationsSectionComponent` e `ProposalsSectionComponent`: recebe o contexto da oportunidade por `@Input`, carrega sozinho e avisa o pai por um `@Output`.

A alternativa — carregar as visitas no `forkJoin` do detalhe — foi descartada de propósito. Naquele `forkJoin`, uma falha em qualquer fonte derruba a página inteira. A seção precisa de loading, erro, retry e empty state próprios: uma falha ao listar visitas não pode inutilizar o resumo comercial, a timeline nem as atividades.

## Ordenação

O endpoint ordena por `scheduledAt` ascendente. A seção reordena os registros já carregados em dois blocos:

- **Próximas visitas** — status `AGENDADA`, mais cedo primeiro. É o bloco operacional, o único com ações.
- **Histórico** — todo o resto (`REALIZADA`, `CANCELADA`, `NAO_COMPARECEU`), mais recente primeiro.

Reordenar no cliente é aceitável aqui e não repete o erro do BUG-02: o recorte é *por oportunidade*, não por tenant, e a página pedida é a máxima que o endpoint aceita (100). Quando `total` excede o que veio, a seção informa quantas visitas não está mostrando, em vez de fingir completude. Nenhum parâmetro de ordenação foi inventado no backend.

## Estados

Os quatro status têm rótulo em texto, ícone próprio e cor. **A cor é sempre redundante**: `Agendada`, `Realizada`, `Cancelada` e `Não compareceu` são legíveis sem ela.

## Oportunidade sem unidade e sem empreendimento

- Sem unidade: o formulário pré-preenche o empreendimento e deixa a unidade em "Visita ao empreendimento". `unitId` não é enviado.
- Sem empreendimento: o seletor fica aberto para escolha, e trocar de empreendimento **limpa a unidade selecionada**, porque uma unidade pertence a exatamente um empreendimento e o par inconsistente seria recusado pelo backend. A validação continua sendo a de `resolveLocation`; não há regra paralela no cliente.

## Reagendamento

Reagendar é `PATCH` na mesma visita. Ela conserva id, tenant, oportunidade, `createdByUser` e a trilha de auditoria; `SALES_VISIT_UPDATED` registra os campos alterados. **Não** se cancela e recria.

O formulário de reagendamento não expõe empreendimento e unidade porque o `UpdateSalesVisitDto` não os aceita — mudar o local de uma visita já marcada exige alteração de contrato e ficou fora desta tarefa. Está registrado como limitação.

## Conclusão, ausência e cancelamento

- **Realizada**: diálogo com `outcome` estruturado e observação livre. Os cinco valores oferecidos são os do enum real (`INTERESSE_ALTO`, `INTERESSE_MEDIO`, `INTERESSE_BAIXO`, `SEM_INTERESSE`, `REAGENDAR`), não a nomenclatura sugerida no enunciado da tarefa.
- **Não compareceu**: envia apenas `status`. `scheduledAt` permanece o instante que foi perdido; o marco temporal é gravado pelo backend.
- **Cancelar**: motivo obrigatório na UI, porque é obrigatório no domínio. A visita não é apagada e continua no histórico com o motivo visível.

## Timeline

A seção e a timeline não competem. Depois de qualquer mutação a seção recarrega a própria lista e emite `changed`; o detalhe refaz `GET /crm/opportunities/:id/timeline`. **Nenhum evento é fabricado no cliente** — o backend segue sendo a fonte de verdade do que aconteceu, como exige a ADR-008.

## Permissões

`CRM_READ` esconde a seção inteira e impede a consulta; `CRM_WRITE` esconde todas as ações. Os métodos de mutação também recusam execução direta sem `CRM_WRITE`, de modo que a ausência do botão não é a única barreira no cliente. Isso continua sendo espelho de UX: o guard global do `VisitsController` permanece a autoridade.

Uma defesa a mais foi adicionada na leitura: a seção descarta qualquer visita cujo `opportunityId` não seja o da oportunidade aberta. O endpoint já filtra por tenant e por oportunidade; o filtro extra garante que a seção nunca exiba uma visita de outro lead mesmo diante de uma resposta inesperada.

## Ações rápidas

`Agendar visita` passou a existir no cabeçalho do detalhe, ao lado de `Mover etapa`, `Editar` e `Excluir`, abrindo o formulário da seção sem navegação intermediária. As demais ações da lista do `CRM_UX.md` já existiam: registrar contato e criar tarefa no modal de atividade, reservar unidade e criar proposta nas seções embutidas, marcar ganho e marcar perda no modal de movimentação.

## Testes

`src/app/pages/crm/opportunity-detail.component.spec.ts` é o **primeiro teste de componente do detalhe da oportunidade**, fechando outra parte da lacuna registrada na re-auditoria. São 29 casos, com mocks explícitos de todos os serviços, inclusive os das seções filhas.

Cobrem: presença da seção; consulta restrita ao `opportunityId` correto; data, empreendimento, unidade, responsável e status renderizados; resultado de visita realizada; ordenação de próximas e histórico; visita de outra oportunidade nunca exibida; empty state com CTA; loading próprio sem bloquear a página; erro próprio preservando resumo e timeline; retry sem recarregar o detalhe; ação rápida do cabeçalho; pré-preenchimento a partir da oportunidade; criação vinculada; recusa de submissão sem data; oportunidade sem `unitId`; escolha de empreendimento quando a oportunidade não tem; limpeza da unidade ao trocar de empreendimento; reagendamento sem alterar status; pré-preenchimento do reagendamento; conclusão com `outcome`; enum real oferecido; não comparecimento preservando o horário; cancelamento com motivo; recusa de cancelamento sem motivo; recarga da seção e da timeline após ação; erro de ação sem destruir a página; e ausência de `CRM_WRITE` e de `CRM_READ`.

Resultado: frontend com **501 testes** passando (eram 472) e `ng build` limpo. O backend permaneceu intocado, com 59 suítes e 304 testes.

## Limitações que permanecem

- **O reagendamento não muda empreendimento nem unidade.** `UpdateSalesVisitDto` não aceita esses campos; alterar o local de uma visita já marcada exigiria mudança de contrato no backend.
- **O backend não tem máquina de estados de visita.** `PATCH` aceita qualquer transição, inclusive de `CANCELADA` de volta para `REALIZADA`. A interface só oferece ações sobre visitas `AGENDADA`, mas isso é convenção de UI, não invariante de domínio.
- **`GET /crm/visits` não aceita ordenação nem filtro por empreendimento** (CRM-012), e não existe `GET /crm/visits/:id`.
- **A seção carrega uma página de 100 visitas por oportunidade.** O excedente é informado, não paginado — mesmo tratamento dado a atividades, reservas e propostas no detalhe.
- Ao término do CRM-FIX-05, BUG-08 (paginação da timeline), BUG-06 (`lostReason`), BUG-07 (`SalesVisit.companyId`) e BUG-09 (`result` livre em visita cancelada) seguiam abertos: estavam explicitamente fora do escopo daquela tarefa. O BUG-06 foi corrigido depois, no CRM-FIX-06 abaixo.

---

# CRM-FIX-06 — Resolução do BUG-06

Data: 2026-09-15

## Situação

**CORRIGIDO no código para novas perdas.** A migration é aditiva e não faz backfill. Motivos antigos que já foram apagados continuam sujeitos à classificação de recuperabilidade abaixo.

## Causa raiz

O único lugar que armazenava o texto era `Opportunity.lostReason`. Esse campo tem semântica de estado atual e o escritor de etapa corretamente o limpava ao sair de uma etapa perdida. `OpportunityStageHistory` preservava que a perda aconteceu, mas não o motivo; os eventos antigos de `OPPORTUNITY_LOST` também continham apenas as etapas de origem e destino. Estado atual e fato histórico estavam, portanto, indevidamente representados pela mesma coluna.

## Modelagem escolhida

A migration `20260907010000_opportunity_stage_history_lost_reason` adiciona `OpportunityStageHistory.lostReason String?`. A linha de histórico de cada entrada em etapa perdida passa a guardar o motivo normalizado daquele evento. O campo é nulo na criação e em qualquer transição não perdida.

Essa é a fonte comercial de verdade: relatórios de perdas devem consultar o histórico unido a `SalesStage.isLost`, e não inferir perdas passadas a partir do estado atual. `AuditLog` recebe uma cópia sanitizada para rastreabilidade, mas não é usado como banco analítico.

`Opportunity.lostReason` permanece com sua semântica anterior e coerente: motivo da perda **atual**. Ele recebe o valor ao perder e é limpo ao reabrir ou ganhar. Limpar o estado atual não altera a linha histórica.

## Writer, validação e auditoria

Toda a regra fica em `applyOpportunityStageChange`, o escritor único introduzido no CRM-FIX-01:

- uma entrada em etapa perdida exige motivo não vazio;
- o texto recebe `trim` e limite de 500 caracteres;
- o DTO rejeita payload HTTP maior que 500 e o writer também limita qualquer chamador interno;
- `additionalData` e `auditMetadata` são aplicados antes dos campos canônicos e não conseguem falsificar `stageId`, `stageEnteredAt`, `lostReason`, `fromStageId` ou `toStageId`;
- a mesma transação atualiza `Opportunity`, cria `OpportunityStageHistory` e devolve `OPPORTUNITY_STAGE_CHANGED` mais `OPPORTUNITY_LOST`;
- os dois eventos de perda carregam `fromStageId`, `toStageId` e `lostReason`; `AuditService` aplica a sanitização geral antes de gravá-los;
- ganho e mudança não terminal não recebem motivo histórico nem metadado de perda;
- no-op na mesma etapa continua sem atualização, histórico ou auditoria.

Os caminhos automáticos de proposta e venda continuam chamando o mesmo writer. Eles só apontam para etapa ganha e gravam `lostReason = null` no evento novo, sem tocar em nenhuma perda histórica anterior. Locks `FOR UPDATE`, tenancy, idempotência, `stageEnteredAt` e lote transacional de auditoria não mudaram.

## Leitura e interface

`GET /crm/opportunities/:id/history` devolve o novo campo naturalmente pelo Prisma. A timeline inclui o motivo na descrição e usa o título `Oportunidade marcada como perdida`. O detalhe Angular exibe o motivo tanto no histórico de etapas quanto na timeline. Depois de reabertura ou ganho, o resumo deixa de mostrar motivo atual, mas as perdas anteriores permanecem visíveis; duas perdas mostram dois motivos.

## Migration

```sql
ALTER TABLE "OpportunityStageHistory"
ADD COLUMN IF NOT EXISTS "lostReason" TEXT;
```

Ela é pequena, nullable, idempotente e não destrutiva. Não remove nem reescreve linhas e não executa backfill no boot.

## Dados históricos anteriores à correção

### Recuperável com alta confiança

Oportunidades que **ainda estão** numa etapa perdida, mantêm `Opportunity.lostReason` não vazio e cujo último evento de histórico aponta para a mesma etapa. Nesse caso o estado atual e o último evento representam inequivocamente a mesma perda.

Consulta somente leitura para revisar candidatos:

```sql
SELECT
  o."organizationId",
  o."id" AS "opportunityId",
  h."id" AS "historyId",
  h."changedAt",
  o."lostReason"
FROM "Opportunity" o
JOIN "SalesStage" s
  ON s."id" = o."stageId"
 AND s."organizationId" = o."organizationId"
 AND s."isLost" = TRUE
JOIN LATERAL (
  SELECT hh."id", hh."toStageId", hh."changedAt", hh."lostReason"
  FROM "OpportunityStageHistory" hh
  WHERE hh."opportunityId" = o."id"
    AND hh."organizationId" = o."organizationId"
  ORDER BY hh."changedAt" DESC, hh."id" DESC
  LIMIT 1
) h ON h."toStageId" = o."stageId"
WHERE NULLIF(BTRIM(o."lostReason"), '') IS NOT NULL
  AND h."lostReason" IS NULL;
```

Depois de guardar e revisar o resultado, um reparo manual possível é:

```sql
WITH candidates AS (
  SELECT
    h."id" AS "historyId",
    LEFT(BTRIM(o."lostReason"), 500) AS "lostReason"
  FROM "Opportunity" o
  JOIN "SalesStage" s
    ON s."id" = o."stageId"
   AND s."organizationId" = o."organizationId"
   AND s."isLost" = TRUE
  JOIN LATERAL (
    SELECT hh."id", hh."toStageId", hh."changedAt", hh."lostReason"
    FROM "OpportunityStageHistory" hh
    WHERE hh."opportunityId" = o."id"
      AND hh."organizationId" = o."organizationId"
    ORDER BY hh."changedAt" DESC, hh."id" DESC
    LIMIT 1
  ) h ON h."toStageId" = o."stageId"
  WHERE NULLIF(BTRIM(o."lostReason"), '') IS NOT NULL
    AND h."lostReason" IS NULL
)
UPDATE "OpportunityStageHistory" history
SET "lostReason" = candidates."lostReason"
FROM candidates
WHERE history."id" = candidates."historyId"
  AND history."lostReason" IS NULL
RETURNING history."organizationId", history."opportunityId", history."id",
          history."changedAt", history."lostReason";
```

Esse comando **não foi executado**. Não é migration nem deve entrar no deploy automático; exige autorização, revisão do `SELECT` e evidência guardada.

### Recuperável parcialmente

- Um `AuditLog` excepcional que já contenha `metadata.lostReason` prova o texto e o evento de perda, mas a associação à linha exata de histórico precisa ser revisada por oportunidade, etapas e proximidade temporal; os eventos gravados pelo código antigo normalmente não contêm esse campo.
- Um `Opportunity.lostReason` preenchido com histórico ausente ou cujo último evento não corresponde à etapa atual prova que há informação remanescente, mas não permite atribuí-la automaticamente a uma perda específica.

Consulta somente leitura para localizar a primeira categoria:

```sql
SELECT "organizationId", "entityId" AS "opportunityId", "createdAt",
       metadata ->> 'fromStageId' AS "fromStageId",
       metadata ->> 'toStageId' AS "toStageId",
       metadata ->> 'lostReason' AS "lostReason"
FROM "AuditLog"
WHERE action = 'OPPORTUNITY_LOST'
  AND NULLIF(BTRIM(metadata ->> 'lostReason'), '') IS NOT NULL
ORDER BY "organizationId", "entityId", "createdAt";
```

### Irrecuperável

Perdas anteriores que foram reabertas ou posteriormente ganhas, tiveram `Opportunity.lostReason` limpo e não possuem outra fonte inequívoca com o texto. O histórico antigo e o `AuditLog` antigo provam que houve perda, mas não guardam o motivo. Nenhum valor deve ser inferido ou inventado.

## Testes e verificação

Há cobertura para motivo obrigatório; persistência no evento; reabertura; semântica do estado atual; múltiplas perdas; ganho posterior; auditoria; transições sem motivo indevido; no-op; tenancy; proteção contra sobrescrita por dados extras e metadados; trim e limite; proposta e venda; contrato da timeline; e exibição do detalhe com loading/error preservados.

O resultado final das suítes e builds fica registrado em `PROGRESS.md` após a validação completa.

---

# CRM-FIX-07 — Resolução do BUG-07

Data: 2026-09-15

## Situação

**CORRIGIDO no código.** O texto original do BUG-07 permanece preservado na re-auditoria acima. A correção remove somente a relação morta; nenhuma linha de visita, evento de timeline ou registro de auditoria é apagado.

## Origem e causa raiz

O commit `e9d9473` criou `SalesVisit` e incluiu `companyId` apenas no schema Prisma. A migration original `20260904040000_sales_visits` não criou a coluna, e DTOs, service, includes, filtros, seed, relatórios, SQL, auditoria e frontend nunca passaram a ler ou escrever esse campo. O commit seguinte, `cfcca47`, criou `20260905010000_sales_visits_company_scope` apenas para reconciliar essa divergência entre schema e banco; não acrescentou nenhuma regra de negócio ou consumidor.

Assim, `SalesVisit.companyId` não representava escopo de tenant — esse papel sempre foi de `organizationId` — nem um snapshot histórico. Era uma FK opcional permanentemente nula nos fluxos da aplicação.

## Decisão de modelagem

A relação foi removida. `Development` continua sendo a autoridade da empresa/SPE conforme a ADR-003:

```text
SalesVisit.developmentId
→ Development.companyId
→ Company
```

Quando existe `unitId`, `VisitsService.resolveLocation` valida a unidade dentro do tenant, deriva seu `developmentId` e rejeita um par divergente. Portanto, a mesma cadeia cobre visita com unidade sem duplicar empresa. Uma visita sem empreendimento pode existir e, coerentemente, não possui empresa inferível.

Manter ambas as FKs permitiria representar, por exemplo, uma visita na unidade de um empreendimento da SPE A com `companyId` da SPE B. Como nenhum writer sincronizava os campos, formalizar a coluna exigiria inventar uma segunda fonte sem requisito funcional.

## Migration

`20260915010000_remove_sales_visit_company_relation`:

1. verifica se existe algum `SalesVisit.companyId` não nulo e aborta com mensagem explícita se encontrar;
2. remove `SalesVisit_companyId_fkey` com `IF EXISTS`;
3. remove a coluna com `IF EXISTS`.

Não havia índice de `SalesVisit` envolvendo `companyId`, logo nenhum índice precisava ser removido. A migration não atualiza, recria nem exclui visitas e não executa backfill. O guard transforma qualquer dado inesperado em bloqueio visível em vez de perda silenciosa.

## Análise dos dados existentes

Não há `.env` funcional nem `DATABASE_URL` no processo desta workspace; existe apenas `.env.example` com placeholder. Portanto, não havia banco local/de teste inequivocamente configurado para consultar. Nenhuma conexão de produção foi feita e a migration não foi executada nesta tarefa.

Antes do deploy, a consulta somente leitura abaixo deve ser executada no ambiente alvo e seu resultado guardado:

```sql
SELECT
  v."organizationId",
  v."id" AS "visitId",
  v."companyId" AS "visitCompanyId",
  v."developmentId",
  d."companyId" AS "developmentCompanyId",
  v."unitId",
  u."developmentId" AS "unitDevelopmentId",
  ud."companyId" AS "unitDevelopmentCompanyId"
FROM "SalesVisit" v
LEFT JOIN "Development" d
  ON d."id" = v."developmentId"
 AND d."organizationId" = v."organizationId"
LEFT JOIN "Unit" u
  ON u."id" = v."unitId"
 AND u."organizationId" = v."organizationId"
LEFT JOIN "Development" ud
  ON ud."id" = u."developmentId"
 AND ud."organizationId" = v."organizationId"
WHERE v."companyId" IS NOT NULL
ORDER BY v."organizationId", v."id";
```

Interpretação:

- resultado vazio: cenário esperado pelo código; a migration pode remover a coluna sem perder valor;
- valor igual a `developmentCompanyId`/`unitDevelopmentCompanyId`: dado redundante, recuperável pela relação autoritativa mesmo após a remoção;
- valor em visita sem empreendimento ou divergente das relações derivadas: dado de origem externa e sem semântica definida no produto. Não deve ser descartado nem corrigido automaticamente; o guard interrompe a migration para análise e autorização manual.

Não foi criado backfill porque o campo removido não alimenta nenhum domínio. Também não se copia o valor para `Development`: isso inverteria a autoridade da relação e poderia alterar outras visitas, oportunidades e fluxos financeiros.

## Compatibilidade e testes

Criação, listagem, edição/reagendamento, visita realizada, ausência, cancelamento, timeline, auditoria, tenancy, empreendimento opcional e unidade opcional continuam usando os mesmos contratos. Os testes de `VisitsService` passaram a cobrir explicitamente oportunidades com e sem empreendimento, visitas com e sem unidade, derivação do empreendimento pela unidade, isolamento por tenant, escrita e leitura sem predicado/include de empresa, criação auditada e edição auditada. A timeline ganhou uma visita real no teste de agregação tenant-scoped.

O frontend já não possuía `companyId` em `SalesVisit`, filtros ou payloads. Nenhum arquivo do `harpia-web` precisou mudar.

# CRM-FIX-08 — Resolução do BUG-08

**2026-09-18 — CORRIGIDO no código.** O texto original do BUG-08, na re-auditoria acima, foi preservado como registro do defeito encontrado.

## Diagnóstico e escolha

`GET /crm/opportunities/:id/history` carregava todas as linhas de `OpportunityStageHistory`; a timeline fazia seis `findMany` sem `take` e ordenava todos os registros em memória. A cardinalidade de uma única oportunidade, portanto, determinava consumo de memória e tamanho da resposta. As seis fontes originais foram mantidas: histórico de etapas, atividades, visitas, reservas, propostas e vendas. Seus timestamps efetivos continuam, respectivamente, `changedAt`, `completedAt ?? createdAt`, `completedAt ?? cancelledAt ?? scheduledAt`, `convertedAt ?? cancelledAt ?? createdAt`, `convertedToSaleAt ?? acceptedAt ?? rejectedAt ?? sentAt ?? createdAt` e `saleDate`. O motivo de perda de CRM-FIX-06 continua vindo da linha histórica.

O histórico usa offset convencional (`page`, `pageSize`, padrão 1/20, máximo 100) e resposta `{ data, pagination: { page, pageSize, total, totalPages } }`, com `changedAt DESC, id DESC`. A timeline usa cursor opaco por `(occurredAt, id)` (`limit` padrão 20, máximo 100) e resposta `{ data, nextCursor }`. Ordena por `occurredAt DESC, id ASC`, com prefixos por fonte no ID, preservando ordem total mesmo quando os timestamps empatam. A página seguinte consulta apenas chaves estritamente posteriores na ordem (`occurredAt` menor ou, no empate, `id` maior). O cursor contém versão e oportunidade e é validado; o tenant continua vindo exclusivamente da sessão, sob `CRM_READ`.

Um `UNION ALL` parametrizado seleciona somente IDs e timestamps nas seis tabelas, aplica o filtro de tenant/oportunidade em cada braço, a fronteira do cursor e um único `LIMIT limit + 1` global. Assim, nenhuma fonte é truncada antes da ordenação global. Os registros selecionados são hidratados em no máximo seis consultas paralelas, sem N+1 e sem transportar todo o histórico à aplicação. Uma inserção nova acima do cursor não desloca a página seguinte. O frontend carrega apenas a primeira página, anexa páginas anteriores sem duplicar IDs, preserva os itens já exibidos diante de erro e permite retry. Ao atualizar ações comerciais, mescla a primeira página nova por ID e mantém a fronteira mais antiga para continuar a paginação.

## Índices, migration e limites

Todas as seis fontes já possuem índice com `organizationId` e `opportunityId` (a venda tem o par direto; as demais têm também o timestamp base). Os timestamps efetivos das fontes mutáveis são expressões `COALESCE`, portanto não há um único índice B-tree existente capaz de entregar toda a ordenação global. O banco filtra cada fonte pela oportunidade, ordena apenas as chaves correspondentes e entrega uma página limitada; não foi criada migration sem medição de plano ou volume real. Se uma oportunidade individual alcançar volume extremo, medir `EXPLAIN (ANALYZE, BUFFERS)` antes de considerar índices de expressão ou projeção materializada.

O cursor é estável diante de **novos eventos**, mas não congela um snapshot: uma atividade, visita, reserva ou proposta antiga pode mudar seu timestamp efetivo após uma mutação e atravessar a fronteira durante a leitura. Isso reflete a semântica atual da timeline como projeção de entidades, não como log imutável de todas as transições. O histórico de etapas, embora imutável, usa offset e pode deslocar páginas após nova mudança de etapa; o cliente deduplica IDs e recarrega a primeira página depois de mutações feitas na própria tela. Uma garantia de snapshot entre sessões/requisições exigiria modelo de eventos versionado, fora do CRM-FIX-08.

# CRM-FIX-09 — Resolução do ciclo de estados de SalesVisit e do BUG-09

**2026-09-18 — CORRIGIDO no código.** O texto original do BUG-09, na re-auditoria acima, permanece como registro do defeito encontrado; a ressalva escrita durante CRM-FIX-05 também permanece como fotografia daquela entrega.

Antes, `VisitsService.update` aceitava qualquer mudança de status, inclusive reativar visita cancelada e sobrescrever resultado de visita já realizada. `outcome` era zerado fora de `REALIZADA`, mas `result` livre ainda podia ficar numa visita cancelada. Uma requisição repetida também gerava `UPDATE` e auditoria mesmo sem mudança comercial. A interface oferecia ações apenas sobre `AGENDADA`, porém essa era uma convenção visual, não uma regra do domínio.

Agora o plano de transição é calculado em `sales-visit-transition.ts` a partir da linha bloqueada por `organizationId` dentro da transação. `AGENDADA` pode ser editada ou finalizada em `REALIZADA`, `NAO_COMPARECEU` ou `CANCELADA`; não há saída desses estados finais. Reagendamento só altera campos de agenda, e finalização não pode ser misturada com eles. A realização pode guardar `outcome`, `result` e observações; o outcome continua opcional para compatibilidade. Ausência não recebe resultado nem motivo de cancelamento. Cancelamento exige motivo normalizado e limitado pelo DTO, e não recebe `outcome`, `result` ou notas de realização. `completedAt`/`cancelledAt` são definidos exclusivamente pela transição. Uma requisição sem mudança real devolve a visita sem escrita/auditoria. Estado final rejeita nova mutação com `409`; combinações inválidas recebem `400`; visita de outro tenant continua `404`.

O writer continua sendo `VisitsService.update`, sem lógica paralela em propostas ou vendas. A auditoria `SALES_VISIT_UPDATED` continua na mesma transação somente quando há mudança, e a timeline paginada de CRM-FIX-08 continua consumindo a visita persistida; no cancelamento, mostra o motivo em vez das notas antigas quando não há resultado. As duas interfaces de visitas exibem ações apenas em `AGENDADA` e, se o backend responder `409` por estado desatualizado, mostram o erro e recarregam os dados sem apagar a oportunidade. Nenhum enum, coluna, índice ou migration foi criado. Dados antigos não foram reescritos: visitas legadas em combinação incoerente permanecem legíveis, mas estados finais não são modificáveis por este `PATCH`. Corrigir registros legados, se houver, requer auditoria e fluxo próprio autorizado; não houve backfill.

# CRM-052 — Resolução do BUG-10 e base E2E comercial

**2026-09-18 — CORRIGIDO no backend.** O texto original do BUG-10 foi preservado acima. A causa era estrutural: o script Jest referenciava `test/jest-e2e.json`, porém `test/` não existia e estava explicitamente ignorado pelo Git. Não havia banco descartável, aplicação de migrations, factories, guard de ambiente nem cenário integrado.

`npm run test:e2e` agora orquestra um PostgreSQL real descartável. O caminho padrão usa `postgres:16-alpine` em container com nome, senha, banco e porta efêmeros; a alternativa `E2E_POSTGRES_BIN` cria um cluster nativo temporário em UTC e o remove ao final. Um banco provisionado pode ser usado por `E2E_DATABASE_URL`. Antes de qualquer reset, o runner exige protocolo PostgreSQL, nome contendo `test` ou `e2e`, recusa igualdade com `PRODUCTION_DATABASE_URL` e exige opt-in explícito para host remoto. Depois recria somente `public`, roda `prisma migrate deploy` e executa Jest com um worker. O `finally` encerra e remove a infraestrutura que criou, inclusive quando há falha.

As factories diretas ficam restritas ao pré-requisito do cenário: organização, usuários com senha real e papéis, SPE, empreendimento, tipologia, unidades, tabela e preços. Login e JWT passam por `POST /auth/login`; pessoa, oportunidade, atividade, visita, seleção da unidade, reserva, proposta, envio, aceite e venda usam controllers, pipes, guards, services, locks e persistência reais. O cenário principal confirma LEAD idempotente, histórico inicial, state machine `AGENDADA → REALIZADA` e conflito terminal, `DISPONIVEL → RESERVADA → VENDIDA`, snapshot/versionamento monetário, ganho por writer centralizado, `stageEnteredAt`, um único histórico de ganho, recebíveis e soma em `Prisma.Decimal`. A timeline é lida em páginas de três eventos até cursor final e precisa conter as seis fontes sem duplicidade.

Um cenário curto move oportunidade para Perdido com `"Preço"` e a reabre: o estado atual limpa `Opportunity.lostReason`, enquanto histórico, timeline e auditoria retêm o motivo. Segurança cobre quatro tentativas cross-tenant (oportunidade, visita, unidade e timeline) e um usuário `LEITURA` que lê CRM mas recebe `403` ao criar atividade. Duas reservas HTTP simultâneas da mesma unidade produzem exatamente um `201`, um `409`, uma única reserva ativa e nenhum estado parcial. O rollback cria uma proposta aceita, reabre sua oportunidade e tenta converter usando número de venda já existente: a unicidade falha depois da tentativa interna de marcar a oportunidade como ganha; a transação preserva etapa, contagem de histórico, proposta não convertida e unidade reservada.

As 24 migrations existentes são exercitadas desde banco vazio, incluindo o índice do board, `OpportunityStageHistory.lostReason` e a remoção defensiva de `SalesVisit.companyId`. A execução local medida em PostgreSQL 18 nativo aprovou 3 suítes/6 testes; o trecho Jest levou cerca de 5 segundos e o comando completo, incluindo criação, migrations e descarte do cluster, cerca de 50 segundos nessa máquina. O frontend não ganhou Playwright/Cypress: essa continua evolução futura deliberada. A estabilização preexistente de `AppComponent.spec.ts` foi isolada no repositório web e não alterou comportamento de produto.
