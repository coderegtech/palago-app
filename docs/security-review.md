# Phase 13 — security review

Done on 16 September 2026 against commit `f2933a6`, on the local stack with the seeded database.

Everything below was **executed**, not read. Where this document says a client can or cannot do
something, a real client signed in with the ordinary publishable key and tried it. That distinction
earned its place: four of the findings look impossible from the migration files, which say the
authorised path is a `SECURITY DEFINER` function — and were all reachable by not calling it.

**Result: four holes found, four closed, 26 new checks guarding them.** The suite that guards them
([`scripts/verify-security.mjs`](../scripts/verify-security.mjs)) was run against the unpatched
schema first and failed five of its checks. A security test that has never failed is a security test
that proves nothing.

---

## 1. Findings

### 1.1 An operator could hard-delete their own trips — **fixed**

`trips` had `insert, update` revoked by migration 31, but not `delete`, and the surviving policy was
`FOR ALL`. `ALL` includes `DELETE`.

`bookings.trip_id` is `ON DELETE RESTRICT`, so a *sold* trip was held by its foreign key — which is
why this survived every existing suite, all of which work with booked trips. An **unsold** trip went,
and took with it by `CASCADE`:

| Cascades away | What that was |
|---|---|
| `bus_locations` | the GPS trail of the journey |
| `trip_assignments` | who was crewing it |
| `trip_seats` | the seat inventory |

and detached by `SET NULL`:

| Set to NULL | What that breaks |
|---|---|
| `qr_scans.trip_id`, `ticket_trip_id` | a boarding scan no longer says which trip it was at |
| `sos_incidents.trip_id` | **an emergency no longer says which trip it happened on** |

"Reference data has no delete, for anyone" was already the written rule. Only the grant disagreed.

### 1.2 An operator could put a rival operator's driver on their own trip — **fixed**

The most serious of the four, and a direct breach of the specification: *"One Operator must never be
able to access another Operator's employees."*

`trip_assignments` had no revoke at all and a `FOR ALL` policy whose `USING` clause asked only
`can_manage_operator(t.operator_id)` — whether the caller manages the **trip's** operator. It never
looked at the driver. So an INSERT naming any driver in the system was accepted.

Proven by doing it: signed in as Cherry Bus, a row was inserted putting RoRo Bus's driver *Pedro
Ramos* on a Cherry trip. The row was removed again immediately.

This matters beyond the roster. AGENTS.md records that `trip_assignments` is what `can_scan_trip`,
`can_manage_trip_status`, `can_publish_location` and `can_manage_sos` all trust — so writing that
table is how you hand someone authority over a trip.

### 1.3 Every validation in `assign_trip_crew` was optional — **fixed**

The same open grant. `assign_trip_crew` checks five things before rostering anybody: the account is
ACTIVE, availability is AVAILABLE, the driver belongs to this operator, the licence has not expired,
and there is no clashing assignment. A direct INSERT skipped the first four.

Confirmed for availability: an UNAVAILABLE driver was rostered by writing the table.

Only the fifth survived — the `EXCLUDE USING gist` constraint held, because **a constraint cannot be
bypassed by choosing a different code path.** That is the argument for constraints over checks,
arriving from a direction nobody was looking.

### 1.4 An operator could rewrite a seat layout — **fixed**

`bus_seats` carried `FOR ALL` writes from Phase 3. `create_bus` builds a coach and its seats
together and nothing in `src/` has ever written the table, so the grant bought nothing.

A seat already sold is held by a foreign key — `DELETE` was refused — but `UPDATE` was not, and
renaming a seat out from under a sold ticket changes what is printed on a boarding pass. This one
was found by the suite, not by reading; I had assumed the foreign key covered it.

### The fix

[`20260916000033_write_scope_hardening.sql`](../supabase/migrations/20260916000033_write_scope_hardening.sql)
withdraws the grants **and** drops the `FOR ALL` policies, so the intent is visible in the policy
rather than resting on an invisible grant. Every affected RPC is `SECURITY DEFINER` and none of the
tables is `FORCE ROW LEVEL SECURITY`, so the authorised paths are untouched.

It also revokes `start_trip` and `set_trip_boarding` from `anon` — neither was exploitable, both
refuse an anonymous caller on their own, but neither needed to be an unauthenticated entry point.

### The shape all four share

Each is the same mistake: **a `FOR ALL` policy outliving the feature that needed it.** A later phase
introduces a function as the authorised path, revokes the grants it knows about, and leaves the
policy — which still says ALL — in place.

So the rule now written into AGENTS.md: *a privileged operation is only as narrow as its narrowest
path.* When a function becomes the front door, the back door needs closing in the same migration,
and the policy is the place to say so.

---

## 2. Assessed and found adequate

Things that were probed and turned out to be right. Listed because "we checked" is information.

| Area | Finding |
|---|---|
| **RLS coverage** | All 30 public tables have RLS enabled. Zero exceptions. |
| **`search_path` pinning** | All `SECURITY DEFINER` functions pin `search_path = ''`. Zero exceptions. An unpinned one is a standard privilege-escalation route. |
| **`operator_crew`** | The schema's only remaining owner-rights view — it reads past RLS on `drivers`, `assistants` and `profiles`, so its `WHERE` clause is the entire boundary. It is correct: `operator_id = current_operator_id() OR user_id = active_uid() OR is_admin()`. A NULL comparison in a `WHERE` filters the row out, unlike the same comparison in an `IF`. Now tested, because this is the exact shape of the bug that once showed RoRo's coaches on the Cherry fleet screen. |
| **`operator_fleet`** | The one auto-updatable view. Carries `security_invoker=true`, so a write is checked against the caller's own grants on `buses`, which migration 32 withdrew — the attempt returns `permission denied for table buses`. Verified, and now guarded, because dropping `security_invoker` would turn it into a way to edit any operator's coaches. |
| **Payment token entropy** | `payments.token` is `gen_random_bytes(32)` — 256 bits. A wrong token returns `NOT_FOUND` rather than "bad token", so a reference cannot be probed. Brute force is not a realistic vector. |
| **Sign-in brute force** | Supabase Auth limits sign-in and sign-up to 30 per 5 minutes per IP (`[auth.rate_limit]`). |
| **Role self-assignment** | Re-confirmed: `profiles.role` has no column grant, and `handle_new_user` ignores client metadata. A sign-up passing `role: 'ADMIN'` produces a `USER`. |
| **Deactivation** | Three layers hold — auth ban, gated role helpers, `active_uid()` in ownership policies. An access token stays valid up to an hour, which is why one layer would not be enough. |

The attack-surface checklist in [security.md](security.md) is otherwise covered by the existing
suites — double booking, duplicate payment confirmation, duplicate boarding, forged QR,
cancelled-ticket and unpaid-ticket scanning, expired payments and holds, and unauthorised operator,
location and SOS access all have checks that were run against violating data before being trusted.

---

## 3. Not done, and why

### 3.1 Rate limiting on Edge Functions and RPCs — **assessed, deliberately deferred**

Phase 13's scope names rate limits, and there are none on the Edge Functions or on PostgREST.

What that does *not* expose, on inspection: the brute-force vectors are already closed by something
better than a rate limit. Sign-in is limited by Supabase Auth. The payment token is 256 bits with a
uniform `NOT_FOUND`. Every Edge Function authorises before it acts, and `manage-staff` authorises
before it even creates an auth user.

What remains is **resource abuse** — an authenticated account hammering an endpoint to run up cost
or degrade service. That is real, and it is not solved by the obvious fix. A Postgres-backed counter
would add a write to every request on the endpoints it protects, making the cheapest attack more
expensive to defend than to mount, and an attacker with two accounts steps around a per-account
limit anyway.

Doing it properly means a decision above this codebase: Supabase's platform limits, or a WAF /
Cloudflare in front, or an API gateway. That belongs with the hosting decision in
[production-costs.md](production-costs.md) §5, not in a migration. Bolting on a counter now would
look like security without being any.

**Recommendation:** enable a captcha provider on sign-up (`[auth.captcha]`, already scaffolded in
`config.toml` and disabled), and set edge rate limits at the CDN when the hosting choice is made.

### 3.2 Not attempted in this review

- **No external penetration test.** This is an internal review by the person who wrote the code, and
  it inherits every blind spot that implies. Costed at ₱150,000–600,000 in
  [production-costs.md](production-costs.md) §3.2.
- **Nothing was tested on a device.** All findings are server-side. The mobile client's own storage,
  certificate handling and deep-link surface are untested.
- **The Edge Functions were not fuzzed.** Their authorisation is covered by the suites; their input
  parsing is not.
- **No review of the hosted project's configuration** — this was the local stack. The hosted project
  is currently behind on migrations and needs this one applied.

---

## 4. Re-running the static audit

The behavioural checks are `pnpm db:verify:security`. The catalog checks are not in a suite, because
PostgREST does not expose `pg_catalog` and adding a function to expose it would widen the surface
this review exists to narrow. Run them directly:

```bash
docker exec -i supabase_db_palago-app psql -U postgres -d postgres -c "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;"
```

Any row is a table without RLS.

```bash
docker exec -i supabase_db_palago-app psql -U postgres -d postgres -c "select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg where cfg like 'search_path=%');"
```

Any row is a `SECURITY DEFINER` function that does not pin its `search_path`.

```bash
docker exec -i supabase_db_palago-app psql -U postgres -d postgres -c "select table_name, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where grantee='authenticated' and table_schema='public' and privilege_type in ('INSERT','UPDATE','DELETE') group by table_name order by 1;"
```

This is the one that found everything. After the migration the list should be `bus_locations`
(INSERT only — the deliberate GPS exception) and nothing else. Anything new appearing here needs a
reason, and the reason needs to be a policy, not a grant.
