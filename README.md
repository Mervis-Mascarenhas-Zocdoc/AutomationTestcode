# AutomationTestcode

Playwright automation for **Zocdoc provider onboarding** — it registers a brand-new
test practice and then creates a provider inside it.

These are **data-setup scripts, not functional tests.** They exist to produce a
usable test practice + provider on demand. Part 1 asserts only enough to keep the
next step reliable; Part 2 contains no assertions at all. A green run means "the
data got created", not "onboarding is bug-free".

Runs against **production** (`https://www.zocdoc.com`) using `@zocdoctest.com`
accounts. Everything it creates is real data in a real environment.

---

## Contents

| File | What it is |
|---|---|
| `tests/provider-signup-account-details.spec.ts` | **Part 1** — signup form → account registered → lands on "confirm your email" |
| `tests/provider-setup-post-verification.spec.ts` | **Part 2** — manual login → 9-step add-provider wizard → provider created |
| `tests/test-data.ts` | All test data and env-var overrides. **This is the file you edit.** |
| `tests/ab.ts` | Feature-flag / AB override helpers (cookie, header, tracking-id identity) |
| `tests/recorded.spec.ts` | Raw `codegen` recording of Part 1. Reference only — see [Known limitations](#known-limitations) |
| `tests/recorded-post-verification.spec.ts` | Raw `codegen` recording of Part 2. Reference only — **currently cannot run** |
| `tests/assets/placeholder-photo.png` | Synthetic 600×600 image for the profile-photo step |

---

## Setup

Node 18+ required.

```bash
git clone git@github.com:Mervis-Mascarenhas-Zocdoc/AutomationTestcode.git
cd AutomationTestcode

# Dependencies are NOT declared in package.json — install them explicitly:
npm install -D @playwright/test typescript @types/node

# Browser binaries
npx playwright install chromium

# Part 1 and Part 2 both write run records here, and .auth/ is gitignored,
# so create it or the scripts fail with ENOENT on their final write:
mkdir -p .auth
```

---

## Before you run: what to change

Open **`tests/test-data.ts`**. Anything below can also be overridden from the
shell without editing the file — the env-var name is given where one exists.

### 1. Required — the signup identity

| Constant | Ships as | Change it to |
|---|---|---|
| `EMAIL` (line ~28) | `first.lastname+${ACCOUNT_TAG}@zocdoctest.com` | **Your own** `firstname.lastname` — this is a placeholder and will not reach your inbox |
| `PASSWORD` | hardcoded | Set your own. It is committed in plaintext, so treat it as public |

The `+${ACCOUNT_TAG}` suffix is what makes each run unique, so you only change the
name part. Verification mail lands in the inbox of the address **before** the `+`,
which is why this must be an address you can actually read.

### 2. Required — a unique run tag

`ACCOUNT_TAG` defaults to a timestamp (`run2609111530`), so back-to-back runs never
collide and you normally don't touch it.

**A tag is single-use.** Once signup completes, that email is registered, and
re-running with the same tag is rejected as an existing account.

Pin it when Part 2 needs to pick up the practice Part 1 created:

```bash
ACCOUNT_TAG=onboarding-nextech-1 npm test
```

### 3. Optional — practice and provider details

All have working defaults; override only if your scenario needs something specific.

| Constant | Env var | Default |
|---|---|---|
| `FIRST_NAME` / `LAST_NAME` | — | `TestProvider` / `Testaccount` |
| `PHONE_NUMBER` | — | a fixed test number |
| `PRACTICE_NAME` | — | `testpractice zocdoc ${ACCOUNT_TAG}` |
| `SPECIALTY` | `SPECIALTY` | `Dentist` — must match the dropdown label exactly |
| `PRACTICE_SIZE` | `PRACTICE_SIZE` | `three_providers` — the `<option>` **value**, not the label |
| `PROVIDER_FIRST_NAME` / `PROVIDER_LAST_NAME` | same names | `TestProvider` / `Testprovider` |
| `PROVIDER_GENDER` | `PROVIDER_GENDER` | `Male` — radio label |
| `PROVIDER_SPECIALTY` | `PROVIDER_SPECIALTY` | `Anesthesiologist` — dropdown label |
| `PROVIDER_SUFFIX` | `PROVIDER_SUFFIX` | `MD - Medical Doctor` |
| `CONTACT_FIRST_NAME` / `CONTACT_LAST_NAME` | same names | inherits `FIRST_NAME` / `LAST_NAME` |
| `LOCATION_STATE` / `_ADDRESS` / `_CITY` / `_ZIP` | same names | a New York virtual location |
| `INSTITUTION` / `INSTITUTION_QUERY` / `DEGREE` | same names | `New York University` / `new yo` / `Bachelor of Medicine` |
| `ABOUT_STATEMENT` | `ABOUT_STATEMENT` | a "created by automation" disclaimer |
| `PROVIDER_PHOTO` | `PROVIDER_PHOTO` | `tests/assets/placeholder-photo.png`; `~` is expanded |

Dropdown values are matched by their **rendered label**. A renamed option in the UI
breaks the step, so copy labels from the live page rather than guessing.

### 4. Verify before trusting a run — the AB whitelist

`VISITOR_ID_FLAG_OFF` is a visitor GUID whitelisted to the **off** variant of
`provider_onboarding_repositioning_ga`. Part 1 pins the variant by presenting this
identity rather than by overriding the flag.

Whitelist entries can be edited or removed without notice. **Re-check the GUID in AB
Management before relying on a run**, or override it:

```bash
VISITOR_ID_FLAG_OFF=<guid> npm run test:headed
```

---

## Running

Part 2 requires you at the keyboard, so **run everything headed.**

### Part 1 — register the practice

```bash
ACCOUNT_TAG=my-run-1 npm run test:headed -- provider-signup-account-details
```

Fills the signup form, submits, and stops on the email-confirmation step. It writes
`.auth/last-created-practice.json` with the email, practice name and setup id.

### Manual step between the parts — verify the email

Automation cannot continue until the account is verified:

1. Open the inbox for the address in `EMAIL`
2. Find the Zocdoc verification mail for `<you>+<tag>@zocdoctest.com`
3. Click the verification link and finish whatever it asks for

### Part 2 — create the provider

Use the **same tag** as Part 1:

```bash
ACCOUNT_TAG=my-run-1 npm run test:headed -- provider-setup-post-verification
```

It opens the browser, hands control to you twice, then drives the wizard to the end.
Budget ~20 minutes (`SCRIPT_TIMEOUT_MS`).

### Other commands

```bash
npm test          # headless, all specs — not useful for Part 2
npm run report    # open the last HTML report
```

---

## Manual steps you must perform

This suite is **deliberately not fully automated.** Three points need a human, and
the script sits and waits at each one:

| # | When | What you do | Wait window |
|---|---|---|---|
| 1 | Between Part 1 and Part 2 | **Verify the signup email** by clicking the link in the inbox | — (script not running) |
| 2 | Start of Part 2 | **Sign in manually.** The script opens provider login and prints the email to use; you type the email and password. It resumes by itself once practice home loads | 10 min |
| 3 | Right after login | **Dismiss any modal or product tour, then open the add-provider flow yourself** (the "Add a provider" task on the home page). The script takes over once the wizard URL loads | 10 min |

After step 3 the run is hands-off through all 9 wizard steps. Watch the terminal —
each handoff is announced in a banner telling you exactly what to do.

Login is manual on purpose: provider auth lives on `provider-auth.zocdoc.com` and
the login URL carries a one-time `state` tied to the auth transaction, so a
recorded URL is dead on arrival.

**One last optional interaction:** after the final submit the script waits 30s
(`PROVIDER_CREATION_MS`) while the provider is actually created. The browser stays
open for that window, which is your chance to click "Back to Home". Don't kill the
run early — cutting this short leaves the home-page task stuck "in progress".

---

## Output

| Path | Contents | Committed? |
|---|---|---|
| `.auth/last-created-practice.json` | Part 1's email, password, practice name, setup id | No — gitignored |
| `.auth/last-created-provider.json` | Part 2's practice id, provider name, specialty | No — gitignored |
| `.auth/provider-state.json` | Logged-in session, parked so a re-run can skip login | No — gitignored |
| `playwright-report/` | HTML report (`npm run report`) | No — gitignored |
| `test-results/` | Traces, screenshots, video — retained on failure only | No — gitignored |

`.auth/` holds **live session cookies**. It is gitignored for that reason; keep it
that way and never commit its contents.

---

## Known limitations

- **`recorded-post-verification.spec.ts` cannot run as-is.** It depends on
  `.auth/flag-off-state.json`, which is gitignored and therefore absent from a fresh
  clone, and it navigates to a hardcoded `provider-auth` URL whose one-time `state`
  token is long expired. Kept for reference only; use
  `provider-setup-post-verification.spec.ts` instead.
- **Both `recorded*.spec.ts` files are raw codegen output** with a pinned
  `onboardingnewGC3` tag. Re-running them hits "account already exists". They document
  what was recorded; the hand-written specs are what you run.
- **No dependencies in `package.json`** — see [Setup](#setup). Worth fixing with a
  proper `devDependencies` block and a lockfile.
- **`retries: 0` and `workers: 1`** in `playwright.config.ts`. Sequential and
  unforgiving by design: these scripts create real accounts, so a blind retry would
  register a second practice.
- **Part 2 has no assertions.** It cannot tell you the provider was created
  correctly, only that no step threw. Verify in the UI.
- **The committed password is public.** This repo is public, so `PASSWORD` in
  `tests/test-data.ts` is world-readable. Use a throwaway credential and rotate it if
  it ever protected anything real.
