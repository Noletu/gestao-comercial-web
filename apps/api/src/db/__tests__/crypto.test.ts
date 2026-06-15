import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../crypto.js";

describe("crypto — AES-256-GCM para tokens em repouso", () => {
  it("faz round-trip de encrypt/decrypt", () => {
    const plaintext = "nuvemshop_access_token_secreto_123";
    const cipher = encrypt(plaintext);
    expect(cipher).not.toContain(plaintext);
    expect(decrypt(cipher)).toBe(plaintext);
  });

  it("gera IV novo a cada chamada (cifras diferentes para o mesmo texto)", () => {
    expect(encrypt("mesmo-texto")).not.toBe(encrypt("mesmo-texto"));
  });

  it("detecta adulteração do ciphertext (authTag do GCM)", () => {
    const cipher = encrypt("integridade");
    const [iv, tag, data] = cipher.split(":");
    const tamperedData = Buffer.from(data ?? "", "base64");
    tamperedData[0] = (tamperedData[0] ?? 0) ^ 0xff;
    const tampered = [iv, tag, tamperedData.toString("base64")].join(":");
    expect(() => decrypt(tampered)).toThrow();
  });
});
