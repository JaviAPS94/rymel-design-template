/**
 * Los casos válidos de aquí no son inventados: son la celda `K73` de la
 * plantilla real y los ejemplos que la ayuda del diseñador
 * (`InstructionsModal.tsx`) le enseña al usuario. Si el validador rechazara
 * cualquiera de ellos, estaría rechazando lo que el producto documenta.
 */

import { describe, expect, it } from "vitest";
import {
  isGraphicContent,
  normalizeGraphicContent,
  parseGraphicDirective,
} from "./graphic.js";

const K73 =
  "DRAW:BOBINADO:D56:D59,D60,D61,D62:M59,M60,M61,M62:H59,H60,H61,H62:Q59,Q60,Q61,Q62:E56:G56:H56:I56";

const EJEMPLOS_DE_LA_AYUDA = [
  "DRAW:FRONTAL:NUCLEO:H53,H54",
  "DRAW:SUPERIOR:NUCLEO,BOBINA:,H54:S55",
  "DRAW:FRONTAL:TANQUE,NUCLEO,BOBINA:H53,H54::AD53,AD55",
  "DRAW:SUPERIOR:TANQUE,NUCLEO,BOBINA:,H54:S55:,AD55",
];

describe("reconocimiento", () => {
  it("reconoce la directiva con `=` y sin él", () => {
    expect(isGraphicContent(`=${K73}`)).toBe(true);
    expect(isGraphicContent(K73)).toBe(true);
  });

  it("no confunde una fórmula ni un literal con una directiva", () => {
    expect(isGraphicContent("=SUMA(A1:A2)")).toBe(false);
    expect(isGraphicContent("Dibujo del núcleo")).toBe(false);
    expect(isGraphicContent("")).toBe(false);
    expect(isGraphicContent(undefined)).toBe(false);
  });

  it("le quita el `=` inicial", () => {
    expect(normalizeGraphicContent(`=${K73}`)).toBe(K73);
    expect(normalizeGraphicContent(K73)).toBe(K73);
  });
});

describe("análisis", () => {
  it("acepta la celda K73 de la plantilla real", () => {
    const resultado = parseGraphicDirective(`=${K73}`);

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.directive.view).toBe("BOBINADO");
    expect(resultado.directive.referencedCells).toContain("D56");
    expect(resultado.directive.referencedCells).toContain("I56");
  });

  it.each(EJEMPLOS_DE_LA_AYUDA)("acepta el ejemplo documentado %s", (ejemplo) => {
    expect(parseGraphicDirective(ejemplo).ok).toBe(true);
  });

  it("lee los componentes de una vista frontal", () => {
    const resultado = parseGraphicDirective(
      "DRAW:FRONTAL:TANQUE,NUCLEO,BOBINA:H53,H54::AD53,AD55",
    );

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.directive.components).toEqual(["TANQUE", "NUCLEO", "BOBINA"]);
  });

  it("rechaza una vista que no existe", () => {
    const resultado = parseGraphicDirective("DRAW:LATERAL:NUCLEO:H53");

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.problems[0]!.message).toContain("LATERAL");
  });

  it("rechaza un componente mal escrito", () => {
    // El renderizador lo ignora en silencio y dibuja de menos: el autor no se
    // entera hasta que alguien abre el diseño.
    const resultado = parseGraphicDirective("DRAW:FRONTAL:NUCLEOO:H53,H54");

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.problems[0]!.message).toContain("NUCLEOO");
  });

  it("rechaza una referencia de celda mal formada", () => {
    const resultado = parseGraphicDirective("DRAW:FRONTAL:NUCLEO:H5X,H54");

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.problems[0]!.message).toContain("H5X");
  });

  it("rechaza una vista sin ningún componente", () => {
    const resultado = parseGraphicDirective("DRAW:FRONTAL::H53,H54");

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.problems[0]!.message).toContain("componente");
  });

  it("rechaza una directiva sin argumentos", () => {
    expect(parseGraphicDirective("DRAW:FRONTAL").ok).toBe(false);
  });

  it("informa de todos los problemas a la vez, no solo del primero", () => {
    const resultado = parseGraphicDirective("DRAW:FRONTAL:NUCLEOO:H5X,H54");

    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.problems.length).toBeGreaterThan(1);
  });

  it("admite los segmentos vacíos, que significan «este dato no se indica»", () => {
    const resultado = parseGraphicDirective("DRAW:SUPERIOR:NUCLEO,BOBINA:,H54:S55");

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.directive.referencedCells).toEqual(["H54", "S55"]);
  });
});
