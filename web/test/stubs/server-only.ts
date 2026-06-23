// Test-only stub for the `server-only` package. The real package throws when
// imported into a client bundle; under Vitest we want pure server libs to be
// importable for unit testing. This stub intentionally does nothing.
export {};
