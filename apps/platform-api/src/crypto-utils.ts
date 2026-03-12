import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { config } from "./config.js";

export const hashApiKey = (rawApiKey: string) =>
  createHash("sha256").update(rawApiKey).digest("hex");

export const hashPassword = (rawPassword: string) =>
  createHash("sha256")
    .update(`${config.secretKey ?? "xllmapi-dev-secret-key"}:${rawPassword}`)
    .digest("hex");

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
