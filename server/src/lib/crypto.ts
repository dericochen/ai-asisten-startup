import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let cachedKey: Buffer | null = null;

/**
 * Master key resolution: ACO_MASTER_KEY (base64, 32 bytes) or a key file generated on first use in
 * data/secrets/master.key. The key never enters the database, logs, or the frontend.
 */
export function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.ACO_MASTER_KEY;
  if (fromEnv) {
    const k = Buffer.from(fromEnv, 'base64');
    if (k.length !== 32) throw new Error('ACO_MASTER_KEY must be 32 bytes, base64-encoded');
    cachedKey = k;
    return k;
  }
  const file = path.join(config.secretsDir, 'master.key');
  if (!fs.existsSync(file)) {
    fs.mkdirSync(config.secretsDir, { recursive: true });
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  cachedKey = Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  return cachedKey;
}

export interface Encrypted { ciphertext: string; iv: string; tag: string }

export function encrypt(plaintext: string, key = masterKey()): Encrypted {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { ciphertext: ct.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

export function decrypt(e: Encrypted, key = masterKey()): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(e.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(e.ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

/** "sk-or-v1-abcdef...7F91" -> "sk-or-••••••••••7F91" */
export function maskSecret(value: string): string {
  const v = value.trim();
  if (v.length <= 8) return '••••••••';
  const prefixMatch = v.match(/^([a-zA-Z]{2,4}-(?:[a-zA-Z]{2,4}-)?)/);
  const prefix = prefixMatch ? prefixMatch[1].slice(0, 6) : '';
  return `${prefix}••••••••••${v.slice(-4)}`;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
