/**
 * The migration list (ADR 0003 "Versioning and migrations"). Bump the version by adding a step here whenever
 * the payload shape changes. Each step ships with a fixture in tests/fixtures/saves/ and tests/save-migrations.test.ts
 * fails without one.
 */

/** One pure step from version `v` to `v + 1`. It takes the old payload and returns the new one. */
export type Migration = (payload: unknown) => unknown;

/** `MIGRATIONS[0]` takes version 1 to 2, `MIGRATIONS[1]` takes 2 to 3, and so on. In order, never edited once released. */
export const MIGRATIONS: readonly Migration[] = [];

/** The payload version this build writes. The first version is 1. */
export const SAVE_VERSION = MIGRATIONS.length + 1;

/** Runs every missing step, in order, on a payload of version `from`. A step that throws fails the whole run. */
export function migratePayload(payload: unknown, from: number, migrations: readonly Migration[] = MIGRATIONS): unknown {
  return migrations.slice(from - 1).reduce((current, step) => step(current), payload);
}
