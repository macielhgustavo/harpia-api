# HARPIA_CRM_MASTER.md

## Visão

O Harpia deve se tornar o sistema comercial central de uma incorporadora.

```text
Lead
→ Oportunidade
→ Qualificação
→ Atendimento
→ Visita
→ Interesse imobiliário
→ Unidade
→ Reserva
→ Proposta
→ Negociação
→ Venda
→ Recebíveis
→ Financeiro
```

Este arquivo descreve a visão futura. O estado técnico atual está em `docs/crm.md`; a auditoria histórica está em `docs/crm-master-audit.md`.

## Posicionamento

O Harpia não deve ser um CRM genérico com imóveis cadastrados. Deve ser um CRM imobiliário que entende empreendimento, tipologia, unidade, disponibilidade, preço, reserva, proposta, venda e financeiro.

Exemplo do diferencial:

> João procura apartamento de 2 quartos até R$ 500 mil, visitou o Residencial Aurora, demonstrou interesse na unidade 305, recebeu proposta de R$ 489 mil e está há dois dias sem resposta.

## Usuários principais

- dono da incorporadora;
- diretor/gerente comercial;
- corretor;
- administrativo;
- financeiro, quando necessário.

## Perguntas que o CRM deve responder

- Quem precisa de contato hoje?
- Quem está parado?
- Quem está perto de fechar?
- Qual corretor está responsável?
- Qual empreendimento, tipologia ou unidade interessa?
- Quais unidades são compatíveis?
- Quem visitou?
- Quem recebeu proposta?
- Quem precisa de follow-up?
- Quem perdeu e por quê?
- Qual origem, corretor e empreendimento convertem melhor?
- Onde o funil está travando?

## Princípios

- ação acima de cadastro;
- histórico preservado;
- unidade opcional no início;
- automação antes de autonomia;
- IA assistida;
- explicabilidade.

## Oportunidade 360º

Deve reunir pessoa, responsável, pipeline, etapa, empreendimento, tipologia, unidade, origem, valor, probabilidade, previsão, próxima atividade, timeline, visitas, reservas, propostas, venda, tags, score, health e próxima melhor ação.

## Interesse imobiliário

Registrar preferências antes da escolha da unidade:
- empreendimento;
- tipologia;
- quartos;
- área;
- faixa de preço;
- entrada disponível;
- prazo desejado;
- objetivo da compra.

## Match de unidades

Primeira versão determinística e explicável, usando disponibilidade, empreendimento, tipologia, preço, área, quartos, entrada e preferências. Retornar score 0–100 e motivos.

## Lead score e health

Começar com regras determinísticas. Score deve mostrar fatores positivos e negativos. Health sugerido: `SAUDAVEL`, `ATENCAO`, `RISCO`.

## Próxima melhor ação

Começar por regras. Exemplos: primeiro contato, follow-up pós-visita, follow-up de proposta, sugerir unidades, sugerir reserva.

## Dashboard comercial

KPIs prioritários:
- leads novos;
- oportunidades ativas;
- pipeline total e ponderado;
- ganhos;
- conversão;
- ticket médio;
- tempo de fechamento;
- leads sem contato;
- follow-ups atrasados;
- visitas;
- propostas abertas.

## Automação

Gatilhos iniciais: oportunidade criada, etapa alterada, atividade concluída, visita concluída, proposta criada/enviada/aceita/expirada, X dias sem atividade.

Ações iniciais: criar atividade, atribuir usuário, mover etapa, criar notificação, atualizar probabilidade, adicionar tag.

Toda automação deve ter rastreabilidade e proteção contra loops.

## IA

Prioridades:
1. resumo da oportunidade;
2. sugestão de mensagem;
3. próxima melhor ação;
4. insight gerencial.

## Referência de mercado

Usar Clint como benchmark conceitual de pipeline, produtividade, atendimento, automações, IA e UX. Não copiar código, identidade visual ou regras sem adaptação ao setor imobiliário.

## Fases

A. Re-auditoria  
B. Pipeline e UX  
C. Timeline e produtividade  
D. Visitas  
E. Inteligência imobiliária  
F. Organização comercial  
G. Scoring  
H. Dashboard  
I. Automações  
J. IA  
K. Polimento

## Critério final

> Eu quero minha equipe comercial trabalhando aqui.
