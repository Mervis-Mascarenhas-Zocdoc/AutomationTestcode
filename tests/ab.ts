import type { BrowserContext, Page } from '@playwright/test';

/**
 * AB / feature-flag overrides, modeled on the sandbox repo's
 * playwright/support/ab.ts + abTesting.ts.
 *
 * There are two independent mechanisms and they do NOT overlap:
 *
 *  - `testAbSystemOverrides` cookie — reaches frontend/SSR experiment evaluation
 *    only. Never reaches backend services.
 *  - `ZD-Experiment-Overrides` header — what backend AB clients honor. Propagates
 *    through the edge (Fastly/Kong) and api2-gql.
 *
 * Both must be set BEFORE navigating, so the override rides the document request.
 */

const AB_OVERRIDES_COOKIE_KEY = 'testAbSystemOverrides';
const BACKEND_AB_OVERRIDE_HEADER = 'ZD-Experiment-Overrides';

function isZocdocHost(hostname: string): boolean {
    return hostname === 'zocdoc.com' || hostname.endsWith('.zocdoc.com');
}

/** Frontend/SSR overrides via the testAbSystemOverrides cookie. */
export async function setAbOverrides(
    context: BrowserContext,
    overrides: Record<string, string>
): Promise<void> {
    const existing = (await context.cookies()).find((c) => c.name === AB_OVERRIDES_COOKIE_KEY);

    let merged: Record<string, string> = {};
    if (existing) {
        try {
            merged = JSON.parse(existing.value);
        } catch {
            merged = {};
        }
    }
    Object.assign(merged, overrides);

    await context.addCookies([
        {
            name: AB_OVERRIDES_COOKIE_KEY,
            value: JSON.stringify(merged),
            domain: '.zocdoc.com',
            path: '/',
        },
    ]);
}

/**
 * Backend overrides via the ZD-Experiment-Overrides header.
 *
 * The route is scoped to Zocdoc origins on purpose — a custom ZD- header on a
 * cross-origin CDN fetch (fonts/JS on *.cloudfront.net) turns it into a
 * non-simple CORS request and the CDN's missing Access-Control-Allow-Origin
 * fails the preflight.
 */
export async function setBackendAbOverrides(
    page: Page,
    overrides: Record<string, string>
): Promise<void> {
    if (Object.keys(overrides).length === 0) return;

    const serialized = Object.entries(overrides)
        .map(([id, variant]) => `${id}=${variant}`)
        .join(';');

    await page.context().route(
        (url) => isZocdocHost(url.hostname),
        async (route) => {
            const headers = route.request().headers();
            headers[BACKEND_AB_OVERRIDE_HEADER] = serialized;
            return route.continue({ headers });
        }
    );
}

/** Sets both mechanisms, so the flag applies whether it is evaluated FE or BE. */
export async function forceFlags(page: Page, overrides: Record<string, string>): Promise<void> {
    await setAbOverrides(page.context(), overrides);
    await setBackendAbOverrides(page, overrides);
}

/**
 * Forces a variant by identity instead of by override.
 *
 * The AB system buckets website tests on the `firstTimeVisitor` cookie, and
 * forwards that value to backends as the `ZD-Tracking-Id` header (see
 * context/06-qa-channels-page-testcases.md). So if a GUID is listed under
 * "White Listed Values" in AB Management, setting this cookie to it pins the
 * variant for frontend, SSR and backend in one move — no override cookie and no
 * request rewriting.
 *
 * This is the mechanism to prefer over forceFlags() when a whitelisted GUID
 * exists: forceFlags only reaches FE/SSR (cookie) plus whatever honors the
 * ZD-Experiment-Overrides header, while the tracking id is the real assignment
 * key. The GUID must already be whitelisted for the variant you want — this
 * function sets identity, it does not itself decide the variant.
 *
 * Must be called before the first navigation — the tracking handler preserves an
 * incoming value and only mints a fresh GUID when the cookie is missing or
 * malformed, so setting it early is what makes it stick.
 *
 * Two caveats:
 *  - Whitelist entries are per AB project (www vs mobile, chosen from the user
 *    agent). A GUID whitelisted on www falls back to hash assignment on mobile.
 *  - The AB client does not read the tracking id for bucketing on its own; each
 *    backend service has to set Experiment.VisitorId explicitly. A service that
 *    skips that misses the whitelist silently and buckets on a random GUID, so a
 *    variant can hold on the frontend while a backend disagrees.
 *
 * If context.clearCookies() is ever added to setup, it must run BEFORE this and
 * setAbOverrides, or it wipes both.
 */
export async function setTrackingId(context: BrowserContext, visitorId: string): Promise<void> {
    await context.addCookies([
        {
            name: 'firstTimeVisitor',
            value: visitorId,
            domain: '.zocdoc.com',
            path: '/',
        },
    ]);
}
