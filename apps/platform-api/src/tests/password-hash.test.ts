import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { decryptSecret, encryptSecret, hashApiKey, hashPassword, passwordNeedsRehash, verifyPassword } from "../crypto-utils.js";

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

test("hashApiKey: same input produces same hash", () => {
  const hash1 = hashApiKey("xk_test_abc123");
  const hash2 = hashApiKey("xk_test_abc123");
  assert.equal(hash1, hash2);
});

test("hashApiKey: different inputs produce different hashes", () => {
  const hash1 = hashApiKey("xk_test_abc123");
  const hash2 = hashApiKey("xk_test_xyz789");
  assert.notEqual(hash1, hash2);
});

test("encryptSecret/decryptSecret: roundtrip produces original", () => {
  const secret = "sk-super-secret-provider-key-12345";
  const encrypted = encryptSecret(secret);
  const decrypted = decryptSecret(encrypted);
  assert.equal(decrypted, secret);
});

test("encryptSecret: each encryption produces different ciphertext", () => {
  const secret = "sk-same-secret";
  const encrypted1 = encryptSecret(secret);
  const encrypted2 = encryptSecret(secret);
  assert.notEqual(encrypted1, encrypted2);
});

test("hashPassword: each hash has unique salt", () => {
  const hash1 = hashPassword("SamePassword123!");
  const hash2 = hashPassword("SamePassword123!");
  assert.notEqual(hash1, hash2);
});
