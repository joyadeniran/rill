# Rill Mobile App — Crash Investigation & Hardening Log

**Date:** 2026-06-03
**Branch:** `claude/mobile-app-crash-debug-gIPti`
**Scope:** Diagnose why the Rill field-officer mobile app (Expo SDK 53 / RN 0.79.3 / React 19) crashes, fix the root causes, harden the backend it depends on, add regression tests, and make the stack production-ready.

---

## 1. Method

- Read every mobile source file, the Express backend (`server.js`), tests, and all build/deploy configs (`app.json`, `eas.json`, `codemagic.yaml`, `render.yaml`).
- Deployed two parallel audit agents (mobile + backend) for fan-out coverage.
- **Verified every hypothesis empirically** instead of trusting static reasoning. Installed dependencies and ran the real test suite + TypeScript typecheck.

### Claims that were REFUTED by running the code (important)
- *"Backend tests #3/#5 fail because `better-sqlite3` throws on `undefined` bindings."* — **False.** `npm test` showed **8/8 passing**, and a direct probe proved `better-sqlite3` v12.4.1 **coerces `undefined`→`null`** (it does not throw). Evidence:
  ```
  UNDEFINED BIND: did NOT throw -> rows: [ { id: '1', phone: null, notes: 'x' } ]
  ```
  These findings were therefore **not** treated as root causes. Defensive `?? null` coercion was still added for cross-DB clarity, but it is hardening, not a bug fix.

---

## 2. Root Causes (confirmed, with evidence)

### Mobile (the actual crash surface)

| ID | Severity | Location | Root cause |
|----|----------|----------|------------|
| M1 | **CRASH amplifier** | `App.tsx` | **No Error Boundary.** In a release build there is no RN red-screen; any render exception unmounts the whole tree → hard crash to OS with no recovery. Every render bug below escalates to a full app crash because of this. |
| M2 | **CRASH** | `FieldOfficerApp.tsx:212,216,123` | `merchant.balance.toLocaleString()` / `merchant.dailyInstallment.toLocaleString()` — `null.toLocaleString()` throws `TypeError`. DB `DEFAULT 0` protects *current* rows, but any nullable numeric (future migration, partial payload) crashes the card render. |
| M3 | **CRASH** | `FieldOfficerApp.tsx:62-72 → 93 → 103-106` | `setMerchants(data)` trusts the response is an array. A non-array body (proxy/HTML error page, cold-start body returned with 200) makes `[...merchants].sort()` throw **inside `useMemo` during render** — outside the `fetchData` try/catch — so it crashes. |
| M4 | **CRASH/launch** | `mobile/package.json` | `expo-dev-client` shipped in **`dependencies`** and `metro` **pinned directly** in `dependencies`. Both are well-known Expo anti-patterns: a dev-client module linked into a `assembleRelease` APK and a hand-pinned metro version conflicting with Expo's managed metro cause white-screen / bundler / launch failures. |
| M5 | BUG/RISK | `api.ts:4-7` | Release builds fell back to **cleartext `http://10.0.2.2`** when `EXPO_PUBLIC_API_BASE_URL` was unset — Android release blocks cleartext, so every request fails (functional dead-app). |
| M6 | BUG/RISK | `api.ts:9-24` | **No request timeout.** Render free-tier cold start (30–60s) leaves the UI hung on a spinner indefinitely with no recovery. |

### Backend (cascade / robustness)

| ID | Severity | Location | Root cause |
|----|----------|----------|------------|
| B1 | BUG | `server.js` login route | `/api/auth/login` had **no input validation** → missing fields produced an inconsistent **500 (SQLite/hashed path)** vs 401 (Postgres). |
| B2 | BUG | `server.js` payments | `amount` validated only with `isNumeric()` → a **negative amount inflates the balance** (`balance = balance - (-x)`). |
| B3 | BUG/RISK | `server.js` AI routes | `JSON.parse(response.text || '{}')` throws server-side on malformed/blocked model output → 500; `response.text` may be `undefined`; model `gemini-1.5-flash` is a legacy alias subject to retirement. |
| B4 | RISK | `server.js` initDb | A single `initDb()` rejection (DB unreachable at cold start) was **cached forever** → every subsequent request 500s for the life of the process, with no retry. |

> Out of scope but noted for follow-up: no auth on data endpoints, wide-open CORS, SQLite-vs-Postgres `TIMESTAMP` (no tz) drift affecting `internalStatus`, no auth persistence on the client (re-login every cold start). See §5.

---

## 3. Changes Made

### Mobile
- **`mobile/src/components/ErrorBoundary.tsx`** *(new)* — class error boundary with a friendly fallback + "Try again" reset. Converts crashes into recoverable states (fixes M1).
- **`mobile/App.tsx`** — wrapped `<AuthProvider><AppContent/></AuthProvider>` in `<ErrorBoundary>`.
- **`mobile/src/services/api.ts`**:
  - Production HTTPS fallback (`productionApiBaseUrl`) selected via `__DEV__`; no more silent cleartext-localhost fallback in release (fixes M5).
  - `AbortController` + 30s timeout on every request; friendly timeout/network error messages (fixes M6).
  - Guarded `response.json()` parse on the success path (handles non-JSON 200 bodies).
  - `getTodayRoute()` now returns `[]` if the payload is not an array (fixes M3 at the source).
- **`mobile/src/components/FieldOfficerApp.tsx`**:
  - `Number(merchant.balance ?? 0).toLocaleString()` and same for `dailyInstallment` (fixes M2).
  - `handleRepayment` coerces `balance`/`amount` and guards a zero installment.
  - `optimizeRoute` validates `prioritizedIds` is an array and `reasoning` is a string.
- **`mobile/package.json`** — moved `expo-dev-client` to `devDependencies`; removed the direct `metro` pin (Expo manages it transitively) (fixes M4). Lockfile regenerated.

### Backend (`server.js`)
- Added `body('email').isEmail()` + `body('password').notEmpty()` + `validate` to `/api/auth/login` (fixes B1).
- `/api/payments` `amount` now `isInt({ gt: 0 })` (fixes B2).
- AI layer: configurable `AI_MODEL` (`process.env.GEMINI_MODEL || 'gemini-2.0-flash'`), `safeJsonParse()` helper, route returns a validated `{ prioritizedIds, reasoning }` shape, and `response.text || ''` guards on rebuttal/briefing (fixes B3).
- `initDb` memoization now clears a rejected promise so the next request retries; init middleware returns `503` while initializing instead of poisoning forever (fixes B4).
- Explicit `?? null` coercion for optional insert params in `/api/users` and `/api/audits` (cross-DB hardening).

### Tests (`server.test.js`)
Added 8 regression tests: login missing-fields → 400, wrong creds → 401, full register→login round-trip (and password never leaked), negative & zero payment → 400, audit with only required field → 200, user without phone → 200, and `/api/today` shape assertions (numeric `balance`/`dailyInstallment`, valid `internalStatus`).

---

## 4. Verification (evidence)

```
# Backend test suite
Tests:       16 passed, 16 total      (was 8; +8 new regression tests)

# Mobile TypeScript typecheck
TYPECHECK EXIT: 0  (typecheck OK)

# better-sqlite3 undefined-binding probe
UNDEFINED BIND: did NOT throw -> rows: [ { id: '1', phone: null, notes: 'x' } ]
```

- No source change to root dependencies; the incidental root `package-lock.json` churn (npm `libc` metadata normalization) was reverted to keep the diff clean.
- `metro` confirmed still present in the mobile lockfile as an Expo transitive dependency after removing the direct pin.

---

## 5. Mitigation / Future-Proofing (recommended next, not yet done)

1. **Authn/authz on data endpoints** — issue a token at login; require it on `/api/today`, `/api/payments`, `/api/users`, `/api/escalations`. Today anyone can read merchants and post payments.
2. **Lock down CORS** to known web/mobile origins.
3. **Postgres `TIMESTAMPTZ`** — `TIMESTAMP` (no tz) shifts `internalStatus` thresholds by the server's UTC offset; store/compare in UTC consistently across SQLite and Postgres.
4. **Client auth persistence** — `expo-secure-store` so officers aren't logged out on every cold start (the `loading` state in `AuthContext` is currently dead code).
5. **CI gate** — run `npm test` + `cd mobile && npx tsc --noEmit` on every PR; add `expo-doctor` to the Codemagic pipeline to catch dependency drift.
6. **Crash reporting** — wire Sentry/Crashlytics into the new `ErrorBoundary` to capture production crashes with stack traces.
7. **Render warm-keep** — a scheduled ping (or paid plan) to avoid 30–60s cold-start latency on the free tier.

---

## 6. Follow-up batch #2 (PR #2) — security & CI hardening

Implemented the highest-priority items from §5.

### Backend authentication (was: no auth on data endpoints)
- Dependency-free **HMAC-SHA256 signed bearer tokens** (`signToken`/`verifyAuthToken`), 7-day TTL, signed with `AUTH_SECRET` (random per-process fallback when unset). Signature compared with `timingSafeEqual`.
- `/api/auth/login` and `/api/auth/register` now return `{ officer, token }`.
- New `requireAuth` middleware protects the mobile data endpoints: `/api/today`, `/api/users`, `/api/payments`, `/api/audits`, `/api/escalations`. `/health` and the auth routes stay public.
- Tampered/expired/missing tokens → `401`.
- **AI endpoints (`/optimize-route`, `/rebuttal`, `/risk-briefing`) deliberately left token-free** because the web dashboard (`src/services/gemini.ts`) calls them without a bearer token; protecting them would break the web app. They keep `checkAi`. Unifying web + mobile auth so these can be protected is a tracked follow-up.

### Mobile client
- `setAuthToken()` in `api.ts`; the token is attached as `Authorization: Bearer …` on every request. `AuthScreen` sets it on login/register; `AuthContext.logout` clears it.

### CORS lockdown
- `ALLOWED_ORIGINS` (comma-separated) enables a strict browser allowlist; unset = open (dev/static web). Native app unaffected (no Origin header).

### CI gate
- `.github/workflows/ci.yml` runs backend tests + mobile typecheck on every push/PR to `main`.

### Config
- `.env.example` documents `AUTH_SECRET`, `ALLOWED_ORIGINS`, `GEMINI_MODEL`; `render.yaml` adds `AUTH_SECRET` (`generateValue: true`).

### Verification
```
Backend tests: 19 passed / 19   (+3 security tests: missing / malformed / tampered token → 401)
Mobile typecheck: clean (tsc --noEmit exit 0)
```

> Note: the `officerId` field still travels in the `/api/payments` body. Now that `req.officer` is available from the verified token, a future change should derive it server-side and drop the client-supplied field. Left as-is here to keep the client contract stable within this batch.

---

## 7. Follow-up batch #3 (PR #3) — timezone correctness, server-trusted identity, web prod bug

### Postgres timezone drift (was §5.3)
- All schema timestamp columns changed from `TIMESTAMP` → **`TIMESTAMPTZ`** (`officers`, `users`, `payments`, `audits`, `escalations`). `TIMESTAMP` (no tz) silently dropped the `Z` on insert, shifting the `diffHrs` math in `/api/today` by the server's UTC offset and mis-classifying `internalStatus` (`urgent`/`at-risk`/`on-track`) in production. SQLite is unaffected (it stores the ISO text and `new Date()` parses it as UTC). *Note: `CREATE TABLE IF NOT EXISTS` does not alter pre-existing Postgres tables — a fresh DB (or a manual `ALTER COLUMN ... TYPE timestamptz`) is required to pick this up.*

### Server-trusted officer identity
- `/api/payments` now records the officer from the **verified token** (`req.officer.sub`) instead of the client-supplied `officerId`, which could be spoofed. The `body('officerId')` validator was dropped; the body value is only a backward-compat fallback. Returns `400` if no identity can be resolved.

### Web dashboard production bug
- `src/services/gemini.ts` had `API_BASE = 'http://localhost:3001/api'` hard-coded, which breaks the deployed dashboard. Changed to a same-origin relative `'/api'` (the Express server serves the web app from `dist`), overridable via `VITE_API_BASE`.

### Verification
```
Backend tests:   19 passed / 19
Web typecheck:   tsc --noEmit clean
Web build:       vite build OK (exit 0)
Mobile typecheck: clean
```

---

## 8. Follow-up batch #4 (PR #4) — Postgres migration, verified against a real DB

PR #3 changed the `CREATE TABLE` definitions but `CREATE TABLE IF NOT EXISTS` does **not** alter existing tables, so the **live Render DB still had the buggy `timestamp without time zone` columns** — the §7 fix wasn't actually in effect on the deployment.

### What was added
- **`migratePostgresTimestamps()`** — runs at init (Postgres only). Idempotent: it only converts columns whose type is still `timestamp without time zone` (checked via `information_schema`), so re-running is a no-op and can never double-shift. Each column failure is non-fatal and logged.
- **`PGSSL=disable`** escape hatch for non-SSL Postgres (server.js previously hard-coded SSL on, which fails against a local/self-hosted DB).

### The verification caught a real bug in the migration
A first attempt converted with `AT TIME ZONE current_setting('TimeZone')`. Standing up a **real Postgres 16** and testing under a non-UTC session (`America/New_York`) showed it **shifted every payment timestamp by the server offset** (10:00Z → 14:00Z) — the exact bug class being fixed. Root cause: inserting a `…Z` ISO string into a tz-less column makes Postgres **strip** the zone and store the literal UTC wall-clock, so the correct conversion is `AT TIME ZONE 'UTC'`. Re-tested under UTC, `America/New_York`, and `Asia/Kolkata`: instant preserved in all three, idempotent, type converted.

### Full app exercised against real Postgres (a first — tests previously only ran on SQLite)
Booted `server.js` against a live Postgres 16 with a seeded legacy `payments` table and confirmed: `/health` reports postgres, register→token, user create, **payment derives officer from the token** (no `officerId` in body), `/api/today` returns the correct shape (validating the `?`→`$n` placeholder translation and the date math), unauthenticated `/api/today` → 401, and the **legacy `payments.timestamp` was migrated to `timestamptz`**.

---

## 9. Follow-up batch #5 (PR #5) — Mobile hardening & spec completion

Implemented the remaining production-readiness items from §1–§8 and fulfilled the core feature set from `RILL_SPEC.md`.

### Mobile Production Hardening
- **Asset Configuration:** Updated `app.json` with production paths for `icon`, `splash`, and `adaptiveIcon`. Added explicit iOS `bundleIdentifier` and Android `package`.
- **Permissions:** Added `NSLocationWhenInUseUsageDescription` (iOS) and `ACCESS_FINE_LOCATION` (Android) to support route intelligence.
- **Entry Point Fix:** Resolved a Metro bundler error (`Unable to resolve module ../../App`) by switching from `node_modules/expo/AppEntry.js` to a local `index.js` entry point.
- **EAS & CD:** Configured `eas.json` with `production`, `preview`, and `development` channels.
- **Quality Tools:** Integrated **ESLint** (Expo Universe) and **Prettier**.
- **Testing:** Added **Jest** + **React Native Testing Library**; created `mobile/src/services/__tests__/api.test.ts`.

### Feature Completion (RILL_SPEC.md)
- **Call Action:** Integrated `react-native` `Linking` to allow COs to call merchants directly from the card list.
- **User History:** 
  - **Backend:** Added `GET /api/users/:id/history` returning unified payment + audit logs.
  - **Mobile:** Implemented a new **History Modal** showing chronological activity for a specific borrower.
- **AI Optimization:** Refined the `optimize-route` prompt to prioritize merchants by **balance owed** and **last payment recency** in addition to their internal status.
- **UI UX:** Updated the merchant action row to be responsive (flex-wrap) and added a "Call" button with a high-contrast style.

### Assets
- Created placeholder icon/splash assets to enable local builds.
- Successfully imported a user-supplied high-fidelity icon and propagated it to the splash and adaptive-icon slots.

### Verification
- `mobile/index.js` verified as a valid entry point.
- `package.json` scripts (`lint`, `test`, `typecheck`) added and verified.
- Backend history endpoint verified for cross-compatibility with the mobile service layer.

---

## 10. Production-readiness execution (2026-07-09) — Rill as Supplya's collection-officer tool

Full audit in `PRODUCTION_READINESS.md`; this batch executed it. Decisions by
Joy: standalone pilot (own DB), production bar, admin = existing Supplya admin
account (zero supplya-backend changes), overpayment rejected, admin dashboard
wired minimally, infra stays free (Supabase Postgres + Render free web).

### Commits
- `5e31d58` deps: expo-updates ~56.0.17 (SDK-56 line on an SDK-53 app — launch
  breaker) → ~0.28.18 per expo 53.0.27 bundledNativeModules; pinned
  react-test-renderer 19.0.0 (fixes ERESOLVE that would break CI's plain
  `npm install`); added expo-secure-store + async-storage.
- `869dc56` backend P0s (test-first, +19 tests): POST /api/disbursements
  (admin-only, transactional, activates merchant — the missing core loop);
  PATCH /api/users/:id/status; officers.role + requireRole (idempotent
  migration verified against a legacy-schema DB); registration gated by
  REGISTRATION_INVITE_CODE; POST /api/auth/admin-login proxies the existing
  supplya-backend /auth/login and mints a Rill admin token only for
  role=admin (password never trimmed); payments now validate user existence
  (404), overpayment (400), method whitelist, and dedupe on idempotencyKey
  via unique index (concurrent-safe).
- `(mobile)` payment form (editable amount default installment-capped-at-
  balance, cash/pos/transfer, confirmation dialog, in-flight disable);
  idempotency keys on every payment; offline payment queue in AsyncStorage
  (sync on refresh, per-merchant pending guard, server rejections surfaced);
  session persisted in expo-secure-store with expiry check + 401 auto-logout;
  crash guards (nullable audit mood `.toUpperCase()` TypeError, history array
  shapes, numeric coercions); history shows disbursements.
- `(admin+hardening)` real admin console replacing the Firebase/mock
  prototype (Supplya admin sign-in, merchants table, disburse modal,
  activate/deactivate, escalations feed); GET /api/users + /api/escalations
  (admin-only); requireAuth on all three AI endpoints; fixed-window rate
  limit on auth routes (AUTH_RATE_LIMIT, default 30/10min/IP); 500 handler
  no longer leaks err.message; tsconfig self-contained (was extending
  expo/tsconfig.base with no expo dep); firebase dep removed.
- Infra: Supabase free Postgres provisioned (project `hootlycsbaxvtetrrpub`,
  us-west-1, $0/mo, schema pre-applied and verified); render.yaml now takes
  DATABASE_URL manually (session-pooler string) and drops the expiring
  Render free DB.

### Verification (final tree)
```
Backend:  42/42 tests green (incl. legacy-DB migration run)
Mobile:   tsc --noEmit exit 0 · jest green
Web:      tsc --noEmit exit 0
Diff:     re-read against supplya invariants — no req.body mass-assign, no
          password trim, no client-trusted amounts, no supplya-backend edits
```

### Joy action items (deploy)
1. Supabase dashboard → Project Settings → Database → get/reset the DB
   password; build the session-pooler DATABASE_URL (comment in render.yaml).
2. Render dashboard → set DATABASE_URL; confirm REGISTRATION_INVITE_CODE
   generated; share it with COs out-of-band.
3. If the Render service is NOT in Oregon, say so — the Supabase project can
   be recreated free in a closer region.
4. Old Render DB: take a final dump if any pilot data matters (free DBs get
   deleted on expiry).
5. Rebuild the APK (deps changed): codemagic or `eas build`. Update the
   placeholder email in codemagic.yaml publishing block.

### Known residual limitations (accepted, documented)
- Concurrent payments to the same merchant can race the balance check
  (single-CO-per-merchant makes this unlikely; revisit with SELECT FOR UPDATE
  if officer territories overlap).
- Rate limiter and auth tokens are in-memory/stateless per instance — fine on
  a single Render instance; revisit before horizontal scaling.
- No payment reversal endpoint yet (admin correction path) — next batch.
- Render free web cold starts (30-60s) remain; mobile handles with 30s
  timeout + retry + offline queue. Consider an uptime ping.

### CI fix (post-merge)
- Root `npm test` collected `mobile/**/api.test.ts` (TS, unparseable by root
  jest) → CI "Backend tests" red. Added `/mobile/` to root jest
  `testPathIgnorePatterns`. Reproduced red, verified green with the exact CI
  command. Mobile tests still run via `cd mobile && jest` (jest-expo).

---

## 2026-07-11 — Cross-repo Supplya audit follow-up: F20/F21/F30 fixed

Three findings from the same-day Supplya 4-repo audit, deferred from the
initial fix pass and closed out here. All test-first; full suite green
(4 suites, 60 tests) plus `npm run lint` (tsc --noEmit) clean.

### Environment fix (required before any test could run)
- `better-sqlite3@^12.4.1`'s installed native binding (12.6.2) was compiled
  against an older Node ABI (NODE_MODULE_VERSION 141) than the local Node
  26.4.0 requires (147) — `npm rebuild` failed (node-gyp/V8 header
  incompatibility with this Node version). Bumped to `better-sqlite3@12.11.1`
  (still within the `^12.4.1` range), which shipped a prebuilt binding that
  loads correctly. Verified: baseline `npm test` went from "Test suite
  failed to run" to 42/42 passing before any of the fixes below were made.

### [CRIT-B21-rill / F21] Legacy plaintext-password comparison was not constant-time
`verifyPassword`'s pre-hash migration path (`server.js`) did `password ===
storedPassword` for accounts created before `hashPassword` was added — `===`
short-circuits on the first mismatched byte, leaking via response timing how
many leading characters of a guessed password are correct. The migration
path itself is legitimate and was kept (an account is upgraded to a hash on
its next successful login, in `login()`) — only the comparison was fixed.
- **server.js**: added `constantTimeStringEqual(a, b)` — HMACs both inputs
  to a fixed-length digest, then `crypto.timingSafeEqual`s the digests
  (sidesteps `timingSafeEqual`'s equal-length-buffer requirement without
  weakening the comparison — a digest mismatch implies an input mismatch).
  `verifyPassword`'s legacy branch now calls it instead of `===`.
- **server.js**: added a named export block (`hashPassword`,
  `isHashedPassword`, `verifyPassword`, `constantTimeStringEqual`) alongside
  the existing `export default app` — these weren't practically testable
  through the HTTP layer alone.
- **server-password.test.js** (new): 10 tests covering the hashed path
  (unchanged behavior), the legacy path (correct/wrong/near-miss-prefix
  passwords), and `constantTimeStringEqual` directly (including a source
  check that `verifyPassword` no longer contains `password ===
  storedPassword`).

### [CRIT-B27 / F20] Payment idempotencyKey was optional
`POST /api/payments`'s dedup logic only protects a retry that sends the same
`idempotencyKey` — a client that omits it entirely (or retries twice with no
key) gets zero double-payment protection, since SQL UNIQUE indexes don't
treat multiple NULLs as conflicting. The mobile field-officer app
(`mobile/src/services/api.ts`, `mobile/src/components/FieldOfficerApp.tsx`)
already types `idempotencyKey` as required and always sends one, so
enforcing it server-side is a safe tightening, not a breaking change.
- **server.js**: added `body('idempotencyKey').notEmpty()` to the route's
  validation chain.
- **payment-idempotency-required.test.js** (new): 3 tests — missing key
  rejected, empty-string key rejected, valid key succeeds.
- **server.test.js**: updated 6 existing `/api/payments` calls that omitted
  `idempotencyKey` (they were asserting unrelated 400/404 outcomes — balance
  exceeded, unknown user, invalid method, negative/zero amount — and broke
  once the field became required); added one new explicit
  "no idempotencyKey -> 400" test to the "Roles, disbursements & payment
  integrity" suite.

### [CRIT-B28 / F30] AI prompt construction concatenated untrusted text with instructions
`/api/rebuttal` and `/api/risk-briefing` built their Gemini prompts by
string-concatenating officer-entered free text (a merchant's stated
`excuse`, `merchantName`, audit `notes` embedded in `logs`/`merchants`)
directly with the fixed instructions — a classic prompt-injection shape.
Both endpoints require auth and only return advisory text (no tool use, no
money movement), so this is hardening, not a critical fix — but there was no
defense at all.
- **server.js**: both routes now pass the fixed instructions via
  `config.systemInstruction` (the Gemini SDK's recommended separation — the
  model treats it with more authority than inline conversational text) and
  clearly label the request body as untrusted data to summarize/quote, never
  as instructions. `/api/rebuttal` additionally length-caps `merchantName`
  (200 chars) and `excuse` (2000 chars) via `express-validator`, bounding
  the size of any injection payload.
- **ai-prompt-injection.test.js** (new): 4 structural tests (GEMINI_API_KEY
  isn't configured in this test environment, so `checkAi` 503s before the
  actual model call — these verify the prompt-construction source directly):
  `systemInstruction` is used on both routes, the old
  instructions-and-user-data-in-one-template-literal shape is gone from
  `/api/rebuttal`, and `excuse` has a length cap.

### Verification
```
npm test:  4 suites, 60 tests passing (was 1 suite, 42 tests before the
           better-sqlite3 fix unblocked the run)
npm run lint (tsc --noEmit): clean
```


---

## Expo Build Failure — Root Cause & Fix

**Date:** 2026-07-23
**Scope:** "Expo build is never successful" — diagnose why, fix carefully, address the cascade, unhandled exceptions and edge cases.

### Method
Reproduced the real pipeline locally before changing anything, instead of guessing:
- `npm ci` in `mobile/` — lockfile valid, 1040 packages, RN 0.79.6 / expo 53.0.27 resolved.
- `npx expo prebuild --platform android --no-install --clean` — succeeded.
- `npx expo export --platform android` — Metro bundled 580 modules → 1.84 MB hbc, no errors.
- `npx eas-cli config` run from **both** the repo root and `mobile/`, then diffed — this is what exposed the root cause.
- Inspected asset PNGs (valid 1254×1254 square), `expo-doctor` (16/18), and the generated `AndroidManifest.xml`.

### Root cause (confirmed by diffing `eas config` output)
**Two Expo projects in one repo; the wrong one was winning.** The repo root carried its own `app.json` + `eas.json`. An `eas build` run from the repo root (the natural thing to do — and the tracked root `.expo/` directory proves it happened) resolved to the *web* project, not the mobile app:

| | Root config (wrong) | `mobile/` config (correct) |
|---|---|---|
| name / slug | `react-example` | `Rill CO` / `rill` |
| version | `0.0.0` | `1.0.0` |
| platforms | `["web"]` — no android/ios | ios, android, web |
| EAS projectId | `479cdb23-…` | `f82dddaf-…` |
| bundle id | `com.suppplya.rill` (typo, 3 p's) | `com.supplyashop.rill` |

The root `package.json` has **no `expo` and no `react-native` dependency** — it is the Vite web app. A native build from that directory cannot succeed. The real `mobile/` project was never the thing being built.

### Fixes applied

**Primary**
- Deleted root `app.json` and `eas.json` (recoverable via git) — they pointed at a different EAS project with a typo'd bundle id and no native platforms.
- Untracked `.expo/` and `mobile/.expo/` (machine-specific state that had been committed) and added `.expo/` to root `.gitignore`.
- Added `mobile:build:android` / `mobile:build:ios` / `mobile:build:preview` scripts to the root `package.json`, each `cd mobile` first, so the correct invocation is discoverable and the directory mistake cannot recur.

**Cascade — config declared but inert**
- `mobile/app.json`: all three `eas.json` profiles declare a `channel` and `expo-updates` is a dependency, but there was no `updates.url` or `runtimeVersion` — the generated manifest had `expo.modules.updates.ENABLED=false`, so OTA was silently dead and `eas build` warns about the orphaned channels. Added `updates.url` + `runtimeVersion: appVersion`; manifest now emits `ENABLED=true`. `fallbackToCacheTimeout: 0` keeps it non-blocking at launch. **Behavior change:** builds now check for updates on launch.
- Added `expo-system-ui` — prebuild warned that `userInterfaceStyle: "light"` is inert without it, leaving the app exposed to Android dark mode despite hardcoded light colors.
- Set `android.edgeToEdgeEnabled: false` explicitly, pinning current behavior instead of relying on a fallback that flips in SDK 54.

**`codemagic.yaml` — same class of bug as the prior lockfile-drift commit**
- `npm install` → `npm ci`: `npm install` ignores lockfile drift; this is exactly how installed `react-native` had drifted to 0.79.3 against a locked 0.79.6.
- Stopped caching `mobile/node_modules` — a stale cache is the other half of that drift.
- Pinned `java: 17` (RN 0.79 / AGP 8 fail on the JDK 21 default on newer CI images).
- `--clean` on prebuild so a cached `android/` can't shadow `app.json`.
- `set -euo pipefail` on every script so a failing step fails the build instead of passing through.
- Removed the dead global `eas-cli` install step; replaced the `your-email@example.com` placeholder with `hi@supplya.shop`.

### Verification
```
expo-doctor:   18/18 checks passed (was 16/18)
tsc --noEmit:  clean
expo prebuild --clean: clean, 0 warnings (was 2)
expo export --platform android: 580 modules, 1.84 MB bundle
mobile jest:   1/1 passing
root npm test: 4 suites, 60 tests passing
```

### Not verified locally (no JDK / Android SDK on this machine)
- `./gradlew assembleRelease` was not run — everything up to the native compile step is confirmed; the Gradle step itself is unproven here.
- The Expo template's `release` buildType falls back to the **debug keystore**: the codemagic APK is fine for internal distribution but is **not Play Store uploadable**. A real keystore must be wired via Codemagic code signing before publishing. (Comment left in `codemagic.yaml`.)


---

## Blank Release APK — Fix (expo-updates disabled/removed)

**Date:** 2026-07-23
**Symptom:** The first successful APK opened to a completely blank screen — not even the "Loading Rill CO…" spinner.

### Diagnosis (evidence + honest limits)
- Startup path: `index.js` → `App.tsx` renders `loading=true` first frame → a light screen + spinner. "Nothing at all" ⇒ failure is **before React's first commit** (native bundle-loading or a module-load throw), which the `ErrorBoundary` cannot catch (it only catches render errors in its children). Evidence: `App.tsx:10-18`, `ErrorBoundary.tsx:26-40`.
- **Leading suspect = the `updates` config added in the prior session.** Enabling expo-updates flips the manifest to `ENABLED=true`, making expo-updates *mediate which JS bundle loads at launch*. In a bare `gradlew assembleRelease` build (not `eas build`), the embedded-update step isn't reliably wired, so it can have no bundle to load → blank. Evidence: `app.json` updates block; prebuild manifest `ENABLED true→false`; `grep expo-updates android/app/build.gradle` empty.
- **expo-updates is not referenced anywhere in app code** (`grep -rn "expo-updates\|Updates\."` → none) — it was pure risk surface for an app that doesn't use OTA.
- Device confirmation was **not possible**: Expo Go on the test iPhone is SDK 54 vs. project SDK 53 (incompatible), and an EAS dev build was too slow. So the cause remains **suspected, not device-verified** — but the JS boot graph is proven healthy by the new boot test (module imports don't throw under jest), which points away from a JS/native-link cause and toward the release-only updates path.

### Fix applied
- `mobile/app.json`: removed the `updates` and `runtimeVersion` blocks. Generated manifest now emits `expo.modules.updates.ENABLED=false` → RN loads the embedded bundle directly (the safe pre-change path). Bundle still embeds (`bundleCommand = "export:embed"`).
- `mobile/eas.json`: removed the `channel` keys from all three profiles (they require expo-updates).
- `mobile/package.json` + lockfile: removed the dead `expo-updates` dependency.
- `mobile/src/__tests__/appBoot.test.tsx` (new): renders `<App/>` and asserts the first frame ("Loading Rill CO…") mounts — a regression guard for the blank-screen class — plus asserts `app.json` does not re-enable updates.
- `.github/workflows/ci.yml`: mobile job now runs `npm ci` + `npx jest` (was typecheck-only), so a boot regression fails CI before an APK is built.

### Verification
```
tsc --noEmit: clean
jest: 3/3 passing (incl. new boot test)
expo-doctor: 18/18
prebuild --clean: manifest ENABLED=false, bundle embeds
```

### Explicitly NOT changed (reserved for evidence)
- New Architecture stays ON (`newArchEnabled=true`). If the next build is still blank, that is the next suspect (S2) — but disabling it is a human decision, not a blind edit.
- `session.ts tokenExpiryMs` reads `split('.')[0]` (JWT header, not payload) — a real but separate bug, out of scope for the blank screen.


---

## Blank/Crashing APK — ACTUAL Root Cause Found (unhoisted expo modules)

**Date:** 2026-07-23
**Status:** Root cause identified from device evidence. **This supersedes the previous entry's hypothesis.**

### Correction to the prior entry
The previous fix removed `expo-updates` on the theory that it mediated bundle loading and caused the blank screen. **That hypothesis was wrong.** Removing expo-updates was harmless cleanup (the app never used OTA), but it was not the cause. The real cause was found only once device logs were captured.

### Evidence (adb logcat, Infinix X6531B, package com.supplyashop.rill)
```
E ReactNativeJS: Cannot find native module 'ExpoAsset', js engine: hermes
W ReactNativeJS: No native ExponentConstants module found, are you sure
                 the expo-constants's module is linked properly?
E ReactNativeJS: Invariant Violation: "main" has not been registered.
                 * A module failed to load due to an error and
                   `AppRegistry.registerComponent` wasn't called.
```
That last line **is** the blank screen: a native module fails to resolve → the JS module graph throws during load → `registerRootComponent` never runs → nothing is ever registered to render.

### Root cause
`expo@53.0.27` declares `expo-asset`, `expo-constants`, `expo-file-system`, `expo-font` and `expo-keep-awake` as direct dependencies. npm was placing all five **nested** at `node_modules/expo/node_modules/<name>` instead of hoisting them to the top level.

**`expo-modules-autolinking` only discovers TOP-LEVEL modules.** Confirmed directly:
```
before:  expo, expo-modules-core, expo-secure-store, expo-system-ui        (4)
after:   + expo-asset, expo-constants, expo-file-system, expo-font,
           expo-keep-awake                                                 (9)
```
So those five native modules were never compiled into the APK — the app shipped without `ExpoAsset`/`ExpoConstants` and died at launch. This is why the app had **never** rendered, from the very first build.

Notably there was **no version conflict** forcing the nesting (`expo-asset` had exactly one requirement, `~11.1.7`, from `expo` itself) and no `.npmrc`/`install-strategy` override — `npm explain` showed a single clean chain. A full `rm -rf node_modules package-lock.json && npm install` still nested them, so this is an npm placement quirk with the `expo` meta-package, not a corrupt lockfile.

### Fix
- `mobile/package.json`: declared the five modules as **explicit direct dependencies** (via `npx expo install`), which forces top-level placement where autolinking finds them. Verified with `expo-modules-autolinking resolve -p android` — the exact command Gradle consumes — now reporting all 9 modules.
- `mobile/app.json`: `expo install` added the `expo-asset` and `expo-font` config plugins.
- `mobile/src/__tests__/nativeModuleLinking.test.ts` (new): asserts each of the five resolves at top-level `node_modules` **and** is declared a direct dependency. Fails if anything un-hoists them again.

### Verification
```
expo-modules-autolinking resolve -p android: 9 modules (was 4)
tsc --noEmit: clean
jest: 13/13 passing
expo-doctor: 18/18
```

### Still unproven
The fix is verified at the autolinking/build-config layer but **not yet on a device** — that requires a new APK. New Architecture remains ON and was never implicated by the logs.
