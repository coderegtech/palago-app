# Going to production — assumptions and cost ranges

**Status: assumptions, not a quotation.** Every figure here is an estimate written on
**16 September 2026** against a build that has never taken a peso. Prices move, plans get renamed,
and Philippine gateway rates are negotiated per merchant rather than published as one number. Treat
this as the shape of the bill and the list of things to go and price, not as the bill.

Two things to read before anything else:

- **Nothing in this repository charges money.** `src/lib/env.ts` rejects any payment provider except
  `mock`, and `payments` carries a check constraint allowing only `MOCK` or `CASH`. Cash at a
  counter is real money changing hands in a terminal, recorded by a named member of staff; every
  other payment is simulated. A real gateway is *work not yet done*, and §3 costs it.
- **The app does not use Mapbox.** It uses MapLibre — the open-source fork — against
  OpenFreeMap tiles, which cost nothing and need no key. You asked about Mapbox, so §6 prices it
  alongside the alternatives, but switching *to* Mapbox would be adding a bill the build currently
  does not have.

---

## 1. Assumptions this document rests on

| Assumption | Value | Why it matters |
|---|---|---|
| Exchange rate | **₱58 = US$1** | Most vendors bill in USD. Every peso figure below is a conversion, so a rate move of ±5% moves the infrastructure line ±5%. |
| Business model | PalaGo is a **booking platform** for third-party bus operators (Cherry Bus, RoRo Bus) | Decides whether PalaGo touches the fare money — the single most expensive fork in this document. See §4. |
| Fare | **₱600 average** per seat | Palawan intercity coach fares. Puerto Princesa → El Nido is the reference journey in the seed. |
| Online share | 40–60% of seats sold through the app | The rest stay counter sales, which the app already records but which carry no gateway fee. |
| Platform | Android-first, web second, iOS optional | `app.json` configures all three; the Play Store is the stated target. |
| Region | Palawan only, one timezone | Load is regional, not national. The schema bakes this in — `timestamp`, never `timestamptz`. |
| Team | Small: one senior engineer, part-time QA, part-time ops | Not an agency retainer. §5 prices both. |

Three scale scenarios are used throughout:

| | **A — Pilot** | **B — Regional** | **C — Province-wide** |
|---|---|---|---|
| Operators | 1 | 2 | 5 |
| Departures/day | 6 | 30 | 100 |
| Seats/day | ~300 | ~1,500 | ~5,000 |
| Online bookings/month | ~3,600 | ~22,500 | ~90,000 |
| Booked fare value (GMV)/month | ~₱2.2M | ~₱13.5M | ~₱54M |

---

## 2. What is production-ready today, and what is not

The honest inventory, because the gap list is where most of the remaining money goes.

**Built and verified** — 30 tables with RLS on every one, 34 migrations, 9 Edge Functions,
15 database verification suites (774 assertions signing in as real roles), 147 unit tests, the
admin/operator/driver hierarchy, schedule conflict prevention as database constraints, QR boarding
with server-side signature validation, wallet, loyalty, tracking, SOS, discounts, counter sales.

**Not production-ready:**

| Gap | Why it blocks a real launch |
|---|---|
| **No real payment gateway** | The largest single piece of remaining work. §4. |
| **Test-mode notices are missing from passenger screens** | Only the counter screen warns. A receipt or wallet balance is visually indistinguishable from a real one — a legal problem the moment a stranger can reach it. |
| **Push delivery unproven** | Tokens, triggers and the `send-push` function exist; nothing has been shown arriving on a handset. Needs a device and a development build. |
| **No error monitoring or logging** | Nothing reports a crash. A production app without this is flying blind. |
| **No data retention job** | `bus_locations` is append-only and never pruned. §8 shows what that costs by scenario. |
| **Phases 13–15 not started** | Security review, testing, production preparation — the project's own plan says so. |
| **MapLibre has never run on hardware** | It typechecks against the real v11 API; that is not the same as working. |

---

## 3. Development cost

### 3.1 What it would cost to build what already exists

Not a bill you have to pay — it is the replacement value, useful for insuring, valuing, or deciding
whether to rewrite.

Scope: ~237 source files, 30 tables, 9 Edge Functions, four role-separated app surfaces
(passenger, operator, driver, admin), and the verification suites.

| Delivery model | Duration | Cost range |
|---|---|---|
| One senior full-stack, solo | 6–10 months | **₱900,000 – ₱1,800,000** |
| Senior + mid pair | 4–6 months | **₱1,100,000 – ₱2,100,000** |
| Local agency, fixed scope | 4–7 months | **₱1,800,000 – ₱4,500,000** |

Philippine rate assumptions (2026, verify against current market): mid-level React Native + Postgres
₱60,000–110,000/month salaried or ₱500–900/hour freelance; senior ₱120,000–200,000/month or
₱1,000–2,500/hour; agency blended ₱1,800–3,500/hour. Salaried figures need roughly **+20–25%**
loading for 13th month pay and the employer share of SSS, PhilHealth and Pag-IBIG.

### 3.2 What remains before launch

This is the number that actually matters.

| Work | Effort (dev-days) | Cost at ₱8,000–16,000/day |
|---|---|---|
| Payment gateway integration (§4) | 15–25 | ₱120,000 – ₱400,000 |
| Restore test-mode notices, then remove them at go-live | 2–3 | ₱16,000 – ₱48,000 |
| Push: development build, device testing, credentials | 4–7 | ₱32,000 – ₱112,000 |
| Error monitoring, structured logging, environment separation (Phase 15) | 5–8 | ₱40,000 – ₱128,000 |
| Security review (Phase 13) — internal | 5–10 | ₱40,000 – ₱160,000 |
| Testing pass (Phase 14) — device matrix, E2E, load | 10–15 | ₱80,000 – ₱240,000 |
| Data retention and archival for `bus_locations` | 2–3 | ₱16,000 – ₱48,000 |
| Play Store preparation: listing, data safety, privacy policy, closed test | 3–5 | ₱24,000 – ₱80,000 |
| Operator onboarding tooling and staff training material | 5–8 | ₱40,000 – ₱128,000 |
| Contingency at 20% | — | ₱82,000 – ₱269,000 |
| **Total** | **51–84 days** | **₱490,000 – ₱1,613,000** |

Roughly **2.5–4 calendar months** for one senior engineer with part-time support. The wide range is
mostly the payment gateway: a single-merchant integration sits at the bottom, a marketplace with
split settlement at the top.

An **external penetration test** is priced separately because it is optional for a pilot and
expected for anything handling real fares at scale: **₱150,000 – ₱600,000** for a scoped web +
mobile + API engagement from a Philippine or regional firm.

---

## 4. Payment gateway — the expensive fork

### 4.1 Decide who holds the money first

This decision costs more than every other line in the document combined, and it is a legal question
before it is a technical one.

**Option 1 — Each operator is the merchant.** Cherry Bus and RoRo Bus each hold their own gateway
account; PalaGo routes the payment to whichever operator owns the trip and never holds the fare.
Cheapest, fastest, lowest regulatory exposure. Needs a gateway with platform/sub-merchant support
(Xendit and PayMongo both offer this). PalaGo earns a separate booking fee or a monthly SaaS charge.

**Option 2 — PalaGo collects and remits.** One merchant account, money lands with PalaGo, operators
are paid out on a cycle. Simpler for passengers, materially harder legally: collecting funds on
behalf of others in the Philippines can bring you under BSP registration as an Operator of Payment
Systems, with capital, reporting and AML obligations. **Take legal advice before choosing this.**
Budget **₱100,000 – ₱400,000** in legal and compliance work, plus months of lead time, if you do.

Everything below assumes Option 1 unless stated.

### 4.2 Rate ranges

Philippine gateways, indicative published rates — all negotiable downward at volume, all to be
confirmed in writing during onboarding:

| Method | Typical rate | Notes |
|---|---|---|
| GCash / Maya e-wallet | **2.0 – 2.9%** | The dominant rail for this market. Expect most volume here. |
| GrabPay | 2.0 – 2.9% | |
| Cards (Visa/Mastercard) | **3.5% + ₱10–20** per transaction | Low share for ₱600 bus fares. |
| Online bank transfer (InstaPay/PESONet) | ₱15–30 flat, or ~2% | Flat fees favour higher fares. |
| Over-the-counter / convenience store | **₱15–30 flat** | Matters in Palawan, where card penetration is low. |
| Payouts to operator bank accounts | ₱10–25 per payout | Only under Option 2, or platform-managed settlement. |

Setup fees are typically **₱0** at PayMongo and Xendit; Maya Business and bank-acquired gateways may
charge onboarding or minimum monthly fees. Settlement is typically **T+1 to T+7**, which is a
working-capital question for the operators, not a cost.

### 4.3 What the fee actually costs, by scenario

Assuming 2.5% blended:

| | A — Pilot | B — Regional | C — Province-wide |
|---|---|---|---|
| Monthly GMV | ₱2.2M | ₱13.5M | ₱54M |
| Gateway fee at 2.5% | **₱55,000** | **₱337,500** | **₱1,350,000** |
| Same at a negotiated 1.9% | ₱41,800 | ₱256,500 | ₱1,026,000 |

**Read that against §7's infrastructure totals.** At pilot scale the gateway costs **28 times** the
entire infrastructure bill; at scenario C, 13 times — the ratio narrows only because the servers
finally start costing something. Every hour spent negotiating the rate
down is worth more than every hour spent optimising the server bill. A 0.6 point reduction at
scenario C saves ₱324,000 a month — which over a year is more than twice the whole remaining
development budget in §3.2.

### 4.4 Integration shape

The architecture is already correct for this, which is why the estimate is 15–25 days rather than
50. The server is the source of truth: no client decides a payment status, and `create-test-payment`
/ `confirm-test-payment` / `get-payment` already isolate the provider behind Edge Functions. Real
integration means replacing their bodies, not restructuring the app. Specifically:

- A checkout-session function replacing `create-test-payment`.
- A **webhook receiver** with signature verification and idempotency — the piece that carries the
  real risk, because a replayed or forged webhook is a free ticket.
- Reconciliation against gateway settlement reports, since a webhook that never arrives leaves a
  passenger who paid looking unpaid at the door.
- Refunds routed through the existing `refund_test_payment` path so wallet-funded bookings still
  return money where it came from.
- Relaxing the `payments_mock_or_cash` constraint and the `env.ts` literal — deliberately, in one
  commit, with both guards named.

**Calendar time, not effort:** gateway onboarding and KYC take **2–6 weeks** and need SEC or DTI
registration, BIR registration, a mayor's permit, and bank details. Start this before the code.

---

## 5. Hosting: managed vs VPS

### 5.1 What the app actually needs hosting

| Piece | What it is here |
|---|---|
| Postgres + Auth + Realtime + Storage + Edge Functions | The whole backend. One Supabase project. |
| Static web bundle | `expo export --platform web` → `dist/`, a single-page app plus the public `/payment/[reference]` page. Any static host. |
| Mobile apps | Distributed by the stores; no hosting. |

### 5.2 Managed (recommended)

| Service | Plan | Monthly |
|---|---|---|
| Supabase | Free | ₱0 — **but projects pause after ~7 days idle and there are no daily backups. Not a production option.** |
| Supabase | Pro | **$25 ≈ ₱1,450** + usage. Includes daily backups, no pausing, 8GB database, 100GB storage, 250GB egress. |
| Supabase | Compute add-on | Small $15 → Medium $60 → Large $110 → XL $210 ≈ ₱870 – ₱12,200 |
| Supabase | PITR add-on | from **$100 ≈ ₱5,800** — worth it once real fares are in the ledger |
| Supabase | Team | $599 ≈ ₱34,700 — SOC2, SSO, longer log retention. Scenario C only. |
| Vercel | Hobby | ₱0 — **but the Hobby plan forbids commercial use.** Fine for the current prototype, not for a launched product. |
| Vercel | Pro | $20/user ≈ ₱1,160 |
| Cloudflare Pages | Free | ₱0, **commercial use permitted**, unlimited bandwidth. The better free option for the web build. |

### 5.3 VPS / self-hosted

You asked specifically about a VPS. It is viable and it is usually a false economy at this size.

| Provider | Spec | Monthly |
|---|---|---|
| Hetzner (EU) | 4 vCPU / 8GB / 80GB | €8–16 ≈ ₱500 – ₱1,000 |
| DigitalOcean / Vultr (SGP) | 4 vCPU / 8GB | $24–48 ≈ ₱1,400 – ₱2,800 |
| AWS Lightsail (SGP) | 4 vCPU / 8GB | $44 ≈ ₱2,550 |
| Philippine providers (local data residency) | comparable | ₱2,000 – ₱6,000 |

Self-hosting Supabase is a supported Docker deployment, so the software is free. What is not free:

- **Backups, monitoring, patching, upgrades, and someone on call.** Budget **₱15,000–40,000/month**
  of part-time devops, which is 10–30× the managed bill you were avoiding.
- **Realtime and Storage tuning** you would otherwise never think about.
- **The bus is your database.** A self-hosted Postgres holding fare records with no tested restore
  is a business-ending risk, not a saving.

Choose a VPS when data residency is a legal requirement (a plausible reading of some government
transport contracts), or once the Supabase bill passes roughly **₱30,000/month** and a dedicated
ops person is already on the payroll. Not before. Singapore is the nearest low-latency region for
Palawan either way; Supabase's `ap-southeast-1` and the VPS list above sit in the same place.

---

## 6. Maps

The build uses **MapLibre GL Native** (open source, no licence fee) with **OpenFreeMap** tiles
(free, no API key, community-funded, **no SLA**). Current cost: **₱0**. The style URL is a single
environment variable — `EXPO_PUBLIC_MAP_STYLE_URL` — so swapping providers is a config change, not a
code change. That was deliberate.

| Option | Free tier | Paid | Notes |
|---|---|---|---|
| **OpenFreeMap** (current) | Unlimited, fair use | — | No SLA, no support. Correct for a pilot; risky as the only option at scale. |
| **MapTiler** | 100k tile requests/month | ~$25 → $295/month ≈ ₱1,450 – ₱17,100 | Drop-in MapLibre style. The natural upgrade. |
| **Protomaps, self-hosted** | — | Storage + egress only, ~₱500–2,000/month | A single `.pmtiles` file of the Philippines on cheap object storage. Cheapest at scale, needs setup. |
| **Mapbox** | 25k–50k map loads/month | ~$5 per 1,000 loads beyond ≈ ₱290/1,000 | **Would require replacing MapLibre with the Mapbox SDK** — a licence change and a code change, several days of work. There is no reason to unless you need a Mapbox-only feature. |
| **Google Maps** | $200/month credit | ~$7 per 1,000 loads ≈ ₱406/1,000 | Same objection, plus a heavier SDK. |

**Recommendation:** stay on OpenFreeMap through the pilot; move to MapTiler or self-hosted Protomaps
before scenario B, so an outage in a free community service cannot take live bus tracking down.

---

## 7. Monthly run rate

Infrastructure only — §4's gateway fees are excluded and are much larger.

| Line | A — Pilot | B — Regional | C — Province-wide |
|---|---|---|---|
| Supabase plan | ₱1,450 (Pro) | ₱1,450 (Pro) | ₱34,700 (Team) |
| Compute add-on | ₱0 (included micro) | ₱3,480 (Small–Medium) | ₱12,200 (Large–XL) |
| PITR backups | ₱0 | ₱5,800 | ₱5,800 |
| Realtime message overage (§8) | ₱400 | ₱4,900 | ₱18,000 |
| Database + storage overage | ₱0 | ₱1,200 | ₱6,000 |
| Web hosting | ₱0 (Cloudflare) | ₱1,160 (Vercel Pro) | ₱1,160 |
| Map tiles | ₱0 | ₱1,450 | ₱8,700 |
| Transactional email (Resend/SES) | ₱0 | ₱1,160 | ₱2,900 |
| Error monitoring (Sentry) | ₱0 | ₱1,500 | ₱5,800 |
| EAS Build (or build locally, free) | ₱0 | ₱1,100 | ₱5,750 |
| Push notifications (Expo/FCM) | ₱0 | ₱0 | ₱0 |
| Domain (annualised) | ₱100 | ₱100 | ₱100 |
| **Infrastructure subtotal** | **₱1,950** | **₱23,300** | **₱101,110** |
| *Gateway fees at 2.5%, for contrast* | *₱55,000* | *₱337,500* | *₱1,350,000* |
| Ops/maintenance retainer (0.2–0.5 FTE) | ₱25,000 – ₱60,000 | ₱40,000 – ₱90,000 | ₱120,000 – ₱250,000 |

**A pilot can run on under ₱2,000 a month of infrastructure.** That is the genuinely useful finding:
the technology is nearly free at this size, and the cost of the business is people and card fees.

---

## 8. Load, derived from the actual code

These are not generic estimates — they come from constants in the repository, which makes them
worth re-deriving if those constants change.

**GPS pings.** `src/constants/config.ts` sets `LOCATION_UPDATE_INTERVAL_MS = 10_000` with a 25-metre
gate, and `bus_locations` is append-only by design. A six-hour run produces ~2,160 rows.

| | A | B | C |
|---|---|---|---|
| Rows/month | ~390,000 | ~1.95M | ~6.5M |
| Disk/month (~200 bytes with index) | ~80 MB | ~390 MB | ~1.3 GB |

Supabase Pro includes 8 GB. Scenario C fills it in about six months of tracking data alone — hence
the retention job in §3.2. Keeping 30 days hot and archiving the rest to Storage costs two or three
days of work and removes the problem permanently.

**Realtime fan-out is the sleeper cost.** Every insert is delivered to every subscribed passenger.
With 20 passengers watching a trip, one six-hour run is 2,160 × 20 ≈ **43,000 messages**.

| | A | B | C |
|---|---|---|---|
| Messages/month | ~7.8M | ~39M | ~130M |
| Supabase Pro includes | 5M | 5M | 5M |
| Overage at ~$2.50/M | ~$7 ≈ ₱400 | ~$85 ≈ ₱4,900 | ~$310 ≈ ₱18,000 |

Sensitive to the watcher count, which is a guess. If passengers watch more than assumed, this line
grows linearly and becomes the second-largest bill after the gateway. Two mitigations, both cheap:
raise the publish interval to 20–30 seconds while en route (a one-line constant change, barely
noticeable to a passenger watching a bus), or fan out from a per-trip aggregate rather than the raw
insert. Worth doing before scenario B, not after the invoice.

**Web bundle.** ~5.6 MB uncompressed, served gzipped, content-hashed and immutable. Negligible on
Cloudflare; a line item on metered egress.

---

## 9. App store deployment

### Google Play — one-time $25 ≈ ₱1,450

| Requirement | Cost | Notes |
|---|---|---|
| Developer registration | **$25 ≈ ₱1,450, once** | Personal or organisation. |
| Organisation account | ₱0 + 1–30 days | Needs a **D-U-N-S number** (free from Dun & Bradstreet, but slow). Strongly preferred over a personal account for a business. |
| Closed testing requirement | ₱0 + **14+ days** | New **personal** developer accounts must run a closed test with **12+ testers for 14 continuous days** before production access. Organisation accounts are generally exempt. Plan the calendar around it. |
| Privacy policy | Hosting only | Must be a live URL. The app collects location, camera images and government IDs — it needs a real one, not a template. |
| Data safety declaration | ₱0 | Must match what the app does: location, photos, personal identifiers. |
| Play Billing commission | **Not applicable** | Bus tickets are a real-world service. Google's 15–30% cut does not apply; external payment is permitted and required. **Verify this reading against current policy before launch — it is worth up to 30% of GMV.** |
| Permission declarations | ₱0 | The app asks for camera, fine and coarse location. `app.json` sets `isAndroidBackgroundLocationEnabled: false`, which **avoids the background-location review** — the slowest and most frequently rejected declaration on Play. Keep it that way. |

### Apple App Store — $99/year ≈ ₱5,750

`app.json` already carries `ios.bundleIdentifier`. Needs the Apple Developer Program at
**$99/year**, plus either a Mac or EAS Build for signing. Same physical-goods exemption from
commission. Review is slower and stricter than Play; budget 1–2 weeks for the first submission and
expect at least one rejection round. **Optional for a Palawan pilot** — Android share in the market
is high enough that iOS can wait.

### Build service

| Option | Cost |
|---|---|
| Build locally (`eas build --local`, or plain Gradle) | **₱0**, needs a capable machine and ~30–60 min per build |
| EAS Free | ₱0, limited builds/month, long queues |
| EAS Starter / Production | ~$19 / ~$99 per month ≈ ₱1,100 / ₱5,750 |

EAS is a convenience, not a requirement. A pilot can build locally and pay nothing.

---

## 10. Philippine compliance and legal

Usually underestimated, and some of it has long lead times that gate the launch date.

| Item | Cost range | Notes |
|---|---|---|
| SEC registration (corporation) or DTI (sole proprietor) | ₱2,000 – ₱15,000 | Prerequisite for a gateway merchant account. |
| Mayor's / business permit, barangay clearance | ₱5,000 – ₱30,000/year | Varies by LGU. |
| BIR registration, books, official receipts | ₱5,000 – ₱20,000 | Electronic receipts may need **CAS accreditation** — ask an accountant early; it has a lead time. |
| **National Privacy Commission** registration as a Personal Information Controller | ₱0 – ₱5,000 | **Required.** The app stores government IDs in the private `discount-proofs` bucket, plus location data. Registration is cheap; the Data Protection Officer's time is not. |
| Privacy impact assessment and DPO | ₱30,000 – ₱150,000 | Once, then ongoing. Proportionate to handling senior/PWD/student IDs. |
| Terms of service and privacy policy, drafted | ₱25,000 – ₱100,000 | Do not use a template for an app that holds ID photographs. |
| Legal opinion on the money-flow model (§4.1) | ₱50,000 – ₱200,000 | Only if considering Option 2. Skip it by choosing Option 1. |
| Insurance (cyber / professional indemnity) | ₱30,000 – ₱150,000/year | Optional at pilot, expected at scale. |
| **Total, one-time** | **₱150,000 – ₱670,000** | |

The Data Privacy Act exposure is real and specific to this build: `discount-proofs` holds
photographs of government IDs belonging to seniors, students and persons with disability. The
schema already does the right things — private bucket, short-lived signed URLs, no public read — but
the paperwork obligation exists regardless of how good the code is.

---

## 11. Putting it together

### First year, pilot (scenario A)

| | Low | High |
|---|---|---|
| Remaining development (§3.2) | ₱490,000 | ₱1,613,000 |
| Compliance and legal (§10) | ₱150,000 | ₱670,000 |
| Play Store + domain, one-time | ₱3,000 | ₱8,000 |
| Infrastructure, 12 months (§7) | ₱23,400 | ₱30,000 |
| Ops retainer, 12 months | ₱300,000 | ₱720,000 |
| Gateway fees, 12 months at pilot GMV | ₱502,000 | ₱660,000 |
| **Year one total** | **₱1,468,400** | **₱3,701,000** |

Excludes an external penetration test (₱150,000–600,000) and iOS ($99/yr).

### The shape of it

- **Below ~₱2M/month in bookings, the technology is nearly free.** Under ₱2,000/month of servers.
- **Above that, the payment gateway is the entire cost structure.** At scenario C it is 93% of the
  recurring *technology* bill — ₱1,350,000 against ₱101,110 of infrastructure. Negotiate it, and
  route as much volume as possible to e-wallet rails rather than cards.
- **People cost more than machines at every scale.** The ops retainer alone outweighs infrastructure
  until scenario C.
- **The lead times, not the money, set the launch date.** Gateway KYC (2–6 weeks), D-U-N-S (up to 30
  days), Play closed testing (14 days) and BIR accreditation run in parallel with development but
  must be *started* early. Nothing in §3.2 is blocked by them; the launch is.

### The cheapest credible production stack

Supabase Pro (₱1,450) + Cloudflare Pages (free, commercial use permitted) + OpenFreeMap (free) +
Expo push (free) + local EAS builds (free) + Sentry free tier + PayMongo or Xendit on e-wallet rails
+ a Play organisation account. **About ₱1,500–2,000 a month**, with nothing in it that has to be
torn out later — every line has a paid tier one step up, and the map provider is one environment
variable away from a swap.

---

## 12. Before quoting any of this to anyone

Every figure above is an assumption with a shelf life. Confirm these first, in this order, because
the top three can each move the total by more than everything below them:

1. **Gateway rates in writing**, from at least two of PayMongo, Xendit and Maya Business, for your
   actual expected volume and method mix. This is the largest number in the document.
2. **Who holds the fare money** (§4.1) — with a lawyer, not with an engineer.
3. **Whether Play's commission exemption for real-world services still reads the way §9 assumes.**
   Worth up to 30% of GMV if it does not.
4. Supabase's current plan limits and per-unit overage prices, especially realtime messages.
5. The Vercel commercial-use restriction on the Hobby plan, if you plan to use it.
6. Current Philippine engineering rates — §3's ranges are wide because the market is.
7. The watcher-count assumption in §8, measured from real usage as soon as there is any.

---

*Written 16 September 2026 against commit `7dfc184`. See [deployment.md](deployment.md) for how the
web build is actually deployed, [phases.md](phases.md) for what Phases 13–15 contain, and
[AGENTS.md](../AGENTS.md) for the non-negotiables that a real payment provider would have to be
added against.*
