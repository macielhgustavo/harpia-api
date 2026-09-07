# Harpia API

Backend do **Harpia**, uma plataforma vertical de gestão para incorporadoras imobiliárias.

O Harpia conecta operação imobiliária, CRM, vendas, investidores, financeiro, documentos, auditoria e relatórios em um único sistema.

> Objetivo atual de produto: transformar o CRM no principal ponto de entrada comercial do Harpia, com contexto imobiliário, automações e IA assistida.

---

## Visão do produto

O Harpia foi criado para centralizar processos que normalmente ficam espalhados entre planilhas, WhatsApp, documentos, sistemas financeiros e CRMs genéricos.

Fluxo principal:

```text
Pessoa
→ CRM
→ Empreendimento
→ Unidade
→ Reserva
→ Proposta
→ Venda
→ Recebíveis
→ Financeiro
```

Fluxo de investidores:

```text
Investidor
→ Investimento
→ Alocação
→ Retorno
```

Estrutura imobiliária:

```text
Organização
→ Empresa / SPE
→ Empreendimento
→ Tipologia
→ Unidade
→ Preço
```

---

## Stack

### Backend

- NestJS
- TypeScript
- Prisma 5.22
- PostgreSQL
- Passport JWT
- bcryptjs
- class-validator
- class-transformer

### Infraestrutura

- Render
- PostgreSQL
- storage local em desenvolvimento
- storage privado S3-compatible em produção

### Frontend relacionado

O frontend do Harpia está em outro repositório:

```text
macielhgustavo/harpia-web
```

Stack principal:

- Angular 18 standalone
- TypeScript
- Tailwind CSS
- RxJS
- Signals
- lucide-angular

---

## Domínios principais

O backend já possui estrutura para:

### Identidade e acesso

- autenticação;
- recuperação de senha;
- alteração de senha;
- convites;
- usuários;
- RBAC;
- revogação de sessão;
- auditoria.

### Pessoas

`Person` é a entidade central de pessoas do sistema.

Uma mesma pessoa pode assumir papéis como:

- LEAD
- CLIENTE
- CORRETOR
- FUNCIONARIO
- FORNECEDOR
- PARCEIRO
- INVESTIDOR

O Harpia evita criar cadastros paralelos para a mesma pessoa.

### Empresas e estrutura imobiliária

- empresas;
- SPEs;
- empreendimentos;
- tipologias;
- unidades;
- tabelas de preço;
- preço individual por unidade.

### CRM

- pipelines;
- etapas;
- oportunidades;
- histórico de etapas;
- atividades;
- visitas;
- timeline comercial;
- filtros;
- paginação;
- RBAC;
- auditoria.

Pipeline padrão:

```text
Novo
→ Contato inicial
→ Qualificado
→ Visita
→ Proposta
→ Negociação
→ Ganho / Perdido
```

Uma oportunidade pode começar sem unidade específica.

### Vendas

- reservas;
- propostas;
- versionamento de propostas;
- vendas;
- cancelamentos;
- distratos;
- recebíveis.

### Financeiro

- núcleo financeiro;
- contas a receber;
- contas a pagar;
- fluxo financeiro;
- conciliação bancária;
- DRE gerencial;
- cobranças automáticas;
- correção monetária.

### Investidores

- investimentos;
- alocações;
- retornos;
- relatórios de posição.

### Documentos

- upload privado;
- armazenamento local ou S3;
- acesso autenticado;
- URLs assinadas;
- proteção por tenant.

### Notificações

- central de notificações;
- preferências;
- suporte a evolução de notificações por canais externos.

### Relatórios

- relatórios financeiros;
- exportação XLSX;
- exportação PDF;
- filtros por período;
- proteção contra formula injection;
- auditoria de exportações.

---

# CRM

O CRM é uma das principais áreas estratégicas do Harpia.

Ele é isolado por organização e utiliza o usuário autenticado para definir tenant e ator.

Nenhum endpoint deve confiar em `organizationId` vindo do cliente.

## Modelo atual

Principais entidades:

- `SalesPipeline`
- `SalesStage`
- `Opportunity`
- `OpportunityStageHistory`
- `SalesActivity`
- `SalesVisit`

### Opportunity

A oportunidade se conecta a:

- pessoa;
- pipeline;
- etapa;
- responsável;
- empreendimento;
- unidade opcional.

### Activities

Atividades podem representar:

- ligação;
- WhatsApp;
- e-mail;
- reunião;
- visita;
- follow-up;
- tarefa;
- outro.

Possuem ciclo explícito de status e podem carregar prioridade, lembrete e resultado.

### Visits

`SalesVisit` representa a visita imobiliária como fluxo próprio.

Pode armazenar:

- oportunidade;
- pessoa;
- responsável;
- empreendimento;
- unidade;
- agenda;
- comparecimento;
- resultado.

## Regras importantes

- criar oportunidade adiciona o papel `LEAD` de forma idempotente;
- oportunidade não nasce em etapa terminal;
- unidade deve pertencer ao empreendimento informado;
- responsável deve ser usuário ativo da mesma organização;
- mover para perdido exige motivo;
- ganho e perda geram auditoria;
- histórico de etapa é preservado;
- valores comerciais novos devem usar precisão decimal adequada;
- listagens são paginadas no servidor.

## Endpoints principais

```text
GET|POST /crm/pipelines

GET|POST /crm/opportunities
GET|PATCH|DELETE /crm/opportunities/:id
POST /crm/opportunities/:id/move
GET /crm/opportunities/:id/history
GET /crm/opportunities/:id/timeline

GET|POST /crm/activities
PATCH|DELETE /crm/activities/:id

GET|POST /crm/visits
PATCH /crm/visits/:id
```

Leitura exige permissão equivalente a `CRM_READ`.

Mutações exigem permissão equivalente a `CRM_WRITE`.

---

# Direção atual do CRM

A evolução do CRM está organizada em documentação própria.

Prioridades:

1. melhorar experiência do pipeline;
2. consolidar timeline e produtividade;
3. melhorar experiência de visitas;
4. estruturar interesse imobiliário;
5. criar matching de unidades;
6. estruturar origens, tags e motivos de perda;
7. criar lead score, health e próxima melhor ação;
8. criar dashboard comercial;
9. criar automações;
10. adicionar IA assistida;
11. polir mobile, performance e observabilidade.

## Diferencial esperado

Um CRM genérico pode dizer:

> João está em negociação.

O Harpia deve conseguir dizer:

> João procura apartamento de 2 quartos até R$ 500 mil, visitou determinado empreendimento, recebeu proposta de uma unidade específica e está há dois dias sem interação.

A especialização imobiliária é parte central da estratégia do produto.

---

# Documentação interna

Antes de alterar o CRM, agentes e desenvolvedores devem consultar:

```text
AGENTS.md
PROGRESS.md
docs/crm.md
docs/crm-master-audit.md
docs/crm/HARPIA_CRM_MASTER.md
docs/crm/CRM_BACKLOG.md
docs/crm/CRM_DECISIONS.md
docs/crm/CRM_UX.md
```

### Função dos documentos

| Arquivo | Função |
| --- | --- |
| `AGENTS.md` | Regras de trabalho para agentes de código |
| `PROGRESS.md` | Estado real do projeto |
| `docs/crm.md` | Documentação técnica do CRM atual |
| `docs/crm-master-audit.md` | Auditoria técnica histórica do CRM |
| `HARPIA_CRM_MASTER.md` | Visão futura do CRM |
| `CRM_BACKLOG.md` | Tarefas e fases |
| `CRM_DECISIONS.md` | Decisões de produto e arquitetura |
| `CRM_UX.md` | Direção de experiência do usuário |

---

# Setup local

## Pré-requisitos

- Node.js
- npm
- PostgreSQL

## Instalação

```bash
npm install
```

Crie o arquivo de ambiente com base em:

```text
.env.example
```

Depois:

```bash
npx prisma generate
npx prisma migrate dev
```

## Rodar em desenvolvimento

```bash
npm run start:dev
```

Outros modos:

```bash
npm run start
npm run start:prod
```

---

# Testes

```bash
npm run test
npm run test:e2e
npm run test:cov
```

Antes de considerar um bloco concluído:

```bash
npx prisma format
npx prisma generate
npm run build
npm test -- --runInBand --forceExit
```

Use apenas os comandos que existirem no `package.json` atual.

---

# Autenticação

A API usa Bearer JWT.

Novos JWTs possuem `tokenVersion`.

A estratégia de autenticação valida no banco:

- conta;
- organização;
- status;
- versão atual do token.

Alteração ou recuperação de senha incrementa `tokenVersion` e invalida JWTs anteriores.

Tokens antigos sem `tokenVersion` são rejeitados.

## Política de senha

Novas senhas devem respeitar a política configurada pelo backend, incluindo:

- comprimento mínimo;
- maiúscula;
- minúscula;
- número;
- caractere especial;
- validação contra valores inseguros.

## Conta seed

O ambiente de desenvolvimento pode possuir a conta seed legada:

```text
admin@harpia.com
```

A senha correspondente deve ser tratada apenas como credencial de desenvolvimento e alterada quando necessário.

Nunca utilizar credenciais seed em produção.

---

# Endpoints de autenticação

| Endpoint | Autenticação | Função |
| --- | --- | --- |
| `POST /auth/register` | Público | Cadastro |
| `POST /auth/login` | Público | Login |
| `POST /auth/forgot-password` | Público | Solicita recuperação |
| `POST /auth/reset-password` | Público | Redefine senha |
| `POST /auth/accept-invitation` | Público | Aceita convite |
| `POST /auth/change-password` | JWT | Altera senha |

Tokens de recuperação e convite são armazenados como hash.

---

# Rate limiting

Endpoints públicos de autenticação possuem throttling próprio.

Os valores são configuráveis por variáveis `AUTH_THROTTLE_*`.

Antes de escalar horizontalmente, o armazenamento em memória do throttler deve ser substituído por armazenamento compartilhado.

---

# RBAC

O papel do JWT não é a fonte de autorização.

O backend consulta o estado atual do usuário.

Perfis principais:

| Papel | Perfil |
| --- | --- |
| `OWNER` | acesso total |
| `ADMIN` | acesso administrativo, com restrições sobre OWNER |
| `FINANCEIRO` | financeiro e relatórios |
| `COMERCIAL` | CRM, pessoas e vendas |
| `OPERACIONAL` | empreendimentos, unidades e operação |
| `LEITURA` | leitura não financeira |

Rotas sem metadata de autorização devem falhar fechadas.

---

# Gestão de usuários

Endpoints administrativos:

```text
GET /users
GET /users/:id
PATCH /users/:id/role
PATCH /users/:id/status
POST /users/invitations
GET /users/invitations
POST /users/invitations/:id/revoke
```

Regras importantes:

- usuário não pode desativar a própria conta;
- último OWNER ativo não pode ser removido/demovido;
- ADMIN não pode gerenciar OWNER como se tivesse a mesma autoridade;
- respostas nunca expõem hash de senha ou `tokenVersion`.

---

# Auditoria

`AuditLog` é append-only e tenant-scoped.

Mutações relevantes e auditoria devem compartilhar a mesma transação sempre que possível.

Exemplos auditados:

- autenticação;
- usuários;
- convites;
- empresas;
- empreendimentos;
- unidades;
- preços;
- investimentos;
- retornos;
- documentos;
- CRM;
- vendas;
- financeiro;
- exportações.

Endpoints:

```text
GET /audit-logs
GET /audit-logs/:id
```

Não existem endpoints HTTP para alterar ou excluir registros de auditoria.

---

# Documentos privados

Documentos nunca devem ser expostos em diretório público.

## Desenvolvimento

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=./uploads
```

## Produção

Exemplo:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
SIGNED_URL_EXPIRATION_SECONDS=300
```

O bucket deve permanecer privado.

---

# Reservas de unidades

Usuários com permissão de leitura de vendas podem consultar reservas.

Usuários com permissão de escrita podem:

- reservar;
- cancelar;
- converter.

Endpoints:

```text
GET /reservations
GET /reservations/:id
POST /reservations
POST /reservations/:id/cancel
POST /reservations/:id/convert
```

Regras:

- apenas unidade `DISPONIVEL` pode ser reservada;
- reserva ativa altera unidade para `RESERVADA`;
- cancelamento pode devolver a unidade para `DISPONIVEL`;
- concorrência é protegida por constraints, locks e transação;
- histórico de reserva impede exclusão inconsistente.

---

# Relatórios financeiros

Relatórios são tenant-scoped e gerados em memória.

Formatos:

- XLSX
- PDF

Exemplos:

```text
GET /reports/captations
GET /reports/returns
GET /reports/overdue-returns
GET /reports/investor-positions
```

Filtros devem usar períodos válidos e respeitar limites definidos no backend.

---

# Princípios de segurança

O Harpia deve manter como regras permanentes:

- tenant derivado da sessão;
- backend como autoridade de RBAC;
- validação de relacionamento entre entidades;
- transações em fluxos críticos;
- histórico imutável quando necessário;
- proteção contra double submit;
- proteção contra concorrência;
- logs sanitizados;
- documentos privados;
- hashes para tokens sensíveis;
- ausência de segredos no repositório;
- cuidado com formula injection em planilhas;
- precisão monetária adequada.

---

# Workflow de desenvolvimento

Antes de trabalhar em uma feature:

```text
ler documentação
→ inspecionar código atual
→ verificar se já existe
→ implementar
→ testar
→ revisar segurança
→ revisar UX
→ atualizar documentação
→ atualizar PROGRESS.md
→ commit
→ push
→ validar produção
```

Não marcar funcionalidade como concluída se:

- existe apenas no backend;
- existe apenas no frontend;
- não foi testada;
- migration não foi aplicada;
- produção está quebrada.

---

# Deploy

Produção atual:

- API: Render
- Frontend: Vercel

Migrations de produção devem ser tratadas de forma segura e idempotente.

Evitar alterações destrutivas sem plano de compatibilidade.

---

# Roadmap atual

O foco atual está no CRM.

Sequência recomendada:

```text
auditoria atualizada
→ CRM UX
→ timeline e produtividade
→ visitas
→ inteligência imobiliária
→ matching
→ scoring
→ dashboard
→ automações
→ IA assistida
→ polimento
```

A prioridade é melhorar profundamente o fluxo comercial antes de abrir novas grandes frentes do produto.

---

# Repositórios

Backend:

```text
macielhgustavo/harpia-api
```

Frontend:

```text
macielhgustavo/harpia-web
```

---

# Licença

Verifique o arquivo `LICENSE` do repositório para a licença atualmente adotada pelo projeto.
