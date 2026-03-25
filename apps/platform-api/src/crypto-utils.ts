import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { config } from "./config.js";

export const hashApiKey = (rawApiKey: string) =>
  createHash("sha256").update(rawApiKey).digest("hex");

export const hashPasswordLegacy = (rawPassword: string) =>
  createHash("sha256")
    .update(`${config.secretKey ?? "xllmapi-dev-secret-key"}:${rawPassword}`)
    .digest("hex");

const PASSWORD_HASH_PREFIX = "scrypt";
const PASSWORD_HASH_VERSION = "1";
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_SCRYPT_PARAMS = {
  N: 16_384,
  r: 8,
  p: 1
} as const;

const derivePasswordHash = (rawPassword: string, saltHex: string) =>
  scryptSync(
    `${config.secretKey ?? "xllmapi-dev-secret-key"}:${rawPassword}`,
    Buffer.from(saltHex, "hex"),
    PASSWORD_KEY_LENGTH,
    PASSWORD_SCRYPT_PARAMS
  );

export const hashPassword = (rawPassword: string) => {
  const saltHex = randomBytes(PASSWORD_SALT_BYTES).toString("hex");
  const derived = derivePasswordHash(rawPassword, saltHex).toString("hex");
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_VERSION}$${saltHex}$${derived}`;
};

export const verifyPassword = (rawPassword: string, storedHash: string) => {
  if (!storedHash.startsWith(`${PASSWORD_HASH_PREFIX}$`)) {
    return hashPasswordLegacy(rawPassword) === storedHash;
  }

  const [, version, saltHex, derivedHex] = storedHash.split("$");
  if (version !== PASSWORD_HASH_VERSION || !saltHex || !derivedHex) {
    return false;
  }

  const expected = Buffer.from(derivedHex, "hex");
  const actual = derivePasswordHash(rawPassword, saltHex);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export const passwordNeedsRehash = (storedHash: string) =>
  !storedHash.startsWith(`${PASSWORD_HASH_PREFIX}$${PASSWORD_HASH_VERSION}$`);

export const encryptSecret = (secret: string) => {
  const iv = randomBytes(12);
  const key = createHash("sha256")
    .update(config.secretKey ?? "xllmapi-dev-secret-key")
    .digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    alg: "aes-256-gcm",
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: encrypted.toString("hex")
  });
};

export const decryptSecret = (encryptedJson: string): string => {
  const { iv, tag, ciphertext } = JSON.parse(encryptedJson);
  const key = createHash("sha256")
    .update(config.secretKey ?? "xllmapi-dev-secret-key")
    .digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "hex")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
};
