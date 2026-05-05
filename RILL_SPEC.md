# RILL CO MOBILE APP — FULL PRODUCT & TECH SPEC (MVP → V2)

## OVERVIEW
RILL is a field-first credit system. This mobile app is the execution layer for Collection Officers (COs).

Core functions:
- Acquire users
- Drive repayment behavior
- Capture field data
- Flag risks

This is NOT a dashboard. It is a decision + action system.

---

## ARCHITECTURE

Mobile App (React Native)
→ Render API (Node backend)
→ PostgreSQL (Render DB)
→ RILL (admin analytics)

---

## USER LIFECYCLE

Created → Pending → Disbursed → Active → Deactivated

- Pending: user created, no disbursement
- Active: first disbursement done
- Deactivated: admin disabled

---

## CORE FEATURES

### 1. AUTH
- Email + password
- Role: CO

---

### 2. TODAY SCREEN (PRIMARY)

Sections:
- 🔴 Urgent (no payment 48h or overdue)
- 🟡 At Risk (slow/partial)
- 🟢 On Track

User card:
- Name
- Location
- Group (optional)
- Amount owed / repaid
- Last payment time
- Status badge

Actions:
- Call
- Visit
- Log Payment
- Audit
- Escalate

Sorting:
- Highest owed
- Longest unpaid

---

### 3. USER DETAIL
- Payment history
- Disbursement history
- Status
- Notes

Actions:
- Call
- Log payment
- Audit
- Escalate

---

### 4. ADD USER
Fields:
- Name
- Phone
- Location (required)
- Group (optional)

Output:
- Status = pending

---

### 5. PAYMENTS
- Amount
- Method (transfer/cash/pos)
- Recorded by
- Timestamp

---

### 6. DISBURSEMENT
- Admin triggers
- Updates:
  - total_owed
  - balance
  - status → active

---

### 7. ENVIRONMENTAL AUDIT
- Mood
- Stock level
- Traffic
- Notes

---

### 8. ESCALATION
Reasons:
- No response
- Slow sales
- Refusal
- Dispute

Effects:
- Risk flag
- Admin visibility

---

### 9. GROUPS
- Optional grouping
- Fields: name, location, leader

---

## STATUS LOGIC

RED:
- No payment in 48h or overdue

YELLOW:
- Partial/slow

GREEN:
- On track

---

## DATABASE SCHEMA

Users, Payments, Disbursements, Groups, Audits, Escalations

(Relational Postgres model)

---

## API ENDPOINTS

GET /today
POST /users
POST /payments
POST /audits
POST /escalations
POST /disbursements

---

## MVP SCOPE

- Today screen
- Add user
- Log payment
- Audit
- Escalation

---

## V2

- Group enforcement
- Notifications
- Metrics
- Admin controls

---

## RULES

- No charts
- No unnecessary features
- Focus on action

---

## OBJECTIVE

Build a field execution engine that drives fast repayment behavior.
