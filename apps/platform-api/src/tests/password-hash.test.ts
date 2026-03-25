import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { hashPassword, passwordNeedsRehash, verifyPassword } from "../crypto-utils.js";

const legacyHash = (rawPassword: string) =>
  createHash("sha256")
    .update(`${process.env.XLLMAPI_SECRET_KEY ?? "xllmapi-dev-secret-key"}:${rawPassword}`)
    .digest("hex");

test("hashPassword creates verifiable scrypt hashes", () => {
  const hash = hashPassword("TestPass123!");

  assert.match(hash, /^scrypt\$1\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.equal(verifyPassword("TestPass123!", hash), true);
  assert.equal(verifyPassword("WrongPass123!", hash), false);
  assert.equal(passwordNeedsRehash(hash), false);
});

test("legacy sha256 hashes still verify and require rehash", () => {
  const hash = legacyHash("LegacyPass123!");

  assert.equal(verifyPassword("LegacyPass123!", hash), true);
  assert.equal(verifyPassword("WrongLegacyPass123!", hash), false);
  assert.equal(passwordNeedsRehash(hash), true);
});
