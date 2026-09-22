# CRM_UX.md

## Objetivo

O corretor deve conseguir responder:

> O que eu preciso fazer agora?

com o mínimo possível de troca de tela.

## Antes de alterar UX

Verificar `/crm`, `/crm/opportunities/:id`, atividades e visitas já existentes. Preservar padrões bons do Harpia e evitar reconstrução desnecessária.

## Navegação sugerida

### COMERCIAL
- CRM
- Tarefas
- Visitas
- Pessoas

### VENDAS
- Reservas
- Propostas
- Vendas

## `/crm`

Cabeçalho com busca, filtros, `Nova oportunidade` e alternância Kanban/Lista.

Indicadores rápidos: leads ativos, tarefas de hoje, atrasadas, propostas aguardando e pipeline.

## Kanban

Card ideal:

```text
João Silva
Residencial Aurora
2 quartos · até R$ 500 mil

R$ 489.000
Responsável: Lucas

Próximo contato: hoje 15:00
3 dias na etapa

87/100
```

Estados visuais: normal, follow-up atrasado, proposta aguardando, visita próxima e risco.

## Modo lista

Colunas: pessoa, etapa, responsável, empreendimento, unidade/tipologia, origem, valor, última atividade, próxima atividade, dias na etapa e score.

## Detalhe 360º

Área principal: resumo, timeline, atividades, visitas, propostas, reservas, venda e notas.

Sidebar: pessoa, responsável, pipeline, etapa, empreendimento, tipologia, unidade, origem, valor, probabilidade, próximo contato, previsão, tags, score e health.

## Ações rápidas

- Registrar contato
- Criar tarefa
- Agendar visita
- Reservar unidade
- Criar proposta
- Marcar ganho
- Marcar perda

## Timeline

Unificar eventos em ordem cronológica. Cada item mostra tipo, resumo, responsável, data/hora e entidade relacionada.

## `/crm/tasks`

Tabs: Hoje, Atrasadas, Próximas e Concluídas.

## `/crm/visits`

Começar com lista, filtros e agenda simples. Só criar calendário complexo se houver necessidade real.

## Interesse imobiliário

```text
Preferências
Residencial Aurora
2 quartos
70–90 m²
Até R$ 500 mil
Entrada: R$ 80 mil
Objetivo: moradia
```

No detalhe da oportunidade, um card próprio `Preferências do imóvel` mostra esses dados ou um estado vazio com `Adicionar preferências`. Edição e remoção acontecem inline, com confirmação da remoção, loading e retry independentes. Quando existe unidade selecionada, ela é mostrada separadamente das preferências. Empreendimento e tipologia atuais podem ser sugeridos somente na criação do perfil; alterar preferências não troca a unidade. Com perfil, o CTA `Ver unidades compatíveis` abre resultados no próprio card, inclusive para `CRM_READ`. O empty state orienta o usuário a cadastrar preferências antes da busca.

Desde CRM-018, cada resultado mostra percentual e nível em texto (Excelente, Alta, Moderada ou Baixa), com `Como foi calculado` expansível: preço, área e quartos trazem contribuição e explicação; sem critérios avaliáveis aparece `Compatibilidade não avaliada`, sem percentual inventado. Fatores não avaliados são nomeados explicitamente. O texto deixa claro que o score mede encaixe nas preferências, não chance de compra. A seleção atual não modifica a nota.

CRM-019: o painel mantém a ordem global recebida do servidor e apresenta cards em uma coluna no celular e duas em telas amplas. O resumo mostra score, unidade, empreendimento, tipologia quando houver, preço, quartos/área quando houver, disponibilidade e no máximo três razões avaliadas (preço, área e quartos). Critérios completos só aparecem ao expandir o cálculo. Um leitor `CRM_READ` pode consultar e abrir a lista de unidades do empreendimento; `CRM_WRITE` pode selecionar a unidade. Quando já há outra, um bloco inline pede confirmação e esclarece que reservas/propostas não serão canceladas nem criadas. O PATCH é autoridade do estoque: `409` anuncia indisponibilidade e reconsulta a primeira página, sem trocar a unidade atual. Sucesso atualiza o resumo e oferece links às seções existentes de reservas/propostas. Edição do perfil invalida páginas anteriores e recarrega do início se o painel estava aberto; loading e retry ficam locais. `Carregar mais` anexa sem IDs repetidos. Não há filtros/ordenação locais enganosos sobre apenas a página carregada. O link `Ver unidade` abre a lista já existente no empreendimento, filtrada pelo identificador (não existe ficha individual). Selecionada na oportunidade é distinta de reservada; o card não afirma haver reserva sem dado próprio.

## Unidades compatíveis

```text
305
R$ 489.000
96% compatível

2 quartos
78 m²
Disponível

[Selecionar]
```

Sempre mostrar por que combina.

## Score

Nunca mostrar apenas `87/100`. Mostrar fatores positivos e negativos.

## Próxima melhor ação

```text
Fazer follow-up da proposta

A proposta foi enviada há 48h e não houve nova interação.

[Fazer follow-up]
```

## IA

Ações explícitas: resumir oportunidade, sugerir mensagem, explicar risco e sugerir próxima ação. Nunca executar ação crítica silenciosamente.

## Empty states

Todo empty state deve explicar o que significa, o que fazer e oferecer CTA relevante.

## Erros

Explicar, preservar contexto, oferecer retry quando fizer sentido e nunca apagar formulário silenciosamente.

## Mobile

Prioridades:
1. lista;
2. detalhe;
3. tarefas;
4. visitas;
5. ações rápidas;
6. Kanban horizontal.

## Performance percebida

Usar skeleton, debounce, paginação e atualização localizada. Evitar reload completo.

## Direção visual

Profissional, premium, sóbria, clara e coerente com a identidade Harpia. Gold com moderação.

## Critério de sucesso

Um corretor novo deve conseguir encontrar um lead, entender o contexto, saber o próximo passo, registrar uma ação e criar visita/proposta sem treinamento longo.
