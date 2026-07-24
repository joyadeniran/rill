# RILL — Product & Technical Specification

**Status:** Living document. Supersedes `RILL_SPEC.md` (the original MVP brief, kept for provenance).
**Last updated:** 2026-07-24

---

## 1. What Rill is

Rill is a field-first credit system for Supplya. It puts working capital on a small
merchant's book, then drives repayment through a disciplined daily collection loop
run by field officers.

It is **not** a dashboard product. The mobile app is a decision-and-action system for
someone standing in a market; the web console is an oversight-and-control surface for
the people funding and supervising that work.

```
Mobile app (Expo / React Native)  ─┐
                                   ├─→  Express API  ─→  PostgreSQL (Supabase)
Web console (Vite / React)        ─┘         │
                                             └─→  Google Gemini (advisory only)
```

**Deployment:** API + built web bundle on Render (`rill-app`); database on Supabase
(IPv4 session pooler — see §11). Mobile ships as an APK via Codemagic or EAS.

---

## 2. The three users

Rill has exactly three kinds of user. Everything in §3 follows from this.

| Role | Who they are | Surface | Core job |
|---|---|---|---|
| **`co`** | Collection Officer | Mobile app | Walk the market. Collect money, capture field reality. |
| **`admin`** | Supplya administrator | Web console | Put money out, decide who works which merchant, provision people. |
| **`lender`** | Capital provider | Web console | See where the money is and what risk it carries. Change nothing. |

A fourth party — the **merchant** — is the subject of the system but is *not* a user.
Merchants never authenticate; they are records that officers act upon.

### How each role gets an identity

- **`co`** — self-registers with an invite code (`REGISTRATION_INVITE_CODE`), or is
  created by an admin. Always lands as `co`; a `role` field in the registration body
  is ignored.
- **`admin`** — **never** created inside Rill. Authority is delegated to the existing
  Supplya backend via `POST /api/auth/admin-login`, which proxies the credentials and
  only mints an admin token when Supplya asserts `role === 'admin'`. Rill stores no
  admin credentials, and `POST /api/officers` explicitly refuses `role: 'admin'`.
- **`lender`** — created by an admin via `POST /api/officers`, signs in at
  `POST /api/auth/login`.

**Rationale:** the only privilege boundary that matters commercially is "who can move
money". Keeping admin authority outside Rill means a Rill compromise cannot mint one.

---

## 3. Privilege matrix

The authority is the signed token's `role` claim, enforced server-side by
`requireRole(...)`. The UI mirrors it, but the UI is not the control.

| Capability | Endpoint | `co` | `admin` | `lender` |
|---|---|:--:|:--:|:--:|
| Sign in | `POST /api/auth/login` | ✅ | — | ✅ |
| Sign in (delegated) | `POST /api/auth/admin-login` | — | ✅ | — |
| Self-register (invite-gated) | `POST /api/auth/register` | ✅ | — | — |
| Change own password | `POST /api/auth/change-password` | ✅ | ✅ | ✅ |
| Today's book | `GET /api/today` | ✅ scoped | ✅ all | ✅ all |
| Merchant history | `GET /api/users/:id/history` | ✅ | ✅ | ✅ |
| Create merchant | `POST /api/users` | ✅ | ✅ | ❌ |
| Record payment | `POST /api/payments` | ✅ | ✅ | ❌ |
| Record audit | `POST /api/audits` | ✅ | ✅ | ❌ |
| Raise escalation | `POST /api/escalations` | ✅ | ✅ | ❌ |
| Attach photo | `POST /api/photos` | ✅ | ✅ | ❌ |
| View photos | `GET /api/photos/:id`, `GET /api/users/:id/photos` | ✅ | ✅ | ✅ |
| Full portfolio | `GET /api/users` | ❌ | ✅ | ✅ |
| Escalation feed | `GET /api/escalations` | ❌ | ✅ | ✅ |
| Defaulter list | `GET /api/defaulters` | ❌ | ✅ | ✅ |
| **Disburse credit** | `POST /api/disbursements` | ❌ | ✅ | ❌ |
| **Assign merchant to CO** | `POST /api/users/:id/assign` | ❌ | ✅ | ❌ |
| Merchant lifecycle | `PATCH /api/users/:id/status` | ❌ | ✅ | ❌ |
| Delete merchant (cascade) | `DELETE /api/users/:id` | ❌ | ✅ | ❌ |
| Officer management | `GET/POST/PATCH /api/officers` | ❌ | ✅ | ❌ |
| AI route / rebuttal | `POST /api/optimize-route`, `/rebuttal` | ✅ | ✅ | ✅ |
| AI risk briefing | `POST /api/risk-briefing` | ✅ | ✅ | ✅ |

**Invariants**
1. A lender can never cause a state change to money, assignment, or people.
2. Rill cannot create an `admin`.
3. An admin cannot modify another admin, or their own account, through `/api/officers`.
4. A deactivated officer keeps their credentials but is refused at login — checked
   *after* password verification so the route cannot enumerate accounts.

---

## 4. Merchant lifecycle

```
created ──→ pending ──(disbursement)──→ active ──(admin)──→ deactivated
                                          │                      │
                                          └──── reactivate ──────┘
```

- **pending** — merchant exists, no money out. `balance = 0`.
- **active** — at least one disbursement. Carries `total_owed`, `balance`,
  `daily_installment`.
- **deactivated** — excluded from `/api/today` and from the defaulter list, but all
  history is retained. Reversible.

`DELETE` is separate and irreversible: it removes the merchant *and* every payment,
audit, escalation, disbursement and photo, in one transaction (§8).

---

## 5. Risk status logic

One definition, used identically by the mobile app and the console.

| Band | Condition |
|---|---|
| 🔴 **urgent / defaulting** | `balance > 0` and last payment > **48h** ago (never-paid counts) |
| 🟡 **at risk** | `balance > 0` and last payment 24–48h ago |
| 🟢 **on track** | everything else |

**Never-paid is maximally overdue, not zero.** A merchant who has taken money and
never paid must sort *above* one who paid three days ago — the naive
`now - lastPayment` on a `NULL` yields 0 and buries the worst cases at the bottom.
`GET /api/defaulters` returns `neverPaid: true` and `hoursSinceLastPayment: null` for
this case and sorts it first.

Defaulter ordering: `neverPaid` → longest since payment → largest balance.

---

## 6. Assignment model

An admin assigns a merchant to exactly one CO (`users.assigned_co_id`).

`GET /api/today` for a **`co`** returns merchants that are **assigned to them OR
unassigned**. Merchants assigned to a *different* CO are hidden.

- Hiding another officer's merchants is the point: two officers must never work the
  same merchant.
- Keeping unassigned merchants visible means no merchant is ever invisible to the
  field, and preserves pre-assignment behaviour for a book that has never been
  assigned.
- Admin and lender always see everything.

Assignment targets are validated: the officer must exist, be `role === 'co'`, and be
active. `officerId: null` clears the assignment back to the shared pool.

---

## 7. Data model

```
officers(id, email UNIQUE, password, first_name, last_name,
         role ∈ {co,admin,lender}, active, created_at)

users(id, name, phone, location, group_id,
      total_owed, balance, daily_installment,
      status ∈ {pending,active,deactivated},
      last_payment_date, assigned_co_id, created_at)

payments(id, user_id, amount, method ∈ {cash,pos,transfer},
         officer_id, idempotency_key UNIQUE, timestamp)

disbursements(id, user_id, amount, daily_installment, officer_id, timestamp)
audits(id, user_id, mood, stock_level, traffic, notes, timestamp)
escalations(id, user_id, reason, timestamp)
photos(id, user_id, officer_id, kind ∈ {audit,payment,merchant,escalation},
       mime_type, data /*base64*/, caption, size_bytes, timestamp)
```

**Notes**
- Money is stored as **integer minor units** (whole Naira). No floats.
- All timestamps are `TIMESTAMPTZ`. A migration converts any legacy
  `timestamp without time zone` column, preserving the absolute instant.
- Schema changes ship as **idempotent** additive migrations
  (`ADD COLUMN IF NOT EXISTS` / SQLite `PRAGMA table_info` check) that never fail boot.
- There are **no DB-level foreign keys** (the schema predates them and SQLite needs
  them enabled per-connection). Referential cleanup is therefore explicit — see §8.
- Photos as base64 in-row is a deliberate MVP tradeoff (no object store provisioned).
  It is why the 2MB cap and MIME allowlist are load-bearing. **Migrate to object
  storage before photo volume becomes material.**

---

## 8. Money and data integrity

**Idempotency.** `POST /api/payments` **requires** `idempotencyKey`. A UNIQUE index
enforces it. It cannot be optional: SQL UNIQUE does not treat multiple `NULL`s as
conflicting, so an omitted key silently disables double-payment protection — exactly
when a field officer on a flaky connection retries.

**Transactions.** Disbursement writes the disbursement row *and* updates the
merchant's balance/status atomically. Deletion removes six tables' worth of rows
atomically. A partial write must never leave a half-changed merchant.

**Cascade on delete.** With no DB foreign keys, orphaned payments and photos would
survive a merchant deletion and keep appearing in aggregates. `DELETE /api/users/:id`
removes photos → payments → audits → escalations → disbursements → user, in one
transaction.

**Offline queue (mobile).** A payment recorded without connectivity is queued with the
idempotency key generated *at the moment the officer confirmed it*. A later flush can
therefore never double-record, even if the original request actually landed. Only
network failures are retried; a server rejection (4xx) is surfaced to the officer and
dropped, because the server heard us and said no.

---

## 9. Error contract

Every non-2xx response is renderable by a client without guesswork.

```jsonc
{
  "error":  "Password must be at least 6 characters",  // always present, displayable
  "fields": { "password": "Password must be at least 6 characters" }, // per-input
  "errors": [ /* raw express-validator array, backwards compatibility */ ]
}
```

- `error` is what a banner shows. It is **never** a bare status code.
- `fields` maps input name → message, so a form marks the offending input.
- Clients throw a typed `ApiError` carrying `status` + `fields`.

| Status | Meaning |
|---|---|
| 400 | Validation / business rule. Always carries `fields` where a field is at fault. |
| 401 | Not authenticated, or token expired. Clients sign out and return to login. |
| 403 | Authenticated but not permitted; also a deactivated account, or a bad invite code. |
| 404 | Target does not exist. |
| 413 | Upload too large (photos). |
| 500 | Unexpected. Detail is logged server-side only — never returned. |

**Ordering rule:** the registration invite gate runs *before* field validation, so an
uninvited caller cannot probe which fields exist or what the password policy is.

---

## 10. Security posture

- Passwords: `scrypt` with per-password salt. Legacy plaintext rows are upgraded on
  next successful login, compared in constant time until then.
- Tokens: HMAC-SHA256 signed, 7-day TTL, `role` in the payload — so a role cannot be
  forged client-side. `AUTH_SECRET` must be set in production.
- Rate limiting on all auth routes (fixed window, in-memory — revisit if Rill ever
  runs multiple instances).
- CORS locked to `ALLOWED_ORIGINS` when set. The native client sends no Origin.
- AI routes pass fixed instructions via `systemInstruction` and label the request body
  as untrusted data, with length caps — officer-entered free text is never
  concatenated into the instruction string.
- Photos are auth-gated: field evidence identifies a merchant's premises.
- **Supabase RLS is enabled on all six tables with no policies.** The API connects as
  `postgres` (owner, `rolbypassrls`) so it is unaffected; this closes the public
  PostgREST/anon-key path, which would otherwise expose every row to anyone holding
  the publishable key. Supabase reports `rls_enabled_no_policy` at INFO level — that
  is expected, **do not "fix" it by adding permissive policies.**

---

## 11. Operational invariants

These are the things that have actually broken. Each cost real debugging time.

1. **`DATABASE_URL` must be the Supabase IPv4 *session pooler*.** The direct host
   `db.<ref>.supabase.co` is IPv6-only and Render has no IPv6 route (`ENETUNREACH`).
   The pooler username carries the project ref:
   `postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres`
2. **Render free Postgres expires and is deleted.** Supabase free only pauses. Do not
   move back.
3. **Env changes need a redeploy** — the pg Pool and `process.env` are read at boot.
4. **Expo's transitive native modules must stay hoisted.** `expo-asset`,
   `expo-constants`, `expo-file-system`, `expo-font`, `expo-keep-awake` are declared
   as *direct* dependencies for this reason. `expo-modules-autolinking` only discovers
   top-level modules; when npm nested them the APK shipped without `ExpoAsset` and
   rendered a blank screen. Guarded by `mobile/src/__tests__/nativeModuleLinking.test.ts`.
   Verify with `npx expo-modules-autolinking resolve -p android`.
5. **One Expo project only.** A stray root-level `app.json`/`eas.json` once shadowed
   `mobile/` and made every build target the wrong project.
6. **CI must run the mobile boot test**, not just typecheck — a module-load failure
   type-checks fine and still ships a blank app.

---

## 12. Test strategy

| Suite | Covers |
|---|---|
| `server.test.js` | Core API integration, auth, payments, edge cases |
| `validation-contract.test.js` | §9 error contract on every validated endpoint |
| `roles-privileges.test.js` | §3 matrix, escalation attempts, deactivation, password change |
| `defaulters-assignment.test.js` | §5 status logic, §6 assignment rules and `/today` scoping |
| `photos.test.js` | Upload/validation/retrieval, oversized + malformed payloads, cascade |
| `server-password.test.js` | Hashing, legacy upgrade, constant-time comparison |
| `payment-idempotency-required.test.js` | §8 idempotency enforcement |
| `ai-prompt-injection.test.js` | §10 prompt construction |
| `mobile/src/__tests__/appBoot.test.tsx` | App commits a first frame (blank-screen guard) |
| `mobile/src/__tests__/nativeModuleLinking.test.ts` | §11.4 hoisting guard |

**Rule:** a bug fix ships with a test that fails before it and passes after.

---

## 13. Deliberately out of scope (MVP)

Named so they are decisions, not oversights.

- Merchant-facing surface of any kind.
- Groups / group enforcement (schema has `group_id`; no logic yet).
- Push notifications.
- Object storage for photos (see §7).
- Multi-instance rate limiting and session revocation.
- Partial-payment scheduling beyond a flat daily installment.
