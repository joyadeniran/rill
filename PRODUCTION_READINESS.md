# Rill — Production Readiness Audit & Plan

**Date:** 2026-07-08 · **Auditor:** Claude (with Joy)
**Context:** Rill is Supplya's collection-officer tool. Decision: **standalone pilot first** (own DB, no supplya-backend integration yet), audited to a **production-rollout bar**. Scope: CO mobile app + Express backend; web dashboards checked for security exposure only.

**Checks run (evidence, not assumption):**
- Backend: `npm test -- server.test.js` → **19/19 passed** (Linux sandbox, better-sqlite3 rebuilt from source)
- Mobile: `tsc --noEmit` → **exit 0** (install required `--legacy-peer-deps`; see F9)

---

## Verdict

The stack is well-hardened at the transport/crash layer (5 PR batches: token auth, timestamptz, error boundary, timeouts — all confirmed present in code). But **the core collection loop cannot run in production**: there is no way to put money on a merchant's book, so there is nothing to collect. Plus two money-integrity gaps that violate the platform's own "idempotency is the backbone" principle.

---

## Findings

### P0 — Blockers (loop broken / money integrity / access control)

**F1. No disbursement path — the product's core loop is incomplete.**
- Evidence: `RILL_SPEC.md` §6 requires `POST /disbursements` (sets `total_owed`, `balance`, status→active). `server.js` has **no** disbursements endpoint or table (grep: zero hits). No endpoint sets `balance`/`daily_installment` except payments, which only decrement (`server.js:442`). Users are created with balance 0, status `pending` (`server.js:421-423`).
- Cascade: mobile blocks Log Payment when balance ≤ 0 or installment ≤ 0 (`mobile/src/components/FieldOfficerApp.tsx:124-130`). The Admin dashboard that should trigger disbursement runs on **mock data** (`src/components/AdminDashboard.tsx:39` imports `MOCK_*`).
- Net: no merchant can ever owe money in Rill → the CO app has nothing to do.

**F2. Open officer self-registration.**
- `POST /api/auth/register` is public (`server.js:338`). Anyone who finds the URL can mint a CO account, read the entire merchant book (`/api/today`), create borrowers, and post payments that mutate balances.

**F3. Payment writes are not idempotent, not validated against the ledger, not reversible.**
- No idempotency key (`server.js:426-446`). Mobile has a 30s abort (`mobile/src/services/api.ts:20`) + refetch: a request that succeeds server-side but times out client-side and is retried = **double balance decrement**.
- No check that `userId` exists — payment against a nonexistent user returns `success: true` (INSERT succeeds, UPDATE matches 0 rows).
- No overpayment floor — balance can silently go negative.
- No reversal/void endpoint — a mis-tap is permanent.

**F4. Render free-tier database.** `render.yaml` pins `plan: free` for both service and `rill-db`. Free Postgres on Render is time-limited and gets deleted after expiry (verify exact current policy in Render docs); free web services cold-start 30–60s. For a production money book this is unacceptable infrastructure. (Suspected on exact expiry terms; the plan line itself is verified.)

### P1 — Must fix before production

**F5. CO cannot record what was actually collected.**
- Amount is hardcoded to `dailyInstallment` and method to `'cash'` (`FieldOfficerApp.tsx:121-138`). No amount input, no method picker (spec §5 requires transfer/cash/pos), no confirmation dialog before a money write. Partial or excess payments are unrecordable → the book will not reconcile with cash in hand, and COs will invent workarounds.

**F6. No auth persistence on mobile.** `mobile/src/contexts/AuthContext.tsx` holds the session in `useState` only; every app kill forces re-login (acknowledged in `log.md` §5.4, never implemented). Field officers on cheap Android phones will hit this constantly.

**F7. No offline tolerance.** Every action requires a live request. Nigerian market environments = intermittent connectivity. Minimum bar: payment submissions queue locally and retry safely (depends on F3 idempotency keys).

**F8. AI endpoints unauthenticated.** `/api/optimize-route`, `/api/rebuttal`, `/api/risk-briefing` (`server.js:463,497,507`) — deliberate gap (log.md §6) because the web dashboard calls them tokenless (`src/services/gemini.ts:6-14`). Anyone can burn Gemini quota. Mobile already sends a Bearer token to them.

**F9. Uncommitted dependency changes; one is a suspected breaker.**
- `mobile/package.json` (uncommitted) adds `expo-updates@~56.0.17` against **Expo SDK 53** — resolves to 56.0.21, an SDK-mismatched line. Suspected runtime/build breakage, unverified. Correct move: `npx expo install expo-updates` (picks the SDK-53-matched version). Also note `spec.md` §5.1 OTA env-loading gotcha in supplya-mobile applies conceptually here too.
- Root `package.json` (uncommitted) removes a stray `expo` dep — correct, but commit it.
- Side effect observed: mobile `npm install` now fails with ERESOLVE (`react-test-renderer@19.2.7` peer wants `react@^19.2.7`, project has 19.0.0) unless `--legacy-peer-deps` is used. CI uses plain `npm install` → **CI mobile job will break** on any lockfile regeneration.

**F10. No status lifecycle.** Nothing ever sets `active` or `deactivated` (grep: only the default `'pending'` at `server.js:422` and the filter at `server.js:384`). Resolves naturally with F1 (disbursement activates) + an admin deactivate endpoint.

### P2 — Production hardening

- **F11.** No rate limiting on `/api/auth/*` — brute-forceable officer passwords.
- **F12.** No token revocation: 7-day TTL, a dismissed officer keeps access; rotating `AUTH_SECRET` logs out everyone at once.
- **F13.** Every CO sees the whole book (`/api/today` has no officer/territory scoping) — fine for a small team, a product decision before scale.
- **F14.** `method` accepts any string (`server.js:431,441`) — add `isIn(['cash','pos','transfer'])`.
- **F15.** Error handler leaks `err.message` to clients (`server.js:523`).
- **F16.** `users.last_payment_date` (date-only, `server.js:443`) duplicates `MAX(payments.timestamp)` — two sources of truth that can drift.
- **F17.** CI runs backend tests + mobile typecheck only — mobile jest suite and lint aren't gated; `codemagic.yaml` publishing email is still `your-email@example.com`.
- **F18.** Web dashboards are Firebase + mock data, disconnected from the real DB (`src/firebase.ts`, `src/contexts/AuthContext.tsx`, `AdminDashboard.tsx:39`). They ship in the same `dist` the server serves. Decide: wire to the real API (they're the natural admin surface for F1) or cut them from the build.
- **F19.** Plaintext-password fallback in `verifyPassword` (`server.js:122-125`) — dormant legacy path; remove once confirmed no plaintext rows exist.

### What's already solid (verified)
HMAC tokens with `timingSafeEqual` + TTL (`server.js:144-169`); officer identity derived from token not body (`server.js:435`); payments wrapped in a transaction (`server.js:439`); idempotent timestamptz migration (`server.js:259-280`); server-side amount validation `isInt({gt:0})`; mobile error boundary, request timeouts, array-shape guards; CI exists; `AUTH_SECRET` auto-generated in render.yaml; scrypt password hashing with per-user salt.

---

## Plan (execute per executor-discipline: one step, verify, then next)

**Regression gate after every step:** `npm test -- server.test.js` (all pass) · `cd mobile && npx tsc --noEmit` (exit 0). Log each change to `log.md` as you go.

### Phase 0 — Hygiene (½ day)

**Step 0.1 — Fix and commit the dependency changes (F9).**
- Files: `mobile/package.json`, `mobile/package-lock.json`, root `package.json`, root `package-lock.json`.
- Change: revert `expo-updates: ~56.0.17`; run `npx expo install expo-updates` inside `mobile/` on the Mac (SDK-matched version). Keep the root `expo` removal. Resolve the `react-test-renderer` peer conflict (align it to the react version RN Testing Library expects) so plain `npm install` works again — do NOT paper over with `--legacy-peer-deps` in CI.
- Verify: fresh `npm install` in `mobile/` succeeds with no flags; `npx expo-doctor` clean; `npx tsc --noEmit` exit 0; CI green.
- Commit before starting Phase 1.

### Phase 1 — P0s (the loop + money integrity) (3–5 days)

**Step 1.1 — Disbursement endpoint + status transition (F1, F10).**
- Files: `server.js`, `server.test.js`.
- Change: `disbursements` table (id, user_id, amount, daily_installment, officer_id, timestamp TIMESTAMPTZ). `POST /api/disbursements` (admin-gated per Step 1.2): validates user exists, `amount isInt({gt:0})`, `dailyInstallment isInt({gt:0})`; in one transaction inserts the row and updates `users` (`total_owed += amount`, `balance += amount`, `daily_installment = ?`, `status = 'active'`). Include disbursements in `GET /api/users/:id/history`.
- Tests first: disburse→user active with correct balance; disburse to nonexistent user → 404; non-admin token → 403; amount 0/negative → 400.
- Do NOT touch: `/api/payments` logic, `/api/today` status math.

**Step 1.2 — Roles + close open registration (F2).**
- Files: `server.js`, `server.test.js`, `.env.example`, `render.yaml`.
- Change: add `role TEXT DEFAULT 'co'` to officers (idempotent migration like the timestamptz one). Token payload gains `role`; `requireRole('admin')` middleware. Gate `POST /api/auth/register` behind `REGISTRATION_INVITE_CODE` env (400/403 without the correct code) — simplest invite model; admin-created officers can come later. First admin: one-time bootstrap via env-designated email or manual DB update — **ask Joy which**.
- Tests first: register without code → 403; with code → ok, role 'co'; disburse with co token → 403.

**Step 1.3 — Payment integrity (F3).**
- Files: `server.js`, `server.test.js`, `mobile/src/services/api.ts`, `mobile/src/components/FieldOfficerApp.tsx`.
- Change: payments table gains `idempotency_key TEXT UNIQUE`; client generates a UUID per submission attempt (regenerated per user tap, reused across automatic retries); duplicate key → return the original result (200, `duplicate: true`), no second decrement. Validate user exists (404 otherwise). Reject `amount > balance` (400) — overpayment policy is a product question; default reject, **ask Joy** if COs need to accept excess. Reversals: defer to admin surface (Phase 3), but log the decision.
- Tests first: same key twice → one payment row, one decrement; unknown user → 404; amount > balance → 400.

**Step 1.4 — Infrastructure off free tier (F4).**
- `render.yaml`: paid plan for service + DB; confirm current Render free-Postgres expiry policy and take a manual dump of the existing DB **before** anything else in this phase touches prod. Set `ALLOWED_ORIGINS`. Joy action item (billing).

### Phase 2 — P1s (field reality) (3–5 days)

**Step 2.1 — Real payment entry UX (F5).** Amount input (default = installment), method picker (cash/pos/transfer, backend `isIn` — F14 rides along), confirmation dialog showing name + amount before submit, button disabled while in-flight. Files: `FieldOfficerApp.tsx`, `api.ts`, `server.js` validator. Tests: backend method validation; manual on-device check of the dialog flow.

**Step 2.2 — Auth persistence (F6).** `expo-secure-store` (`npx expo install`); persist `{token, userData}`; restore on boot behind the existing `loading` state (it's currently dead code — this makes it real); validate restored token expiry client-side; logout clears store. Verify: kill app → still signed in; expired token → clean re-login.

**Step 2.3 — Auth on AI endpoints (F8).** Add `requireAuth` to all three AI routes. Web dashboard breaks → acceptable if Step 3.1 decision is "cut web"; otherwise web gets a login first. Sequence this after the F18 decision.

**Step 2.4 — Offline queue for payments (F7).** Minimum viable: on network failure, queue the payment (with its idempotency key from 1.3) in AsyncStorage; visible "pending sync" badge; retry on foreground/refresh. Do NOT build general offline-first sync — payments only.

### Phase 3 — Hardening + admin surface (1 week, parallelizable)

- **Step 3.1 — Decide web dashboards (F18), ask Joy:** wire Admin dashboard to the real API (becomes the disbursement/reversal/officer-management surface) **or** cut `dist` serving and run admin via secured endpoints + a minimal internal page. Recommendation: wire the Admin dashboard minimally (disburse, deactivate, view escalations); delete Firebase (`src/firebase.ts`, Firebase auth context) either way.
- **Step 3.2 —** Rate-limit auth routes (`express-rate-limit`) (F11).
- **Step 3.3 —** Token revocation: `token_version` column checked in `requireAuth`; bump on deactivation (F12).
- **Step 3.4 —** Stop leaking `err.message`; generic 500 body, full log server-side (F15).
- **Step 3.5 —** Drop `users.last_payment_date` writes; derive from payments everywhere (F16). Migration + grep all readers first (mobile displays `lastPaymentDate` — keep the API field, compute it in the query).
- **Step 3.6 —** CI: add mobile jest + lint jobs; fix codemagic email (F17). Remove plaintext-password fallback after confirming all rows hashed (F19).

### Phase 4 — Pilot → production gate

Before real COs carry real books: seed real merchants + disbursements via the new admin path; 1-week supervised pilot with daily reconciliation (cash collected vs Rill book); crash reporting (Sentry) wired into the ErrorBoundary; then scale. Officer/territory scoping (F13) decided when team size demands it.

---

## Open decisions for Joy (do not resolve unilaterally)

1. First-admin bootstrap mechanism (Step 1.2).
2. Overpayment policy: reject, or accept and floor at zero with an "excess" record (Step 1.3).
3. Web dashboards: wire or cut (Step 3.1) — this also gates the AI-endpoint auth fix.
4. Render paid-plan budget (Step 1.4).
5. Later: when the pilot proves the loop, revisit the standalone-vs-supplya-backend integration question (merchants ↔ retailers, repayments ↔ BNPL ledger). Nothing in this plan should hard-code assumptions that block that merge — keep IDs as UUIDs and amounts in integer naira as they are.

## Explicitly NOT verified in this audit
- Actual behavior of the deployed Render instance (no prod access from here).
- expo-updates 56 runtime breakage on SDK 53 (suspected via version-line mismatch only).
- Render free-tier Postgres expiry terms (check current docs).
- Android release build (codemagic pipeline not executed).
