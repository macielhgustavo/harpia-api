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
