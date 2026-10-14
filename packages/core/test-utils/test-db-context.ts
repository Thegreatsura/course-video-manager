/**
 * The vitest context key the test database travels on: the server, this run's
 * name prefix and its TEMPLATE database (ADR 0046).
 *
 * Its own module because both ends need the augmentation in scope — the global
 * setup that provides it, and `createTestDb` in any workspace that injects it —
 * and a `declare module` only applies where it is part of the program.
 * Side-effect-imported from both.
 */
declare module "vitest" {
  export interface ProvidedContext {
    testDatabase: {
      /** The admin connection string (database `postgres`). */
      serverUrl: string;
      /** Every database this run creates starts with it. */
      runPrefix: string;
      /** The migrated database every test database is cloned from. */
      template: string;
    };
  }
}

export {};
