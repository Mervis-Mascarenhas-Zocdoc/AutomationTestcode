import { writeFileSync } from 'node:fs';
import { test, type Locator, type Page } from '@playwright/test';
import {
    ABOUT_STATEMENT,
    CONTACT_FIRST_NAME,
    CONTACT_LAST_NAME,
    DEGREE,
    EMAIL,
    INSTITUTION,
    INSTITUTION_QUERY,
    LOCATION_ADDRESS,
    LOCATION_CITY,
    LOCATION_STATE,
    LOCATION_ZIP,
    PHONE_NUMBER,
    PROVIDER_FIRST_NAME,
    PROVIDER_GENDER,
    PROVIDER_LAST_NAME,
    PROVIDER_STATE_FILE,
    PROVIDER_SPECIALTY,
    PROVIDER_SUFFIX,
    resolveProviderPhoto,
} from './test-data';

/**
 * Practice creation — Part 2: create a provider, after email verification.
 *
 * Pure automation. There is not a single assertion in this file: nothing checks
 * text, visibility, step progress or whether anything worked. Every line is a
 * click, a fill, or an upload. Playwright already waits for an element to exist
 * and be clickable before acting on it, which is all the waiting a setup script
 * needs.
 *
 * Login is MANUAL. The script opens the provider login page and waits while you
 * type the email and password yourself. Once the browser reaches practice home it
 * takes over and fills in the wizard to the end.
 *
 * Run it headed, with the tag of the practice you verified:
 *   ACCOUNT_TAG=run2609041519 npm run test:headed -- provider-setup-post-verification
 */

/** 20 minutes: most of it is the human typing, and the wizard is 9 slow steps. */
const SCRIPT_TIMEOUT_MS = 20 * 60 * 1000;

/** How long we sit on the login page waiting for the manual sign-in to finish. */
const MANUAL_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/** Practice home, which is where a completed provider login lands. */
const PRACTICE_HOME_RE = /\/provider\/(pt_[^/]+)\/home/;

/** The add-provider wizard, which you open by hand once you are signed in. */
const SETUP_WIZARD_RE = /\/provider\/setup\//;

/** How long we wait for you to open the wizard. */
const MANUAL_STEP_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Pause after an interaction that makes the form rewrite itself — a dropdown
 * selection, a typeahead pick that autofills other fields, a step mounting.
 *
 * A fixed pause is normally the wrong tool, but this script has no assertions to
 * hang a wait on and it is not testing anything: it just needs the form to finish
 * repopulating before the next field is touched, so that the value it types is
 * not overwritten by an autofill landing a moment later.
 */
const SETTLE_MS = 2000;

/** How long a dropdown menu gets to render before we try opening it again. */
const MENU_TIMEOUT_MS = 10_000;

/**
 * Pause after the final submit, while the provider is actually created.
 *
 * Long on purpose: it covers the write that creates the provider and flips the
 * home-page task to complete, and it is also the window in which you can click
 * "Back to Home" — the browser is open until it elapses. Raise it if you want
 * more time.
 */
const PROVIDER_CREATION_MS = 30_000;

/** Lets the network go quiet and the form finish re-rendering. */
async function settle(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
}

/** The wizard's Continue button — same test id on every step. */
function continueButton(page: Page): Locator {
    return page.getByTestId('primary-button');
}

/**
 * Picks an option out of a react-select dropdown.
 *
 * The multi-selects ("select up to three") keep their menu open after a pick, and
 * the open menu floats over the fields below and swallows their clicks — so pass
 * `closeAfter` to toggle it shut with the same control that opened it. Escape does
 * not close it: clicking the control never moves focus into react-select's input,
 * so there is no keyboard target for the key to reach.
 */
async function selectOption(
    page: Page,
    control: Locator,
    optionLabel: string,
    { closeAfter = false } = {}
): Promise<void> {
    // Wait for the step to be done loading before touching the control. Clicking
    // a react-select before the page has hydrated is a no-op: the click lands on
    // markup with no handler attached yet, so no menu ever opens and the script
    // then waits forever for an option that cannot appear. This is what made the
    // specialty dropdown need a manual click.
    await settle(page);

    const option = page.getByRole('option', { name: optionLabel }).first();

    // And if the menu still does not open, open it again rather than hanging —
    // one dropped click should not cost the whole run.
    for (let attempt = 1; ; attempt++) {
        await control.click();
        try {
            await option.waitFor({ state: 'visible', timeout: MENU_TIMEOUT_MS });
            break;
        } catch (error) {
            if (attempt === 3) throw error;
            console.log(`Dropdown did not open for "${optionLabel}" — retrying.`);
        }
    }

    await option.click();

    // Selecting rebuilds the field (the value becomes a pill, and on some steps
    // sibling fields re-render with it), so let that finish.
    await page.waitForTimeout(SETTLE_MS);

    if (closeAfter) await control.click();
}

/**
 * Types into a react-select's search input and picks the match.
 *
 * For the dropdowns with no `data-test` on their control — only hashed emotion
 * classes (`.css-zok7rj`) that change with any style edit. react-select's own
 * input keeps a stable `id="react-select-N-input"`, and within one modal or step
 * there is a single such field.
 */
async function searchSelect(page: Page, query: string, optionLabel: string): Promise<void> {
    await page.locator('input[id^="react-select-"]').last().fill(query);
    await page.getByRole('option', { name: optionLabel }).first().click();

    // Picking here can autofill the rest of the form (choosing the state
    // repopulates the address fields in the location modal). Wait for that to
    // land, or the values typed next get clobbered by it.
    await settle(page);
}

/**
 * Fills a field only if the form renders it.
 *
 * The add-location modal shows different address fields per location type (a
 * virtual location asks for less than a physical one), so a plain fill would die
 * on a field the form never wanted.
 */
async function fillIfPresent(page: Page, testId: string, value: string): Promise<void> {
    const field = page.getByTestId(testId);
    if ((await field.count()) === 0) return;
    await field.first().fill(value);
}

/**
 * Uploads the profile photo — tests/assets/placeholder-photo.png unless
 * $PROVIDER_PHOTO overrides it (see resolveProviderPhoto() in test-data.ts).
 *
 * The recorder wrote `page.locator('body').setInputFiles(...)`, which cannot
 * work. What replaces it depends on what the target actually is:
 *
 *  - the real <input type="file"> → set the files straight on it. Sturdier,
 *    because setInputFiles does not need the element to be visible, and these
 *    inputs usually sit hidden behind a styled button.
 *  - a visible trigger → click it and catch the OS file chooser. The listener has
 *    to be registered BEFORE the click; the event fires during it, so awaiting it
 *    afterwards deadlocks.
 */
async function uploadProfilePhoto(page: Page): Promise<void> {
    const photo = resolveProviderPhoto();
    console.log(`Uploading photo: ${photo}`);

    const target = page.getByTestId('add-provider-profile-photo-input').first();
    const isFileInput = await target.evaluate(
        (el) => el instanceof HTMLInputElement && el.type === 'file'
    );

    if (isFileInput) {
        await target.setInputFiles(photo);
    } else {
        const chooser = page.waitForEvent('filechooser');
        await target.click();
        await (await chooser).setFiles(photo);
    }

    // The upload is a network round trip and Continue can be gated on it, so let
    // it land before moving on.
    await page.waitForLoadState('networkidle');
}

test.describe('Create a test provider [post email verification]', () => {
    test('Part 2 — sign in manually, then create the provider end to end', async ({
        page,
        context,
    }) => {
        test.setTimeout(SCRIPT_TIMEOUT_MS);

        // ---------------------------------------------------------------- login
        // Entering through the header dropdown rather than jumping to
        // provider-auth.zocdoc.com directly: that URL carries a one-time `state`
        // tied to the auth transaction, so a hardcoded one is dead on arrival.
        await page.goto('/');
        await page.getByTestId('signin-dropdown-bar').click();
        await page.getByTestId('signin-dropdown-doctor-login').click();

        console.log('\n' + '='.repeat(72));
        console.log('  MANUAL STEP: sign in in the browser window that just opened.');
        console.log(`  Email to use: ${EMAIL}`);
        console.log('  Enter the email, press Continue, enter the password, press Continue.');
        console.log('  The script resumes on its own once the practice home page loads.');
        console.log('='.repeat(72) + '\n');

        // The handoff back to automation: the only signal that matters is the
        // browser arriving at practice home, however many screens that took.
        await page.waitForURL(PRACTICE_HOME_RE, { timeout: MANUAL_LOGIN_TIMEOUT_MS });

        const practiceId = PRACTICE_HOME_RE.exec(page.url())?.[1];
        console.log(`Signed in. Practice: ${practiceId}`);

        // Park the session so a re-run can point storageState at it and skip login.
        await context.storageState({ path: PROVIDER_STATE_FILE });

        console.log('\n' + '='.repeat(72));
        console.log('  MANUAL STEP: dismiss any modal/tour and open the add-provider flow');
        console.log('  yourself (the "Add a provider" task on the home page).');
        console.log('  The script resumes once the setup wizard URL loads.');
        console.log('='.repeat(72) + '\n');

        // Second handoff: you click into the wizard, the script picks it up from
        // the URL that lands. Nothing before this point is automated any more.
        await page.waitForURL(SETUP_WIZARD_RE, { timeout: MANUAL_STEP_TIMEOUT_MS });
        console.log('Wizard open — taking over.');

        // ------------------------------------------------- step 1: entity type
        await page.getByTestId('provider-tile-description').click();
        await continueButton(page).click();

        // --------------------------------------------------- step 2: the name
        // Indexed ids (`-0-`) because the step supports several providers at once.
        await page.getByTestId('multi-first-name-0-input').fill(PROVIDER_FIRST_NAME);
        await page.getByTestId('multi-last-name-0-input').fill(PROVIDER_LAST_NAME);
        await continueButton(page).click();

        // With the NPI left empty, that Continue opens "We strongly recommend
        // adding NPI(s)" instead of advancing. Answer it to stay NPI-less.
        await page.getByTestId('empty-npi-modal-continue').click();

        // ------------------------------------------- step 3: provider category
        await page.getByTestId('doctor-physician-tile-description').click();
        await continueButton(page).click();

        // ------------------------------------------- step 4: basic information
        await settle(page);

        // Gender is a styled radio with no test id; the label is the only handle,
        // and `exact` keeps 'Male' off 'Female'.
        await page.getByText(PROVIDER_GENDER, { exact: true }).click();
        await page.getByTestId('patient-type-checkbox-0-label-text').click();

        await selectOption(page, page.getByTestId('specialty-dropdown'), PROVIDER_SPECIALTY, {
            closeAfter: true,
        });
        await selectOption(page, page.getByTestId('suffix-select'), PROVIDER_SUFFIX, {
            closeAfter: true,
        });

        await page.getByTestId('contact-first-name-input').fill(CONTACT_FIRST_NAME);
        await page.getByTestId('contact-last-name-input').fill(CONTACT_LAST_NAME);
        await page.getByTestId('contact-phone-number-input').fill(PHONE_NUMBER);
        await page.getByTestId('contact-email-input').fill(EMAIL);
        await continueButton(page).click();

        // ------------------------------------------------- step 5: locations
        // Virtual-only: the cheapest location to create, with no physical-office
        // follow-up questions.
        await settle(page);
        await page.getByTestId('location-preference-checkbox-isVirtualLocation-label-text').click();
        await page.getByTestId('add-location-button-_virtual').click();
        await settle(page);

        await searchSelect(page, LOCATION_STATE.slice(0, 3), LOCATION_STATE);

        // Fill everything the modal offers in one pass, then save once. The
        // recording saved twice only because it found the phone field after the
        // first attempt bounced.
        await fillIfPresent(page, 'address1-input', LOCATION_ADDRESS);
        await fillIfPresent(page, 'city-input', LOCATION_CITY);
        await fillIfPresent(page, 'zip-input', LOCATION_ZIP);
        await fillIfPresent(page, 'modal-phone-input', PHONE_NUMBER);
        await fillIfPresent(page, 'emailAddresses-0-input', EMAIL);

        // Everything is in the form; give it a beat to settle before saving, so
        // the modal submits the populated values rather than a half-filled state.
        await settle(page);
        await page.getByTestId('add-location-modal-button').click();

        // Saving posts the location and re-renders the step with it in the list.
        // Continue is only meaningful once that has come back.
        await settle(page);
        await continueButton(page).click();

        // ---------------------------------------------- step 6: insurance etc.
        // Nothing to fill here, so take the default and move on. This is the one
        // place two Continues land back to back on the same test id, so let the
        // next step mount instead of clicking the old button twice.
        await page.waitForLoadState('networkidle');
        await continueButton(page).click();

        // ------------------------------------------------- step 7: education
        // Typeahead against a real school index. The suggestion row renders name
        // and location run together ("New York UniversityNew York, NY"), hence the
        // start-anchored regex rather than an exact match.
        await page.getByTestId('ac-primary-institution-input').fill(INSTITUTION_QUERY);
        await page.getByText(new RegExp(`^${INSTITUTION}`)).first().click();
        await searchSelect(page, DEGREE, DEGREE);
        await continueButton(page).click();

        // --------------------------------------------------- step 8: about
        await page.getByTestId('about-statement-text-area').fill(ABOUT_STATEMENT);
        await continueButton(page).click();

        // --------------------------------------------------- step 9: photo
        await uploadProfilePhoto(page);
        await continueButton(page).click();

        // ------------------------------------------------------ review / finish
        await page.waitForLoadState('networkidle');
        await continueButton(page).click();

        // Wait for the provider to actually get created. Cutting this short is what
        // left the home-page task stuck in progress — and the browser stays open
        // for this whole window, so it is also your chance to click "Back to Home".
        await page.waitForTimeout(PROVIDER_CREATION_MS);

        const created = {
            practiceId,
            email: EMAIL,
            providerName: `${PROVIDER_FIRST_NAME} ${PROVIDER_LAST_NAME}`,
            specialty: PROVIDER_SPECIALTY,
            finishedAt: new Date().toISOString(),
            finalUrl: page.url(),
        };
        writeFileSync('.auth/last-created-provider.json', `${JSON.stringify(created, null, 2)}\n`);

        console.log(
            `Provider "${created.providerName}" created for practice ${practiceId}.\n` +
                `Ended on: ${page.url()}`
        );
    });
});
