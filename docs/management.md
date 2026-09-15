# Management: accounts, fleet and schedules

How the hierarchy works, who may do what, and why the rules live where they do.

---

## The hierarchy

```
ADMIN
  ↓ creates operator accounts
OPERATOR
  ↓ creates driver and crew accounts, for their own company only
DRIVER / CREW
```

Nobody moves up it. An operator cannot create another operator; a driver cannot create anybody;
and nobody — not even an admin, through the app — creates an ADMIN. Operator registration is not
public and there is no self-service path to it.

Passengers are outside the hierarchy: they sign themselves up, and the `handle_new_user` trigger
hard-codes their role to `USER` while ignoring anything the client puts in its metadata.

---

## Account provisioning

Creating an account for somebody else needs `auth.admin.createUser`, which needs the service-role
key, which must never reach the app. So it is an Edge Function: `supabase/functions/manage-staff`.

The function is deliberately thin. Every rule it applies is asked of the database **as the
signed-in caller**, so the rules are in SQL where `verify-staff-accounts.mjs` can test them against
real signed-in roles:

| Step | What | Why there |
|---|---|---|
| 1 | `authorize_staff_provision(role, operator_id)` | Asked **before** anything is created, so a refusal leaves no orphan in `auth.users`. |
| 2 | `auth.admin.createUser` with a generated password | The only step that needs the service role. |
| 3 | `provision_staff_account(...)` | Sets the role, the operator, the crew record and the audit entry in one transaction. Re-checks authorisation, because a function that trusts its caller to have asked first is not a check. |
| 4 | `auth.admin.deleteUser` on failure | A compensating write, not a rollback — the two are on different connections. If it too fails, the orphan is logged loudly rather than reported as success. |

The temporary password is returned **once**. It is not stored in readable form anywhere, so the
way back from a lost one is a reset, not a lookup. Its alphabet excludes `I l 1 O 0`, because it
gets read aloud at a ticket counter.

`profiles.must_change_password` is set on provisioning and on every reset. `AuthGate` redirects to
`/change-password` before any console renders, so a password that was written on a slip of paper
stops working as soon as it has been used once.

---

## The two statuses

These are separate fields and must stay separate.

| | Field | Question it answers |
|---|---|---|
| **Account status** | `profiles.account_status` | May this person sign in? |
| **Availability** | `drivers.availability_status` / `assistants.availability_status` | May they be given a **new** trip? |

All four combinations are real:

| Account | Availability | Result |
|---|---|---|
| ACTIVE | AVAILABLE | Signs in, can be rostered |
| ACTIVE | UNAVAILABLE | Signs in, sees their history and notifications, **not** rostered — a rest day |
| INACTIVE | AVAILABLE | Cannot sign in; availability is simply moot |
| INACTIVE | UNAVAILABLE | Cannot sign in, cannot be rostered |

The `staff_status` enum these replaced was one field for both, and could not express the second
row — which is the ordinary case for crew. It was dropped rather than left alongside them.

**Deactivating deletes nothing.** The trips they drove, the tickets they scanned and the
assignments they held all stay exactly where they are. That is the point of doing it this way.

### Making deactivation stick

Three layers, because the first two are not enough on their own:

1. **The auth ban.** `manage-staff` bans the user, which ends an open session now rather than at
   its next refresh.
2. **The role helpers.** `is_admin()`, `current_operator_id()`, `current_driver_id()`,
   `current_assistant_id()` and `current_profile_role()` all require `account_status = 'ACTIVE'`,
   so every policy that resolves through them refuses.
3. **`active_uid()`.** The policies that ask "is this row mine?" tested `auth.uid()` directly and
   kept answering — an access token stays syntactically valid for up to an hour. `active_uid()` is
   `auth.uid()` for an account that may sign in and NULL for one that may not, and nineteen
   policies were rewritten onto it.

The one thing a deactivated account can still do is read its own profile, so the app can tell them
why it stopped working instead of showing an empty screen.

---

## Scheduling

### The rule

A coach cannot be in two places at once, and neither can a driver.

This is a **constraint**, not a check. A check inside the insert would be an improvement and still
wrong: two operators pressing Save at the same instant would both read "free" and both write.

```sql
alter table public.trips add constraint trips_bus_no_overlap
  exclude using gist (bus_id with =, blocked_range with &&)
  where (status <> 'CANCELLED' and is_active);
```

`trip_assignments` gets the same treatment, keyed on `driver_id` and `assistant_id`.

### `blocked_range`

The window a trip holds its coach for: `[departure, arrival + turnaround)`.

* **Half-open**, so a departure may start at the exact instant the previous one's buffer ends.
* **`timestamp`, not `timestamptz`.** Palawan is one zone, and timestamptz arithmetic depends on
  the session's TimeZone — two clients would disagree about what overlaps.
* **Trigger-maintained, not generated.** A generated column must be `IMMUTABLE`, and the turnaround
  buffer is configuration.
* An arrival **at or before** the departure time means the next day. An overnight sailing leaving
  20:00 and arriving 06:00 is ten hours, not minus fourteen.

`trip_assignments` carries a **copy** of its trip's window, because an exclusion constraint can only
read columns of its own table. Two triggers keep the copy honest: one stamps it on write, one
re-stamps every assignment when the trip's own window moves.

### The turnaround buffer

`app_settings.trip_turnaround_minutes`, default 30, admin-only through
`set_turnaround_minutes(minutes)`.

Widening it re-stamps every future departure at once. If that would put two coaches on top of each
other, the whole change is refused and the error names the earliest clashing pair — silently
applying it to some trips and not others would be worse than saying no.

The value is readable by any signed-in user through `public_setting`, which uses a **key
allowlist** — `app_settings` also holds the push webhook secret and has no client read policy.

### Assignment validation

`assign_trip_crew` checks all five conditions from the brief, server-side:

1. The account is ACTIVE — when there is one. A crew record with no login is somebody on the roster
   who does not use the app; they have always been assignable and still are.
2. Availability is AVAILABLE.
3. They belong to this trip's operator.
4. No clash — the exclusion constraint, not a read-then-write.
5. "Qualified", read concretely: a driver whose licence is **known** to expire before the departure
   date is refused. A licence with no recorded expiry is not evidence of anything, so it does not
   block.

Replacing a crew supersedes the live assignment rather than editing it, so who was rostered before
the swap stays on the record.

### Cancel vs withdraw

| | `cancel_trip` | `set_trip_active(false)` |
|---|---|---|
| Means | It was going to run and will not | It is not being sold |
| Bookings | Cancelled, seats released, passengers told | Refused while anyone holds a seat |
| Coach and crew | Released | Released |
| Refunds | **Not** automatic — a separate decision | n/a |
| Deletes | Nothing | Nothing |

Reactivating a withdrawn trip does not restore its crew. It returns unstaffed and is rostered
afresh, rather than quietly reclaiming people who may have been given other work.

---

## What an inactive thing does

Deactivation is enforced twice, deliberately:

* **`trip_search`** carries `operator_status`, `bus_status`, `route_status` and `is_active` and is
  **not** filtered. `tripService.searchTrips` filters on them; `getTrip` does not, because it reads
  the same view to render a ticket somebody already holds — a coach withdrawn after they booked
  must not 404 their booking.
* **`create_booking`** refuses an inactive operator, route or bus outright, with
  `INACTIVE_RESOURCE`. That is the enforcement: a client that queries the view differently, or
  calls the RPC directly, still cannot sell a seat on a withdrawn coach.

Tickets already sold stay valid and travellable throughout.

---

## No deletes

Operators, terminals, routes, buses and trips are referenced by bookings, payments, tickets and
boarding scans. Every client `INSERT`, `UPDATE` and `DELETE` on those tables was withdrawn; every
write goes through an audited SECURITY DEFINER function.

Every "Delete" in the console is deactivation, and the confirmation dialog says so.

---

## Verifying it

```bash
pnpm db:reset && pnpm functions:serve
```

```bash
pnpm db:verify:staff && pnpm db:verify:schedules
```

`verify-staff-accounts.mjs` — 80 checks. Who may provision whom; that a refusal leaves no account
behind; the temporary password working once; all four status combinations; how far an operator's
reach goes; the audit trail.

`verify-schedules.mjs` — 67 checks. Overlapping coaches, the turnaround boundary in both
directions, overnight runs, crew double-booking, two simultaneous conflicting writes, what an
inactive coach does to a sale, and that cancelling releases everything and deletes nothing.
