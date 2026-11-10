/** Single source of truth for naming, so a rename touches one file. */
export const BRAND = {
  name: "Necropolis",
  domain: "necropolis",
  tagline: "Bury your bag. Keep the upside.",
  description:
    "A graveyard for dead memecoins on Solana and Base. Bury a dead token in a vault only NEAR can open. If it ever comes back, you get it back — and every other grave shares the tithe.",
  repo: "https://github.com/BoyofMars/necropolis",
  /** Shown wherever the name might be confused with an unrelated project. */
  disambiguation:
    "Not affiliated with necropolis.fund (a Robinhood Chain bonding-curve project). This Necropolis buries Solana and Base tokens and verifies them on NEAR.",
} as const;
