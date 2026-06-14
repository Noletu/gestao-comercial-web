import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Criptografia simétrica para segredos em repouso (ex.: access_token da Nuvemshop).
 *
 * Escolha: AES-256-GCM (autenticado) com a chave vinda do env (ENCRYPTION_KEY),
 * NÃO no banco. Assim a chave e o dado cifrado ficam em lugares separados — vazar
 * o banco não basta para ler os tokens. GCM também detecta adulteração (authTag).
 *
 * Formato persistido: "iv:authTag:ciphertext" (cada parte em base64).
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits — recomendado para GCM
const KEY_LENGTH = 32; // 256 bits

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY não definida no ambiente.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY inválida: esperado ${KEY_LENGTH} bytes (base64), obtido ${key.length}.`,
    );
  }
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decrypt(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Payload criptografado em formato inválido.");
  }
  const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string];
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
