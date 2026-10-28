import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256 } from "./sha256.js";

const node = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("sha256", () => {
  it("da los vectores de FIPS 180-4", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("da lo mismo que node:crypto con acentos, símbolos y textos de varios bloques", () => {
    for (const text of [
      "Fibra de 2 mm · Válvula de drenaje ▶ ▼ ñ",
      "😀 emoji fuera del plano básico",
      "x".repeat(55),
      "x".repeat(56),
      "x".repeat(64),
      "a".repeat(1000),
    ]) {
      expect(sha256(text)).toBe(node(text));
    }
  });
});
