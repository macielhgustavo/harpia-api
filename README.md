<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

## Authentication security

The API uses Bearer JWTs without refresh tokens. New JWTs contain a per-user
`tokenVersion`; the JWT strategy confirms the account, organization and current
version in the database on every authenticated request. A password change or
successful recovery increments that version, immediately revoking all previous
JWTs for that account. Tokens issued by older deployments without
`tokenVersion` are rejected and require a new login.

New registration, password change and password recovery use one shared policy:

- at least 10 and at most 128 characters;
- at least one uppercase letter, lowercase letter, number and special
  character;
- no leading/trailing whitespace, whitespace-only value, or full e-mail value;
- no bcrypt-truncated value (bcrypt accepts only 72 UTF-8 bytes safely).

The seed account remains available for backward compatibility:
`admin@harpia.com` / `harpia123`. Its existing weak password can log in, but it
cannot be used when creating, changing or recovering a password; change it
after the first authenticated login.

All account e-mails are trimmed and lowercased before use. Lookups are
case-insensitive while registration serializes the normalized e-mail inside a
PostgreSQL transaction, avoiding new case-variant duplicates. Before a future
data-normalization migration, inspect the production database for historical
collisions:

```sql
SELECT lower(btrim("email")) AS normalized_email, count(*)
FROM "User"
GROUP BY lower(btrim("email"))
HAVING count(*) > 1;
```

### Account endpoints

| Endpoint | Authentication | Body | Behavior |
| --- | --- | --- | --- |
| `POST /auth/register` | Public | `name`, `organizationName`, `email`, `password` | Creates a normalized account using the strong policy. |
| `POST /auth/login` | Public | `email`, `password` | Returns `401 Credenciais inválidas` for either an unknown account or wrong password. |
| `POST /auth/forgot-password` | Public | `email` | Always returns the same success message; it does not reveal whether the account exists. |
| `POST /auth/reset-password` | Public | `token`, `newPassword` | Uses a single-use, expiring recovery token and the strong policy. |
| `POST /auth/accept-invitation` | Public | `token`, `name`, `password` | Atomically consumes a single-use invitation and returns a JWT. Organization, e-mail and role always come from the invitation. |
| `POST /auth/change-password` | Bearer JWT | `currentPassword`, `newPassword` | Validates the current password, then revokes previous JWTs and outstanding reset tokens. |

Examples for the future frontend integration:

```bash
curl -X POST http://localhost:3000/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@harpia.com"}'

curl -X POST http://localhost:3000/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"token":"TOKEN_RECEBIDO","newPassword":"NovaSenha#456"}'
```

Recovery tokens use 32 random bytes encoded as URL-safe text, but only their
SHA-256 hash is persisted. The default TTL is 30 minutes and is configurable.
A new recovery request invalidates any previous tokens for that account. The
default notifier is intentionally no-op: there is no e-mail provider, no reset
link/token is logged, and tests capture the notification through an injected
mock only. A production notifier should be implemented behind the same
`PASSWORD_RESET_NOTIFIER` contract.
Expired tokens are rejected on use and old tokens are removed when a new request
is created. A periodic cleanup job is intentionally not part of this stage.

Authentication events are structured and sanitized: they include an event,
user ID when applicable and a short SHA-256 e-mail fingerprint. Passwords,
hashes, JWTs, reset tokens and reset links are never recorded.

### Authentication rate limits

Only the public authentication endpoints use `@nestjs/throttler`; operational,
document and report endpoints are not globally throttled. Defaults are:

| Route | Default |
| --- | --- |
| Login | 5 requests / 60 seconds |
| Registration | 3 requests / 1 hour |
| Forgot password | 3 requests / 15 minutes |
| Reset password | 5 requests / 15 minutes |
| Accept invitation | 5 requests / 15 minutes |

The values can be changed with the `AUTH_THROTTLE_*` variables in
`.env.example`. The built-in storage is in-memory per instance and resets on a
restart; use shared throttler storage before horizontally scaling the service.
Render is configured with one trusted proxy hop so throttling uses the forwarded
client IP rather than a shared proxy address.

Set these password-recovery variables in each environment:

```env
PASSWORD_RESET_TOKEN_TTL_SECONDS=1800
PASSWORD_RESET_FRONTEND_URL=https://app.example.com/reset-password
```

User invitations use equivalent hashed-token safeguards, with a default TTL of
seven days. Configure the future acceptance screen independently:

```env
USER_INVITATION_TTL_SECONDS=604800
USER_INVITATION_FRONTEND_URL=https://app.example.com/accept-invitation
```

## Role-based access control

Every authenticated request loads the account's current role and active state
from the database. The role carried in the JWT is informational only; it is not
trusted as the authorization source. Deactivating an account or changing its
role increments `tokenVersion`, so previously issued JWTs stop working.

The centralized permission matrix currently applies these profiles:

| Role | Access profile |
| --- | --- |
| `OWNER` | Every permission, including users, future audit, financial data and exports. |
| `ADMIN` | Every permission, but cannot change an `OWNER` or grant the `OWNER` role. |
| `FINANCEIRO` | Operational reads plus bank-account, investment and return writes, financial dashboard and report exports. |
| `COMERCIAL` | People writes, operational reads, document/interaction writes and the reserved CRM/sales permissions. |
| `OPERACIONAL` | Operational reads and development, unit, price, document and interaction writes. |
| `LEITURA` | Nonfinancial read-only access. |

All existing operational controllers declare their required read permission at
class level and override it with the matching write permission on mutations.
Routes without authorization metadata fail closed with `403`; public routes and
the few routes intended for any valid JWT must opt in explicitly. Current
financial dashboard and report routes are unavailable to nonfinancial roles.
Generic people, company, development, unit and document responses also hide indirect
financial relationships; authorized financial callers retain the previous
response fields.

### User management endpoints

All endpoints below require `USERS_MANAGE` and are tenant-scoped:

| Endpoint | Behavior |
| --- | --- |
| `GET /users` | Lists safe account fields; accepts `role`, `isActive` and `search`. |
| `GET /users/:id` | Returns one account from the active organization. |
| `PATCH /users/:id/role` | Changes `role` and revokes existing sessions. |
| `PATCH /users/:id/status` | Activates/deactivates an account and revokes existing sessions. |
| `POST /users/invitations` | Creates a single pending invitation from `email` and `role`. |
| `GET /users/invitations` | Lists tenant invitations using a projection that excludes token hashes and URLs. |
| `POST /users/invitations/:id/revoke` | Revokes one pending invitation from the active organization. |

An account cannot deactivate itself. The final active `OWNER` in an
organization cannot be deactivated or demoted; mutations use a PostgreSQL
transaction-level advisory lock per organization so concurrent requests cannot
bypass that invariant. User responses never expose password hashes or
`tokenVersion`.

Invitation creation and acceptance serialize the normalized e-mail with the
same PostgreSQL advisory lock used by registration. This prevents an invited
address from creating a separate `OWNER` tenant and ensures concurrent accepts
have only one winner. `ADMIN` cannot create or revoke an `OWNER` invitation.
The acceptance body never controls the tenant or role. Invalid, expired,
revoked, already-used and concurrently consumed tokens share one generic public
error.

Only a SHA-256 token hash is stored. The raw token exists transiently in the
notifier payload after the invitation transaction commits. The default notifier
is intentionally no-op and logs only sanitized IDs and an e-mail fingerprint;
therefore production does not send invitations until a delivery provider is
configured behind `USER_INVITATION_NOTIFIER`.

## Private document storage

Documents are never served from a public static directory. Every document route
is protected by the application's JWT guard and download requests are scoped to
the authenticated user's organization.

For local development, keep the default configuration:

```env
STORAGE_DRIVER=local
STORAGE_LOCAL_PATH=./uploads
```

The local driver stores opaque keys below `STORAGE_LOCAL_PATH` and streams a
file only through `GET /documents/:id/download`. The file's original name is
preserved in the download response, while document list/detail responses expose
the authenticated `downloadUrl` endpoint rather than a public object URL.

For production, configure an S3-compatible private bucket:

```env
STORAGE_DRIVER=s3
S3_ENDPOINT=https://your-s3-compatible-endpoint # optional for AWS S3
S3_REGION=us-east-1
S3_BUCKET=harpia-private-documents
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_FORCE_PATH_STYLE=false
SIGNED_URL_EXPIRATION_SECONDS=300
```

The S3 driver creates a short-lived signed download URL only after the JWT and
organization checks pass. Keep the bucket private: disable public access and
grant the application's credential `s3:GetObject`, `s3:PutObject` and
`s3:DeleteObject` only for the `documents/*` prefix. Also grant
`s3:ListBucket` on the bucket restricted to that prefix so the API can safely
distinguish a missing object (404) from an authorization failure. Do not add a
public bucket policy or expose storage credentials to clients.

The storage provider is recorded per document. The migration marks existing
records as `local`, so an application can still resolve them through the local
driver while new uploads use the configured driver. Before switching an
existing production deployment to S3, copy any retained local files to the
private bucket and update their provider metadata; files already lost from
Render's ephemeral disk cannot be recovered.

## Financial reports

All report endpoints require a JWT and always scope data to the authenticated
user's organization. They generate the requested file in memory; reports are
never persisted to document storage.

| Endpoint                          | Filters                                                                   | Description                                   |
| --------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- |
| `GET /reports/captations`         | `startDate`, `endDate`, `developmentId`, `investorId`, `format`           | Captation by investment period                |
| `GET /reports/returns`            | `startDate`, `endDate`, `developmentId`, `investorId`, `status`, `format` | Expected and realized returns                 |
| `GET /reports/overdue-returns`    | `asOfDate`, `developmentId`, `investorId`, `format`                       | Pending returns overdue on the reference date |
| `GET /reports/investor-positions` | `developmentId`, `investorId`, `format`                                   | Consolidated position by investor             |

`format` is required and accepts only `xlsx` or `pdf`. Date filters use the
strict calendar format `YYYY-MM-DD`; when a period is supplied, `startDate` and
`endDate` must be sent together and are inclusive, implemented internally as
an end-exclusive UTC boundary. A requested period is limited to 366 days and
reports are limited to 5,000 base records. `asOfDate` is optional and defaults
to the current UTC date. Captation periods use the investment date, while
return periods use the expected-return date. Refine the filters when the API
returns a limit error.

When `developmentId` filters captation or investor-position reports, monetary
metrics represent only allocations linked to that development. This prevents a
single investment from being counted repeatedly when it is split between
developments. The unfiltered reports distinguish allocated capital, explicit
general-cash allocations, and capital that is not yet allocated.

The database currently uses `Float` for money. Report calculations normalize
each stored value once to integer cents, add those cents, and convert back only
for the final report output. Excel values remain numeric and use Brazilian
currency formatting. Text cells are protected against spreadsheet formula
injection.

Every download uses `Content-Disposition: attachment` and `Cache-Control:
no-store`. The PDF includes Harpia metadata, filters, a paginated table, and a
summary; Excel includes a title, filters, frozen header, automatic filters and
summary rows.

Examples:

```text
GET /reports/captations?startDate=2026-01-01&endDate=2026-12-31&format=xlsx
GET /reports/returns?status=ATRASADO&format=pdf
GET /reports/investor-positions?format=xlsx
```

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g @nestjs/mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
