import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  bomFingerprint,
  buildBomSummaryCells,
  type BomElement,
  type BomSourceSheet,
  type BomStructure,
  type BomSummaryCell,
} from "./bom.js";

/**
 * Los casos de la lista que armaba el diseñador, celda a celda: `sub_design`
 * 90 y 91 con hijos plegados y desplegados, un ítem que ya no existe, un
 * catálogo borrado y los accesorios de la norma.
 */
type Case = {
  sheets: BomSourceSheet[];
  expanded: number[];
  bom: BomStructure;
  element: BomElement;
  cells: Record<string, BomSummaryCell>;
};
const cases = JSON.parse(
  readFileSync(new URL("../test/fixtures/bom-cases.json", import.meta.url), "utf8"),
) as Record<string, Case>;

describe("buildBomSummaryCells", () => {
  for (const [name, value] of Object.entries(cases)) {
    it(name, () => {
      const cells = buildBomSummaryCells(value.bom, new Set(value.expanded), value.sheets, value.element);
      expect(JSON.parse(JSON.stringify(cells))).toEqual(value.cells);
    });
  }

  it("los casos cubren lo que importa", () => {
    const all = JSON.stringify(cases);
    for (const text of ["(item no encontrado)", "(catálogo borrado)", "▼", "sin cantidad en la norma", "29552.27"]) {
      expect(all).toContain(text);
    }
  });
});

describe("bomFingerprint", () => {
  // Calculadas en el diseñador con crypto.subtle antes de traer la huella aquí
  const CLIENT = {
    "sub_design 90 · plegado": "f7c6852346570823d8cddaab6b4e6a925220eb027bfe2129473bd7b4b4571dd5",
    "accesorios de la norma": "f19ece038913dd934c725bb10605c89fadfd91d298a7655d450af659b5e92a9f",
  };

  for (const [name, expected] of Object.entries(CLIENT)) {
    it(`da la misma huella que el diseñador: ${name}`, () => {
      expect(bomFingerprint(cases[name]!.cells)).toBe(expected);
    });
  }

  it("no depende del orden de las celdas", () => {
    const cells = cases["sub_design 90 · plegado"]!.cells;
    expect(bomFingerprint(Object.fromEntries(Object.entries(cells).reverse()))).toBe(
      CLIENT["sub_design 90 · plegado"],
    );
  });
});
