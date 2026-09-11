import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Shared data for the provider onboarding practice-creation scripts.
 *
 * ACCOUNT_TAG is what makes each run a *new* practice. It drives the signup
 * email and the practice name, and it defaults to a timestamp so back-to-back
 * runs never collide — you no longer have to edit this file between practices.
 *
 * Pin the tag when you want a name you can find again, or when part 2
 * (post-verification) has to log in to the practice part 1 just created:
 *   ACCOUNT_TAG=onboardingnewNEXTECH1 npm test
 *
 * A tag is single-use: once signup completes that email is registered, and
 * re-running with the same tag is rejected as an existing account.
 */
function timestampTag(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `run${p(d.getFullYear() % 100)}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

export const ACCOUNT_TAG = process.env.ACCOUNT_TAG || timestampTag();

/** e.g. first.lastname+run2609041530@zocdoctest.com */
export const EMAIL = `first.lastname+${ACCOUNT_TAG}@zocdoctest.com`;

/** e.g. testpractice zocdoc run2609041530 */
export const PRACTICE_NAME = `testpractice zocdoc ${ACCOUNT_TAG}`;

export const PASSWORD = 'zocdoc@123';
export const PHONE_NUMBER = '2034872415';
export const FIRST_NAME = 'TestProvider';
export const LAST_NAME = 'Testaccount';

/** Label as rendered in the specialty dropdown. */
export const SPECIALTY = process.env.SPECIALTY || 'Dentist';

/** Native <select> option value, not the visible label. */
export const PRACTICE_SIZE = process.env.PRACTICE_SIZE || 'three_providers';

/** Where part 1 records what it created, so part 2 can pick it up. */
export const CREATED_PRACTICE_FILE = '.auth/last-created-practice.json';

/**
 * Visitor GUIDs whitelisted on `provider_onboarding_repositioning_ga` in AB
 * Management. The flag itself is off:100% / on:0%, so the variant comes entirely
 * from which identity we present — see setTrackingId() in ./ab.ts.
 *
 * Re-verify these in AB Management before trusting a run; a whitelist entry can
 * be edited or removed out from under the script.
 */
export const VISITOR_ID_FLAG_OFF =
    process.env.VISITOR_ID_FLAG_OFF || '11f8c6bb-69cf-4fed-9cf9-952623f4e9a0';

/* ------------------------------------------------------------------------- *
 * Part 2 — the provider we create after email verification.
 *
 * All of these are plain test data. Override any of them from the shell, e.g.
 *   PROVIDER_SPECIALTY='Critical Care Specialist' npm run test:headed
 * ------------------------------------------------------------------------- */

export const PROVIDER_FIRST_NAME = process.env.PROVIDER_FIRST_NAME || 'TestProvider';
export const PROVIDER_LAST_NAME = process.env.PROVIDER_LAST_NAME || 'Testprovider';

/** Radio label as rendered on the basic-info step. */
export const PROVIDER_GENDER = process.env.PROVIDER_GENDER || 'Male';

/** Option label in the provider specialty dropdown (not the signup one). */
export const PROVIDER_SPECIALTY = process.env.PROVIDER_SPECIALTY || 'Anesthesiologist';

/** Option label in the suffix dropdown. */
export const PROVIDER_SUFFIX = process.env.PROVIDER_SUFFIX || 'MD - Medical Doctor';

/** Contact details on the practice-contact step. */
export const CONTACT_FIRST_NAME = process.env.CONTACT_FIRST_NAME || FIRST_NAME;
export const CONTACT_LAST_NAME = process.env.CONTACT_LAST_NAME || LAST_NAME;

/** Virtual location address. Fields that the form does not render are skipped. */
export const LOCATION_STATE = process.env.LOCATION_STATE || 'New York';
export const LOCATION_ADDRESS = process.env.LOCATION_ADDRESS || '568 Broadway';
export const LOCATION_CITY = process.env.LOCATION_CITY || 'New York';
export const LOCATION_ZIP = process.env.LOCATION_ZIP || '10012';

/** Education step. INSTITUTION_QUERY is what we type; INSTITUTION is what we pick. */
export const INSTITUTION = process.env.INSTITUTION || 'New York University';
export const INSTITUTION_QUERY = process.env.INSTITUTION_QUERY || 'new yo';
export const DEGREE = process.env.DEGREE || 'Bachelor of Medicine';

export const ABOUT_STATEMENT =
    process.env.ABOUT_STATEMENT || 'Test provider created by automation. Not a real provider.';

/**
 * Profile photo for the upload step.
 *
 * `tests/assets/placeholder-photo.png` is the default and is checked in — a
 * generated 600x600 solid block, confirmed accepted by the photo step on
 * 2026-09-04. It is deliberately synthetic: a real headshot in a test fixture is
 * a real person's likeness, and this flow creates throwaway providers.
 *
 * To upload something else, point $PROVIDER_PHOTO at any path on disk — inside
 * the repo or not, `~` expanded:
 *   PROVIDER_PHOTO=~/Desktop/headshot.jpg npm run test:headed
 *
 * Both paths are resolved against this file rather than the shell's cwd, so a run
 * from an IDE behaves the same as one from the repo root.
 */
export const DEFAULT_PROVIDER_PHOTO = resolve(__dirname, 'assets/placeholder-photo.png');

/** Absolute path to the image the photo step should upload. */
export function resolveProviderPhoto(): string {
    const override = process.env.PROVIDER_PHOTO;

    // A wrong path is worth failing on rather than falling back to the default:
    // silently uploading a different image than the one asked for is the more
    // confusing outcome.
    if (override) {
        const expanded = override.startsWith('~') ? join(homedir(), override.slice(1)) : override;
        const absolute = resolve(expanded);
        if (!existsSync(absolute)) {
            throw new Error(`PROVIDER_PHOTO is set to "${override}", which does not exist.`);
        }
        return absolute;
    }

    if (!existsSync(DEFAULT_PROVIDER_PHOTO)) {
        throw new Error(
            `Missing ${DEFAULT_PROVIDER_PHOTO}. Restore it, or set PROVIDER_PHOTO to another image.`
        );
    }
    return DEFAULT_PROVIDER_PHOTO;
}

/** Where part 2 parks the logged-in session, so a re-run can skip the manual login. */
export const PROVIDER_STATE_FILE = '.auth/provider-state.json';
