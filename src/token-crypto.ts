const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(value: Uint8Array): string {
  return NodeBuffer.from(value).toString("base64url");
}

function fromBase64(value: string): Uint8Array {
  return new Uint8Array(NodeBuffer.from(value, "base64url"));
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptPaymentToken(token: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await deriveKey(secret),
    encoder.encode(token),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(encrypted))}`;
}

export async function decryptPaymentToken(value: string, secret: string): Promise<string> {
  const [version, encodedIv, encodedCiphertext] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedCiphertext) {
    throw new Error("Unsupported encrypted payment token");
  }
  const iv = Uint8Array.from(fromBase64(encodedIv));
  const ciphertext = Uint8Array.from(fromBase64(encodedCiphertext));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    await deriveKey(secret),
    ciphertext,
  );
  return decoder.decode(decrypted);
}
import { Buffer as NodeBuffer } from "node:buffer";
