import { writeFileSync } from 'node:fs';
import { test, expect, type Page } from '@playwright/test';
import { setTrackingId } from './ab';
import {
    ACCOUNT_TAG,
    CREATED_PRACTICE_FILE,
    EMAIL,
    FIRST_NAME,
    LAST_NAME,
    PASSWORD,
    PHONE_NUMBER,
    PRACTICE_NAME,
    PRACTICE_SIZE,
    SPECIALTY,
    VISITOR_ID_FLAG_OFF,
} from './test-data';

/**
 * Practice creation — Part 1: account details (pre email verification).
 *
 * This is a data-setup script, not a functionality or visibility test. Its only
 * job is to get a brand-new test practice registered and land on the "confirm
 * your email" step. Every assertion in here exists for one of two reasons:
 *   - it is the wait that makes the next step reliable, or
 *   - it guards the data we are creating (right specialty, signup accepted).
 * Nothing asserts UI copy, styling, or optional affordances.
 *
 * Runs with `provider_onboarding_repositioning_ga` OFF, pinned by presenting a
 * visitor id that AB Management whitelists to `off`. The flag is off:100% /
 * on:0% anyway, so this is belt-and-braces: it makes the variant deterministic
 * instead of dependent on the rollout staying where it is today.
 *
 * The `reposition-*` test ids below are present in both variants — the flag gates
 * sign-up routing and the go-live flow, not the markup of this form — so nothing
 * about the steps changes with the variant.
 *
 * Part 2 (post verification) picks up from .auth/last-created-practice.json.
 */

/**
 * Going straight to the form is deliberate: the recording walked /business/ →
 * header CTA → hero email field → submit, and that hop is the flakiest part of
 * the flow. If the button is clicked before its handler hydrates, the form does a
 * native GET and the browser just sits on /business/?email=… — which is exactly
 * how the previous version of this script failed. The form has its own email
 * field, so the marketing page buys us nothing.
 *
 * No utm params on purpose. The ones on the marketing CTA include
 * `utm_routing=reposition`, and sign-up routing is precisely what this flag
 * gates — not something to hand a routing hint to while pinning the off arm.
 */
const SIGNUP_URL = '/grow/sign-up';

/**
 * Opens the "Primary specialties" picker and selects one.
 *
 * The opener is the chevron <button aria-label="Open  dropdown options"> inside
 * `reposition-grouped-specialty-input-search-trigger`. Two traps, both learned the
 * hard way:
 *
 * 1. `force: true` is required, not laziness. The button carries no `disabled`
 *    attribute, but its ancestor `.dropdown__control` has `aria-disabled="true"`,
 *    and Playwright counts every descendant of an aria-disabled element as
 *    not-enabled — a normal click loops on "element is not enabled" until the test
 *    times out. A real user can click it, because aria-disabled is advisory only.
 *
 * 2. Do not click `reposition-specialty-input` instead. That react-select is
 *    genuinely disabled (`<input class="dropdown__input" disabled="">`), so
 *    clicking its control is a silent no-op: the click reports success and no menu
 *    ever opens.
 *
 * Located by its `aria-label` rather than by role: the button sits inside an
 * `aria-hidden="true"` indicator wrapper, so it has no role in the accessibility
 * tree, but attribute-based label matching still finds it. Do not fall back to a
 * bare `locator('button')` — once a specialty is chosen the same subtree also holds
 * the selected `pill` button, and the locator stops being unique.
 *
 * The field also swaps components on selection — it re-renders as
 * `reposition-grouped-specialty-input-container` holding one `pill` per choice —
 * so the opener and the verification target are deliberately different ids.
 */
async function selectSpecialty(page: Page, specialty: string): Promise<void> {
    const searchTrigger = page.getByTestId('reposition-grouped-specialty-input-search-trigger');
    await searchTrigger.getByLabel('Open dropdown options').click({ force: true });

    // Generous wait: this is the one step where the menu has to render before
    // anything is clickable, and the option list is long.
    const option = page.getByRole('option', { name: specialty, exact: true }).first();
    await expect(option).toBeVisible({ timeout: 15_000 });
    await option.click();

    // The menu is a multi-select checkbox list ("Select up to three"), so it stays
    // open after a selection and floats over the whole lower half of the form. Left
    // open, its option rows intercept the clicks on the terms checkbox below:
    // Playwright reports
    //   <div class="provider-join-web-app__sc-2b2tj1-3">…</div> subtree intercepts
    //   pointer events
    // and re-scrolls the page on every one of its ~10 retries, which looks like the
    // viewport glitching up and down before the step finally fails. (selectOption on
    // the practice-size <select> is unaffected — it sets the value directly and does
    // no hit-testing, so that step passes even with the menu covering it.)
    //
    // Closing it has to go through `-search`, not the opener. The field renders two
    // sibling controls: `-search-trigger` is the disabled react-select that only
    // displays the pills, and `-search` is the live react-select that owns the menu
    // and is swapped in when the trigger is clicked. Clicking the trigger's opener a
    // second time therefore does nothing to the menu — it stays at 12 options — and
    // a bare `page.keyboard.press('Escape')` is equally useless while focus is still
    // wherever the forced click left it.
    //
    // Keyboard does not do it either: Escape aimed at the combobox input leaves the
    // menu up, and blurring with Tab actually widens it from 12 rows to 39 (it drops
    // back to the full ungrouped list).
    //
    // Per GroupedSpecialtyPicker (frontend-monorepo,
    // webapps/provider-join/src/join/shared/components/GroupedSpecialtyPicker), a
    // click away from the field is the only supported close. It wraps Mezzanine's
    // searchable DropdownMulti, which exposes no close prop, no menuIsOpen, no
    // onBlur, no Done button and no auto-close — not even after the third of three
    // selections. The picker adds its own OutsideClickWrapper, whose handler fires on
    // a click anywhere in the document and toggles Mezzanine shut for us.
    //
    // Aimed at the card's top-left padding: outside the picker, above the menu's
    // anchor, and no interactive element there, so it cannot be intercepted or
    // trigger anything else.
    await page.getByTestId('reposition-form-card').click({ position: { x: 5, y: 5 } });

    // The picker's own "is it open" signal is the presence of the `-search` popover,
    // so assert on that rather than on an option count.
    await expect(page.getByTestId('reposition-grouped-specialty-input-search')).toHaveCount(0);

    // Guard, not a UI check: a silently-unselected dropdown would create the
    // practice with the wrong specialty. Read the pill the selection produces,
    // scoped to the field, so it cannot pass on some other mention of the word.
    await expect(
        page.getByTestId('reposition-grouped-specialty-input-wrapper').getByTestId('pill')
    ).toContainText(specialty);
}

test.describe('Create a test practice [repositioning_ga OFF]', () => {
    test.slow();

    test('Part 1 — register the account and reach the email confirmation step', async ({
        page,
        context,
    }) => {
        console.log(`Creating practice with tag "${ACCOUNT_TAG}" → ${EMAIL} / "${PRACTICE_NAME}"`);

        // Identity must be set before the first navigation, or the server mints its
        // own tracking id and buckets us by hash instead of by whitelist.
        await setTrackingId(context, VISITOR_ID_FLAG_OFF);

        await page.goto(SIGNUP_URL);
        await expect(page.getByTestId('reposition-form-card')).toBeVisible();

        await page.getByTestId('reposition-email-input-input').fill(EMAIL);
        await page.getByTestId('reposition-first-name-input-input').fill(FIRST_NAME);
        await page.getByTestId('reposition-last-name-input-input').fill(LAST_NAME);
        await page.getByTestId('reposition-phone-number-input-input').fill(PHONE_NUMBER);
        await page.getByTestId('reposition-password-input-input').fill(PASSWORD);
        await page.getByTestId('reposition-practice-name-input-input').fill(PRACTICE_NAME);

        await selectSpecialty(page, SPECIALTY);

        // Practice size is a native <select>, so the option value is what matters.
        await page.getByTestId('reposition-practice-size').selectOption(PRACTICE_SIZE);

        // Required before Continue will submit. The <input type="checkbox"> is
        // visually replaced, so the click has to go through the label — but click
        // the styled box (`checkbox-focus`), not the label itself. The label also
        // wraps a <button data-test="reposition-user-agreement-link"> and an
        // <a>Privacy Policy</a>, and Playwright clicks an element's centre, which
        // on this one-line label lands on that link text. Per the HTML spec, a
        // click on interactive content inside a <label> does not activate the
        // labelled control, so the click succeeds and the box stays unchecked.
        // `checkbox-focus` is a plain div, and it is the box a user aims at.
        await page
            .getByTestId('reposition-terms-and-privacy-checkbox-container')
            .getByTestId('checkbox-focus')
            .click();
        await expect(page.getByTestId('reposition-terms-and-privacy-checkbox')).toBeChecked();

        // The other two boxes in this group — reposition-sms-consent-checkbox and
        // reposition-transactional-sms-consent-checkbox — are opt-ins, not gates on
        // submit, so they are left unchecked on purpose.

        await page.getByTestId('reposition-submit-button').click();

        // Signup was accepted — if the email were already registered we would
        // still be on the form with an error instead. This URL change is the whole
        // success condition: the account exists and the verification mail is sent by
        // the time we land here. Deliberately no assertion on the confirm-email page
        // itself — it renders "Loading..." for a while after the redirect, and this
        // script only has to create the practice, not verify that page.
        await expect(page).toHaveURL(/\/provider\/setup\/account/);

        // The id on this URL identifies the account awaiting verification; hand
        // it to part 2 rather than copy-pasting it out of the browser.
        const setupId = new URL(page.url()).searchParams.get('id');
        const created = {
            accountTag: ACCOUNT_TAG,
            email: EMAIL,
            password: PASSWORD,
            practiceName: PRACTICE_NAME,
            setupId,
            setupUrl: page.url(),
            createdAt: new Date().toISOString(),
        };
        writeFileSync(CREATED_PRACTICE_FILE, `${JSON.stringify(created, null, 2)}\n`);

        console.log(`Practice registered. Verify the email for ${EMAIL}, then run part 2.`);
        console.log(`Details written to ${CREATED_PRACTICE_FILE} (setup id: ${setupId})`);
    });
});
