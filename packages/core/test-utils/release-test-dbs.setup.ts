import { afterAll } from "vitest";
import { releaseTestDatabases } from "./test-db.js";

// Every test file drops the databases it created when it finishes (ADR 0046).
// A setup file's hooks wrap the whole file, so this runs after the file's own
// `afterAll`s.
afterAll(releaseTestDatabases);
