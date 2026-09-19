# CRM_BACKLOG.md

## Regra de uso

Antes de executar qualquer item, comparar com `docs/crm.md`, `docs/crm-master-audit.md`, `PROGRESS.md` e com o código atual. Não refazer o que já existe.

## Estados

- **CONCLUÍDO** — existe e funciona no backend **e** no frontend.
- **PARCIAL** — existe só de um lado, ou existe incompleto.
- **PENDENTE** — não existe.
- **BLOQUEADO** — depende de outro item ou de decisão externa.

Estados verificados no código em 2026-09-15 (bases backend `46eface`, frontend `8076f21`).

# Fase A — Re-auditoria

## CRM-A01 — Re-auditar o CRM atual — **CONCLUÍDO**

Verificar entidades, migrations, endpoints, services, frontend, RBAC, auditoria, notificações, testes e produção.

DoD:
- gaps atuais identificados;
- itens já implementados marcados;
- documentação técnica corrigida se necessário;
- nenhuma feature nova adicionada nesta tarefa.

Resultado registrado na seção "Atualização — Re-auditoria CRM-A01" de `docs/crm-master-audit.md`.

# Fase B — Experiência principal

## CRM-001 — Kanban premium — **PARCIAL** *(paginação e totais resolvidos no CRM-FIX-04)*
- cards densos e úteis — parcial (pessoa, empreendimento/unidade, valor, responsável, probabilidade, próximo contato e tempo na etapa; sem próxima atividade e sem score);
- drag and drop robusto — feito (HTML5 nativo, `crm.component.ts:263`);
- persistência e rollback visual — persistência feita; não há update otimista, o drop abre modal de confirmação, então não existe rollback a fazer;
- prevenção de double submit — feita (guarda `moving()`);
- tempo na etapa — feito (`daysInStage` sobre `stageEnteredAt`);
- próxima atividade — pendente;
- estados de risco — feito (`isOverdue`, `isStalled`);
- mobile — parcial (scroll horizontal do funil).

Bloqueio de qualidade: totais e contagens por etapa são calculados sobre uma página de 50 registros (BUG-02).

## CRM-002 — Modo lista avançado — **PARCIAL**
Busca, filtros, paginação e navegação para detalhe existem. **Ordenação não existe** — nem na UI nem como parâmetro do backend. Faltam colunas de última atividade, próxima atividade e score.

## CRM-003 — Detalhe 360º — **PARCIAL**
Existem: pessoa, estágio, responsável, empreendimento, unidade, origem, valor, probabilidade, timeline, atividades, **visitas** (CRM-FIX-05), reservas e propostas.
Faltam: venda, tipologia, tags, score, health e próxima ação.

## CRM-004 — Filtros avançados — **PARCIAL**
Existem: responsável, etapa, pipeline, empreendimento e busca textual. O backend também aceita `personId` e `source`, mas a UI não os expõe.
Faltam: origem na UI, score, próxima atividade, período e status (aberta/ganha/perdida) — nenhum destes existe no backend.

## CRM-005 — Ações rápidas — **CONCLUÍDO**
As sete ações do `CRM_UX.md` existem no detalhe: registrar contato e criar tarefa (modal de atividade), **agendar visita** (cabeçalho e seção de visitas, CRM-FIX-05), reservar unidade e criar proposta (seções embutidas), marcar ganho e marcar perda (modal de movimentação). Nenhuma delas exige navegação intermediária.

# Fase C — Timeline e produtividade

## CRM-006 — Timeline unificada — **PARCIAL**
Unificação feita no backend (`GET /crm/opportunities/:id/timeline` agrega etapas, atividades, visitas, reservas, propostas e vendas) e renderizada no detalhe.
Paginação concluída em CRM-FIX-08: cursor na timeline unificada e carregamento incremental no detalhe. Permanecem fora do escopo a visão de atividades concluídas em `/crm/tasks` e reminders efetivos.

## CRM-007 — Follow-up profissional — **CONCLUÍDO**
`SalesActivity` possui título (`summary`), descrição (`notes`), responsável, data/hora, status, prioridade, `reminderAt` e `result`, com DTOs, filtros e formulário no frontend.

## CRM-008 — `/crm/tasks` — **CONCLUÍDO**
As visões Hoje, Atrasadas, Próximas e Concluídas existem, são mutuamente exclusivas e cada uma é uma consulta própria ao servidor. A aba "Todas as abertas" foi mantida por ser a única onde aparecem atividades abertas sem agendamento. A ordenação de Concluídas e o limite de 100 registros por visão seguem como ressalvas registradas no CRM-FIX-03.

## CRM-009 — Reminders — **PENDENTE**
`reminderAt` é persistido e editável, mas nenhum código o lê. O CRM não consome o módulo de notificações e não existe worker de lembretes.

## CRM-010 — Resultado de atividade — **CONCLUÍDO**
Campo `result` no backend e no formulário de atividade, sem sobrescrever histórico.

# Fase D — Visitas

## CRM-011 — Experiência de visitas — **CONCLUÍDO**
`SalesVisit` existe. Criação, agenda, comparecimento, ausência, cancelamento com motivo e resultado funcionam em `/crm/visits`, e o ciclo inteiro — incluindo **reagendamento** — funciona dentro do detalhe da oportunidade desde o CRM-FIX-05.

**Ressalva:** o reagendamento altera data, duração, responsável, local e observações, mas não empreendimento nem unidade, porque `UpdateSalesVisitDto` não aceita esses campos. `/crm/visits` continua sem reagendamento próprio.

## CRM-012 — Agenda de visitas — **PARCIAL**
Filtros por data, corretor e status existem. **Filtro por empreendimento não existe** — nem no DTO do backend nem na UI.

## CRM-013 — Resultado de visita — **CONCLUÍDO**
`SalesVisitOutcome` estruturado (5 valores) mais texto livre, com modal dedicado de registro de comparecimento.

## CRM-014 — Pós-visita automatizável — **PENDENTE**
Nenhuma regra cria follow-up após visita.

# Fase E — Inteligência imobiliária

## CRM-015 — Perfil de interesse — **PENDENTE**
## CRM-016 — Fluxo sem unidade — **CONCLUÍDO**
`Opportunity.unitId` é opcional no schema, nos DTOs e na UI; o aceite de proposta e a venda preenchem a unidade quando ela ainda não existe.
## CRM-017 — Match de unidades — **PENDENTE**
## CRM-018 — Score de compatibilidade — **PENDENTE**
## CRM-019 — UI de unidades compatíveis — **PENDENTE**

# Fase F — Organização comercial

## CRM-020 — Lead sources — **PENDENTE** (`source` é `String?` livre)
## CRM-021 — UTMs — **PENDENTE**
## CRM-022 — Tags — **PENDENTE**
## CRM-023 — Motivos de perda — **PENDENTE** (`lostReason` continua texto livre; a preservação histórica foi resolvida no CRM-FIX-06, mas o catálogo tenant-scoped ainda não existe)
## CRM-024 — Relatório de perdas — **PENDENTE**

# Fase G — Inteligência comercial

## CRM-025 — Lead score — **PENDENTE**
## CRM-026 — Health score — **PENDENTE**
## CRM-027 — Próxima melhor ação — **PENDENTE**
## CRM-028 — Explicabilidade — **PENDENTE**

# Fase H — Dashboard

## CRM-029 — Dashboard comercial — **PENDENTE**
## CRM-030 — Funil e conversão — **PENDENTE**
## CRM-031 — Performance por corretor — **PENDENTE**
## CRM-032 — Performance por empreendimento — **PENDENTE**
## CRM-033 — Pipeline ponderado — **PENDENTE**

O dashboard geral (`GET /dashboard`) existe, mas não possui nenhum indicador comercial de funil.

# Fase I — Automações

## CRM-034 — Automation core — **PENDENTE**
## CRM-035 — Triggers — **PENDENTE**
## CRM-036 — Conditions — **PENDENTE**
## CRM-037 — Actions — **PENDENTE**
## CRM-038 — Execution log — **PENDENTE**
## CRM-039 — Proteção contra loops — **PENDENTE**

Existe motor de automação apenas para cobrança (`collections-automation.service.ts`), fora do CRM. Pode servir de referência de idempotência.

# Fase J — IA

## CRM-040 — AiModule/provider abstraction — **PENDENTE**
## CRM-041 — Resumo da oportunidade — **PENDENTE**
## CRM-042 — Sugestão de mensagem — **PENDENTE**
## CRM-043 — Próxima ação assistida — **PENDENTE**
## CRM-044 — Insights gerenciais — **PENDENTE**
## CRM-045 — AiUsage/custo — **PENDENTE**
## CRM-046 — Segurança IA — **PENDENTE**

# Fase K — Polimento

## CRM-047 — Mobile — **PARCIAL** (layouts responsivos existem; funil e lista dependem de scroll horizontal)
## CRM-048 — Busca global — **PENDENTE**
## CRM-049 — Empty states — **PARCIAL** (existem em todas as telas de CRM; só a seção de visitas do detalhe tem CTA de ação)
## CRM-050 — Performance — **PARCIAL** (paginação no servidor cobre timeline e histórico; outros blocos do detalhe continuam limitados a 100 por lista)
## CRM-051 — Observabilidade — **PENDENTE**
## CRM-052 — E2E completo — **PENDENTE** (`npm run test:e2e` aponta para um diretório inexistente. Testes de componente já existem para `/crm`, `/crm/tasks`, `/crm/visits` e o detalhe da oportunidade; não há E2E de ponta a ponta)

# Correções pendentes levantadas pela re-auditoria

Itens de correção, não de funcionalidade nova. Detalhamento em `docs/crm-master-audit.md`.

## CRM-FIX-01 — Propagar `stageEnteredAt` no ganho por proposta e venda — **CONCLUÍDO**
Resolvido em 2026-09-06 centralizando a transição de etapa em `applyOpportunityStageChange` (`src/crm/opportunity-stage.ts`), agora o escritor único de `Opportunity.stageId` para movimentação manual, aceite de proposta e conversão em venda. Onze testes de regressão validam `stageEnteredAt` diretamente. Detalhes e procedimento de backfill em `docs/crm-master-audit.md`.

**Ressalva:** oportunidades ganhas entre 2026-09-04 e 2026-09-06 podem ter o campo defasado no banco. O backfill está documentado mas **não foi executado** — depende de autorização.

## CRM-FIX-02 — `openOnly` não deve sobrescrever `status` — **CONCLUÍDO**
Resolvido em 2026-09-06. `status` e `openOnly` passaram a ser filtros independentes combinados com E lógico, resolvidos por interseção de conjuntos em `buildSalesActivityStatusFilter` (`src/crm/sales-activity-filters.ts`); o predicado inteiro da listagem é montado por `buildSalesActivityWhere`, num só lugar e sem depender de ordem de spread. `status=CONCLUIDA&openOnly=true` agora devolve conjunto vazio. Vinte testes validam o predicado gerado. Contrato completo em `docs/crm.md`; detalhes em `docs/crm-master-audit.md`.

Nenhuma tela precisou mudar: nenhuma chamada do frontend envia os dois filtros juntos. A aba de concluídas em `/crm/tasks` continua pendente no CRM-FIX-03, que esta correção destrava.
## CRM-FIX-03 — Visão de concluídas e abas não sobrepostas em `/crm/tasks` — **CONCLUÍDO**
Resolvido em 2026-09-06, apenas no frontend. Cada aba virou uma consulta própria ao servidor, aproveitando o contrato componível do CRM-FIX-02: Hoje, Atrasadas e Próximas particionam a linha do tempo em `(-∞, hoje)`, `[hoje, amanhã)` e `[amanhã, +∞)`, e Concluídas usa `status=CONCLUIDA` sem `openOnly`. Os badges vêm do `pagination.total` da mesma consulta que produziu a lista. Definida a política de fuso horário do CRM: o dia é o dia local do navegador. Primeiro teste de componente de uma tela de CRM, com 28 casos e relógio fixo. Detalhes em `docs/crm-master-audit.md`.

**Ressalvas:** Concluídas herda a ordenação padrão do endpoint (`completedAt` ascendente); inverter exigiria um parâmetro de ordenação que o backend não possui. Atividades `CANCELADA` seguem sem visão própria. O limite de 100 registros por visão permanece e é escopo do CRM-FIX-04, agora sinalizado na tela por um aviso explícito de truncamento.
## CRM-FIX-04 — Eliminar truncamento silencioso no funil e na agenda — **CONCLUÍDO**
Resolvido em 2026-09-06 nos dois repositórios. Criado `GET /crm/board`, que devolve cada etapa com página própria e agregados (`total`, `loaded`, `hasMore`, `estimatedValue`, `weightedValue`) calculados sobre o conjunto filtrado inteiro. A agregação é uma única consulta agrupada por `(stageId, probability)`, o que permite o valor ponderado sem SQL bruto e mantém uma só implementação dos filtros, em `buildOpportunityWhere`. Dinheiro é somado em `Prisma.Decimal` e serializado como string. O funil carrega 20 cards por etapa com `Carregar mais`; a agenda pagina por visão; o seletor de oportunidade em `/crm/visits` virou busca no servidor com debounce. O drag and drop é otimista com rollback de colunas e summaries. Migration aditiva `20260906010000_crm_board_stage_index`. Contrato completo em `docs/crm.md`; detalhes em `docs/crm-master-audit.md`.

**Ressalvas:** timeline e histórico da oportunidade foram paginados em CRM-FIX-08; atividades, reservas e propostas no detalhe seguem em 100 por bloco, por serem limites por oportunidade e não por tenant.
## CRM-FIX-05 — Seção de visitas no detalhe da oportunidade — **CONCLUÍDO**
Resolvido em 2026-09-07, apenas no frontend. O backend já cobria todo o ciclo: `GET|POST /crm/visits` e `PATCH /crm/visits/:id` foram conferidos item a item antes de qualquer alteração e nenhuma lacuna real de contrato foi encontrada — nenhuma migration, DTO ou regra de domínio foi tocada. Criado `VisitsSectionComponent`, componente próprio no padrão de reservas e propostas, com loading, erro, retry e empty state independentes: uma falha ao listar visitas não derruba o resto do detalhe. A seção separa `Próximas visitas` (status `AGENDADA`, mais cedo primeiro, único bloco com ações) de `Histórico` (demais status, mais recente primeiro), e informa o excedente quando o total passa da página de 100. Agendar, reagendar, marcar como realizada com `outcome` estruturado, registrar não comparecimento e cancelar com motivo acontecem dentro da oportunidade. O reagendamento é `PATCH` na mesma visita, preservando id, tenant, oportunidade, criador e auditoria. A ação rápida `Agendar visita` foi ao cabeçalho do detalhe. Criado `opportunity-detail.component.spec.ts`, primeiro teste de componente do detalhe, com 29 casos. Suíte do frontend com 501 testes passando e build limpo. Contrato completo em `docs/crm.md`; detalhes em `docs/crm-master-audit.md`.

**Ressalvas:** o reagendamento não altera empreendimento nem unidade, porque `UpdateSalesVisitDto` não aceita esses campos; o backend não possui máquina de estados de visita, então a restrição de agir só sobre visitas `AGENDADA` é convenção de UI e não invariante de domínio; `GET /crm/visits` segue sem ordenação e sem filtro por empreendimento (CRM-012).
## CRM-FIX-06 — Preservar motivo de perda no histórico — **CONCLUÍDO**
Resolvido em 2026-09-15 nos dois repositórios. `OpportunityStageHistory.lostReason` é agora a fonte de verdade de cada evento de perda, enquanto `Opportunity.lostReason` continua representando somente o estado atual e pode ser limpo na reabertura. O writer único exige, normaliza e limita o motivo, grava estado e histórico na mesma transação e inclui uma cópia sanitizada na auditoria. A timeline e o histórico do detalhe mostram as perdas anteriores mesmo depois de reabertura ou ganho. Migration aditiva `20260907010000_opportunity_stage_history_lost_reason`, sem backfill automático. A análise de recuperabilidade e as consultas manuais estão em `docs/crm-master-audit.md`.

**Ressalva:** motivos já apagados antes da correção são irrecuperáveis quando nenhuma outra fonte preservou o texto. O CRM-023 (catálogo estruturado) e o CRM-024 (relatório de perdas) continuam pendentes.
## CRM-FIX-07 — Resolver `SalesVisit.companyId` (usar ou remover) — **CONCLUÍDO**
Resolvido em 2026-09-15 no backend. A relação era um artefato de drift: entrou no schema inicial de `SalesVisit`, mas não na migration, no DTO, no service, nos includes, nos filtros, nos relatórios, na seed nem no frontend; a migration seguinte apenas alinhou o banco ao schema sem definir semântica. A coluna e a relação foram removidas. A empresa/SPE de uma visita é derivada exclusivamente do empreendimento (`SalesVisit.developmentId → Development.companyId`), com a unidade validada no mesmo empreendimento. A migration `20260915010000_remove_sales_visit_company_relation` aborta se encontrar valor não nulo inesperado, remove a FK e a coluna e não toca nas linhas ou no histórico de visitas. Não existia índice correspondente. Nenhum banco de produção foi consultado ou alterado nesta execução; a consulta de inspeção manual está em `docs/crm-master-audit.md`.
## CRM-FIX-08 — Paginar timeline e histórico — **CONCLUÍDO**
Resolvido em 2026-09-18 nos dois repositórios. O histórico usa `page/pageSize` e retorno paginado padrão. A timeline seleciona chaves das seis fontes por `UNION ALL` tenant-scoped, ordena por `occurredAt DESC, id ASC` e usa cursor por chave composta; hidrata somente eventos da página. O detalhe carrega 20 eventos inicialmente e oferece botões para etapas e eventos anteriores, com append, deduplicação, erro/retry e mescla de eventos novos. Sem migration: as seis fontes já têm índices com `organizationId` e `opportunityId`; não há índice simples que cubra os timestamps `COALESCE` de todas as fontes. Ver contrato e ressalva de timestamps mutáveis em `docs/crm.md`.
## CRM-FIX-09 — Validar transições de estado de SalesVisit — **CONCLUÍDO**
Resolvido em 2026-09-18. `AGENDADA` é o único estado editável e a origem das transições para `REALIZADA`, `NAO_COMPARECEU` ou `CANCELADA`; estados finais não podem ser alterados por `PATCH`. A decisão ocorre sob lock tenant-scoped no writer único de visitas. Cancelamento exige motivo e nunca conserva `result`/`outcome`; ausência também não aceita resultado; realização mantém outcome opcional por compatibilidade. No-op não cria update nem auditoria. A interface só oferece ações válidas e recarrega após `409`. Sem migration. Ver `docs/crm.md` e resolução separada do BUG-09 em `docs/crm-master-audit.md`.

**Pendente fora deste item:** `npm run test:e2e` continua sem cenário executável, registrado em CRM-052/BUG-10. Esta identificação havia sido atribuída a E2E no backlog anterior; foi realinhada à tarefa CRM-FIX-09 solicitada, sem declarar E2E concluído.

# Cenário E2E de referência

João Silva → Instagram → Residencial Aurora → 2 quartos → até R$ 500 mil → oportunidade → contato → qualificação → interesse → unidades compatíveis → visita → follow-up → unidade → reserva → proposta → aceite → venda.

Validar timeline, score, health, próxima ação, auditoria, tenancy, RBAC e ausência de duplicidade.

Hoje esse cenário é executável até "reserva → proposta → aceite → venda", com a ressalva de que o interesse imobiliário, as unidades compatíveis, o score e a próxima ação ainda não existem. Desde o CRM-FIX-05, todo o trecho de visita — agendar, reagendar, realizar com resultado, registrar ausência e cancelar — é executável sem sair da tela da oportunidade.
