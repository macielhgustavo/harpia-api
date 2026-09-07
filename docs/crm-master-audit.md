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

- **BUG-01 (ALTA) — `stageEnteredAt` não é atualizado no ganho via proposta ou venda.** `proposals.service.ts:627` e `sales.service.ts:921` gravam o `stageId` da etapa ganha, criam `OpportunityStageHistory` e auditam, mas não tocam em `stageEnteredAt`. Apenas `crm.service.ts:490` o faz. Consequência: uma oportunidade que entrou em Negociação no dia 1 e foi convertida em venda no dia 30 aparece como "29 dias na etapa" já em Ganho, e `isStalled()` pode marcar como estagnada uma oportunidade recém-ganha. O índice `Opportunity_organizationId_stageId_stageEnteredAt_idx` fica não confiável.
- **BUG-02 (MÉDIA) — truncamento silencioso no Kanban e na agenda.** O funil carrega 50 registros e calcula `stageTotal()` sobre eles; a agenda carrega 100 e filtra as visões no cliente; o seletor de oportunidades em `/crm/visits` carrega 100. Acima desses limites, os totais por etapa, os contadores das abas e a lista de oportunidades agendáveis ficam errados sem qualquer aviso ao usuário.
- **BUG-03 (MÉDIA) — `/crm/tasks` não tem visão de concluídas e as abas se sobrepõem.** `openOnly: true` é fixo na consulta, então nem a aba "Todas" mostra atividades concluídas. Em `matchesView`, uma atividade agendada para hoje mais cedo satisfaz simultaneamente `TODAY` e `OVERDUE`, duplicando a contagem dos badges.
- **BUG-04 (MÉDIA) — `openOnly` sobrescreve `status`.** Em `CrmService.findActivities`, o spread de `openOnly` vem depois do de `status`; `?status=CONCLUIDA&openOnly=true` devolve pendentes e em andamento em vez de conjunto vazio.
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
