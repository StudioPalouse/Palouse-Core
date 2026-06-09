import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function keyFromHex(keyHex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) {
    throw new Error('Encryption key must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

/** AES-256-GCM. Output layout: iv (12) | auth tag (16) | ciphertext. */
export function encryptSecret(plaintext: string, keyHex: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, keyFromHex(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptSecret(payload: Buffer, keyHex: string): string {
  const iv = payload.subarray(0, IV_LEN);
  const tag = payload.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = payload.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, keyFromHex(keyHex), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
