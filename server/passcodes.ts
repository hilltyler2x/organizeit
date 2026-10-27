// Owner passcodes. Each one belongs to a single phone: the first phone to unlock with it claims
// it, and from then on it works only there. A new phone gets a new passcode (APP_PASSCODE takes
// several, comma-separated). Passcodes are stored hashed, so the database never holds them.

import { createHash } from "node:crypto";
import type { Pool } from "pg";

export interface PasscodeOwners {
  /** Gives the passcode to `phone` if no phone has it yet. Returns the phone that has it. */
  claim(passcode: string, phone: string): Promise<string>;
}

const hash = (passcode: string) => createHash("sha256").update(`organizeit-passcode:${passcode}`).digest("hex");

/** Forgets every claim when the server restarts; for tests and servers without a database. */
export function memoryOwners(): PasscodeOwners {
  const owners = new Map<string, string>();
  return {
    async claim(passcode, phone) {
      const key = hash(passcode);
      if (!owners.has(key)) owners.set(key, phone);
      return owners.get(key)!;
    },
  };
}

export async function postgresOwners(pool: Pool): Promise<PasscodeOwners> {
  await pool.query(`CREATE TABLE IF NOT EXISTS passcode_owners (
    code_hash text PRIMARY KEY,
    phone text NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT now()
  )`);
  return {
    async claim(passcode, phone) {
      const key = hash(passcode);
      // Two phones racing for the same passcode: only one insert lands, both read the winner.
      await pool.query("INSERT INTO passcode_owners (code_hash, phone) VALUES ($1, $2) ON CONFLICT (code_hash) DO NOTHING", [key, phone]);
      const r = await pool.query<{ phone: string }>("SELECT phone FROM passcode_owners WHERE code_hash = $1", [key]);
      return r.rows[0].phone;
    },
  };
}
