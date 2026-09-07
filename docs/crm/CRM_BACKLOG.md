# CRM_BACKLOG.md

## Regra de uso

Antes de executar qualquer item, comparar com `docs/crm.md`, `docs/crm-master-audit.md`, `PROGRESS.md` e com o código atual. Não refazer o que já existe.

## Estados

- **CONCLUÍDO** — existe e funciona no backend **e** no frontend.
- **PARCIAL** — existe só de um lado, ou existe incompleto.
- **PENDENTE** — não existe.
- **BLOQUEADO** — depende de outro item ou de decisão externa.

Estados verificados no código em 2026-09-06 (backend `cfcca47`, frontend `33fc566`).

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

## CRM-001 — Kanban premium — **PARCIAL**
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
Existem: pessoa, estágio, responsável, empreendimento, unidade, origem, valor, probabilidade, timeline, atividades, reservas e propostas.
Faltam: **visitas** (BUG-05), venda, tipologia, tags, score, health e próxima ação.

## CRM-004 — Filtros avançados — **PARCIAL**
Existem: responsável, etapa, pipeline, empreendimento e busca textual. O backend também aceita `personId` e `source`, mas a UI não os expõe.
Faltam: origem na UI, score, próxima atividade, período e status (aberta/ganha/perdida) — nenhum destes existe no backend.

## CRM-005 — Ações rápidas — **PARCIAL**
Existem: registrar contato/criar tarefa (modal de atividade), reservar unidade e criar proposta (seções embutidas), marcar ganho e marcar perda (modal de movimentação).
Falta: **agendar visita a partir da oportunidade**.

# Fase C — Timeline e produtividade

## CRM-006 — Timeline unificada — **PARCIAL**
Unificação feita no backend (`GET /crm/opportunities/:id/timeline` agrega etapas, atividades, visitas, reservas, propostas e vendas) e renderizada no detalhe.
Falta: **paginação** — as seis consultas não têm limite (BUG-08).

## CRM-007 — Follow-up profissional — **CONCLUÍDO**
`SalesActivity` possui título (`summary`), descrição (`notes`), responsável, data/hora, status, prioridade, `reminderAt` e `result`, com DTOs, filtros e formulário no frontend.

## CRM-008 — `/crm/tasks` — **PARCIAL**
Visões Hoje, Atrasadas, Próximas e Todas existem. **Concluídas não existe** e é impossível com a consulta atual, que envia `openOnly: true` fixo. As abas Hoje e Atrasadas se sobrepõem (BUG-03).

## CRM-009 — Reminders — **PENDENTE**
`reminderAt` é persistido e editável, mas nenhum código o lê. O CRM não consome o módulo de notificações e não existe worker de lembretes.

## CRM-010 — Resultado de atividade — **CONCLUÍDO**
Campo `result` no backend e no formulário de atividade, sem sobrescrever histórico.

# Fase D — Visitas

## CRM-011 — Experiência de visitas — **PARCIAL**
`SalesVisit` existe. Criação, agenda, comparecimento, ausência, cancelamento com motivo e resultado funcionam em `/crm/visits`.
Faltam: **reagendamento/edição pela UI** (o `PATCH` aceita `scheduledAt` e `durationMinutes`, mas nenhuma tela os envia) e a seção de visitas no detalhe da oportunidade.

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
## CRM-023 — Motivos de perda — **PENDENTE** (`lostReason` é `String?` livre e é apagado na reabertura — BUG-06)
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
## CRM-049 — Empty states — **PARCIAL** (existem em todas as telas de CRM, mas sem CTA de ação)
## CRM-050 — Performance — **PARCIAL** (paginação no servidor existe; timeline e histórico são ilimitados)
## CRM-051 — Observabilidade — **PENDENTE**
## CRM-052 — E2E completo — **PENDENTE** (`npm run test:e2e` aponta para um diretório inexistente; nenhuma tela de CRM tem teste de componente)

# Correções pendentes levantadas pela re-auditoria

Itens de correção, não de funcionalidade nova. Detalhamento em `docs/crm-master-audit.md`.

## CRM-FIX-01 — Propagar `stageEnteredAt` no ganho por proposta e venda — **PENDENTE (ALTA)**
`proposals.service.ts:627` e `sales.service.ts:921` movem a oportunidade sem atualizar o marco temporal. Corrompe o "tempo na etapa" no fluxo comercial normal. Exige teste de regressão.

## CRM-FIX-02 — `openOnly` não deve sobrescrever `status` — **PENDENTE (MÉDIA)**
## CRM-FIX-03 — Visão de concluídas e abas não sobrepostas em `/crm/tasks` — **PENDENTE (MÉDIA)**
## CRM-FIX-04 — Eliminar truncamento silencioso no funil e na agenda — **PENDENTE (MÉDIA)**
## CRM-FIX-05 — Seção de visitas no detalhe da oportunidade — **PENDENTE (MÉDIA)**
## CRM-FIX-06 — Preservar motivo de perda no histórico — **PENDENTE (MÉDIA)**
## CRM-FIX-07 — Resolver `SalesVisit.companyId` (usar ou remover) — **PENDENTE (BAIXA)**
## CRM-FIX-08 — Paginar timeline e histórico — **PENDENTE (BAIXA)**
## CRM-FIX-09 — Consertar `npm run test:e2e` — **PENDENTE (BAIXA)**

# Cenário E2E de referência

João Silva → Instagram → Residencial Aurora → 2 quartos → até R$ 500 mil → oportunidade → contato → qualificação → interesse → unidades compatíveis → visita → follow-up → unidade → reserva → proposta → aceite → venda.

Validar timeline, score, health, próxima ação, auditoria, tenancy, RBAC e ausência de duplicidade.

Hoje esse cenário é executável até "reserva → proposta → aceite → venda", com as ressalvas de que o interesse imobiliário, as unidades compatíveis, o score e a próxima ação ainda não existem, e a visita precisa ser agendada fora da tela da oportunidade.
