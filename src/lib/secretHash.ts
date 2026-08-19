/**
 * Salted scrypt hashing for secrets stored in the DB (currently just
 * PoaDoctorsApiCredential.passwordHash — see apiBasicAuth.ts). Node's builtin
 * `crypto.scrypt`, not a third-party lib — this app has no existing
 * password-hashing dependency to reuse (User has no password field at all;
 * login is NIP-only) and scrypt is deliberately slow/memory-hard against
 * brute force, unlike a bare sha256.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const KEY_LENGTH = 64;

export function hashSecret(secret: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(secret, salt, KEY_LENGTH).toString("hex");
  return { hash, salt };
}

export function verifySecret(secret: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(secret, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}
