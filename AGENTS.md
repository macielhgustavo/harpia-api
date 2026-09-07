# AGENTS.md — Harpia

## Propósito

Define como Codex, Claude Code ou outro agente deve trabalhar no Harpia com segurança, continuidade e rastreabilidade.

## Fontes de verdade

Antes de qualquer alteração relevante no CRM, ler nesta ordem:

1. `AGENTS.md`
2. `PROGRESS.md`
3. `docs/crm.md`
4. `docs/crm-master-audit.md`
5. `docs/crm/HARPIA_CRM_MASTER.md`
6. `docs/crm/CRM_BACKLOG.md`
7. `docs/crm/CRM_DECISIONS.md`
8. `docs/crm/CRM_UX.md`

Papéis:
- `PROGRESS.md`: progresso real; só atualizar quando algo estiver realmente concluído.
- `docs/crm.md`: documentação técnica do CRM atual.
- `docs/crm-master-audit.md`: auditoria histórica e gaps identificados.
- `HARPIA_CRM_MASTER.md`: visão futura.
- `CRM_BACKLOG.md`: tarefas pendentes.
- `CRM_DECISIONS.md`: decisões permanentes.
- `CRM_UX.md`: direção de experiência.

Nunca assumir que a auditoria histórica ainda representa o estado atual. Confirmar no código.

## Contexto

Backend: `macielhgustavo/harpia-api`  
Frontend: `macielhgustavo/harpia-web`  
Branch principal: `main`

Backend: NestJS, TypeScript, Prisma 5.22, PostgreSQL.  
Frontend: Angular 18 standalone, TypeScript, Tailwind, RxJS, Signals, lucide-angular.

## Princípios de arquitetura

- `Organization` é a raiz de tenancy.
- Nunca confiar em `organizationId` vindo do frontend.
- `Person` permanece a entidade central de pessoas.
- Reutilizar `Development`, `UnitType`, `Unit`, `SalesPipeline`, `SalesStage`, `Opportunity`, `OpportunityStageHistory`, `SalesActivity`, `SalesVisit`, `UnitReservation`, `SalesProposal`, `Sale`, `Receivable` e `Interaction` antes de criar conceitos paralelos.
- Uma oportunidade pode existir sem `unitId`.
- Ordem preferida: dados → processo → automação → IA.

## Segurança

Revisar sempre:
- IDOR;
- mass assignment;
- tenant isolation;
- RBAC;
- race conditions;
- duplicate execution;
- privilege escalation;
- vazamento em logs;
- dados pessoais;
- prompt injection em IA.

Nunca hardcodar segredos.

## Auditoria e concorrência

Auditar ações comerciais relevantes. Proteger dupla reserva, venda duplicada, conversão duplicada, mudança simultânea de etapa, automação duplicada e double submit.

## UX

Priorizar Kanban, lista, detalhe 360º, timeline, ações rápidas, follow-ups, filtros, empty states, mobile e estados de loading/error/retry.

Evitar formulários gigantes, modais desnecessários, ações escondidas e telas que apenas cadastram dados sem ajudar o usuário a agir.

## IA

A IA deve ser assistiva. Pode resumir oportunidades, sugerir mensagens, próxima ação, riscos e insights. Não deve, por padrão, vender unidade, cancelar venda, alterar financeiro, registrar pagamento, mudar preço ou enviar mensagem automaticamente.

## Workflow por tarefa

1. `git status`
2. `git pull`
3. ler as fontes de verdade
4. inspecionar o código atual
5. verificar se a feature já existe parcial ou totalmente
6. implementar apenas o necessário
7. testar backend e frontend
8. revisar tenancy/RBAC/auditoria
9. atualizar documentação afetada
10. atualizar `PROGRESS.md` somente se concluído
11. commit pequeno e claro
12. registrar limitações reais

## Definition of Done

Uma tarefa só está concluída quando comportamento principal funciona, builds passam, testes relevantes passam, tenancy/RBAC foram revisados, estados de UX foram tratados, documentação foi atualizada e não há dependência oculta de migration ou deploy.

## Regra de verdade

Nunca marcar como concluído algo que exista apenas no schema, apenas no backend, apenas no frontend, não tenha sido testado ou dependa de migration não aplicada.

## Foco atual

> Transformar o CRM do Harpia em uma experiência comercial excelente, especializada em incorporadoras e preparada para automação e IA assistida.
