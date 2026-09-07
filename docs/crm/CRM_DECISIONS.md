# CRM_DECISIONS.md

## ADR-001 — Person permanece central
**Status:** APROVADO

Não criar entidades separadas para lead, cliente, comprador ou investidor.

## ADR-002 — Opportunity pode existir sem Unit
**Status:** APROVADO

`unitId` é opcional no início.

## ADR-003 — Development/Unit existentes são autoridade
**Status:** APROVADO

CRM não duplica empreendimento, tipologia ou unidade.

## ADR-004 — Propostas preservam snapshot comercial
**Status:** APROVADO

Mudanças posteriores de tabela de preço não alteram proposta histórica.

## ADR-005 — Scores começam determinísticos
**Status:** APROVADO

Lead score, health e matching começam com regras explicáveis.

## ADR-006 — IA é assistiva
**Status:** APROVADO

IA sugere, resume e explica. Ações críticas ficam sob controle do usuário.

## ADR-007 — Clint é referência, não especificação
**Status:** APROVADO

Benchmark conceitual de pipeline, produtividade, atendimento, automações, IA e UX. Não copiar código ou identidade.

## ADR-008 — Timeline é histórica
**Status:** APROVADO

Eventos relevantes não devem ser apagados ou sobrescritos.

## ADR-009 — Motivos de perda devem ser estruturados
**Status:** PROPOSTO

Evoluir de texto livre para catálogo tenant-scoped.

## ADR-010 — Automação possui execution log
**Status:** APROVADO

Toda execução deve ser rastreável.

## ADR-011 — Multi-pipeline continua suportado
**Status:** APROVADO

Evoluções futuras não devem regredir essa capacidade.

## ADR-012 — Mobile é requisito funcional
**Status:** APROVADO

Corretor frequentemente trabalha fora do escritório.

## ADR-013 — Próxima melhor ação começa por regras
**Status:** APROVADO

IA pode complementar depois.

## ADR-014 — Tenant nunca vem do frontend
**Status:** APROVADO

`organizationId` deve vir da sessão autenticada.

## ADR-015 — SalesVisit existente deve ser evoluída, não recriada
**Status:** APROVADO

A documentação técnica atual já registra `SalesVisit` como entidade explícita.

## ADR-016 — SalesActivity existente é a base de produtividade
**Status:** APROVADO

Follow-ups, tarefas e atividades devem reutilizar a estrutura atual sempre que possível.

## ADR-017 — CRM é a prioridade atual
**Status:** DIREÇÃO ATUAL

Novas frentes grandes fora do CRM exigem justificativa forte até o CRM atingir maturidade alta.

# Template

## ADR-XXX — Título
**Status:** PROPOSTO / APROVADO / REVOGADO

**Contexto:**  
**Decisão:**  
**Motivo:**  
**Consequências:**  
**Data:**
