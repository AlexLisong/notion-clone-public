import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function randomToken(): string { return randomBytes(32).toString("base64url"); }
const derive = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key));
});
export function validPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128;
}
export async function hashPassword(password: string): Promise<string> {
  if (!validPassword(password)) throw new Error("Passwords must contain 12–128 characters.");
  const salt = randomBytes(16);
  return `scrypt:${salt.toString("hex")}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const actual = await derive(password, Buffer.from(salt, "hex"));
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}
