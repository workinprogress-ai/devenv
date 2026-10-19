// exit-codes.ts — suite-wide exit-code contract (port of error-handling.bash
// constants). The names and values are load-bearing: bats assertions across
// the suite assert on these numeric outcomes.
export const EXIT_SUCCESS = 0;
export const EXIT_GENERAL_ERROR = 1;
export const EXIT_MISUSE = 2;
export const EXIT_CONFLICT = 3;
export const EXIT_API_FAILURE = 4;
