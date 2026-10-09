import { describe, expect, it } from "vitest";
import { buildGraph } from "@rymel/formula-engine";
import { emptySheetStyles } from "./types.js";
import { toEngineBook } from "./book.js";
import type { TemplateDocument } from "./types.js";
import { traceCell, templateCellLookup } from "./trace.js";

const plantilla = (
  resumen: Record<string, { content: string; elementKey?: string }>,
  tablas: Record<string, { content: string }> = {},
): TemplateDocument => ({
  name: "P",
  code: "P",
  type: "DESIGN",
  status: "DRAFT",
  version: 0,
  sheets: [
    { name: "Resumen", position: 0, cells: resumen, styles: emptySheetStyles() },
    { name: "Tablas", position: 1, cells: tablas, styles: emptySheetStyles() },
  ],
});

const rastrear = (document: TemplateDocument, sheet: string, ref: string, full = false) =>
  traceCell(templateCellLookup(document), buildGraph(toEngineBook(document)), sheet, ref, {
    full,
    designFunctionCodes: ["QUADRATIC"],
  });

describe("traceCell", () => {
  it("la fórmula real de G17: precedentes locales y el rango de otra hoja, como se escribió", () => {
    const document = plantilla(
      {
        G17: { content: "=G14*(BUSCARV(G13;Tablas!B3:Tablas!C10;2;FALSO))" },
        G14: { content: "2" },
        G13: { content: "3" },
      },
      { B3: { content: "3" }, C3: { content: "10" } },
    );
    const trace = rastrear(document, "Resumen", "G17");

    expect(trace.precedents).toEqual([
      { sheet: "Resumen", ref: "G14" },
      { sheet: "Resumen", ref: "G13" },
      { sheet: "Tablas", ref: "B3:C10" },
    ]);
    // En la rejilla se resalta celda a celda, rango expandido incluido.
    expect(trace.highlight.precedents.has("Resumen!G14")).toBe(true);
    expect(trace.highlight.precedents.has("Tablas!C7")).toBe(true);
    expect(trace.highlight.precedents.size).toBe(2 + 16);
  });

  it("dependientes en otra hoja", () => {
    const document = plantilla(
      { A1: { content: "=Tablas!J14*2" }, A2: { content: "=Tablas!J14+1" } },
      { J14: { content: "5" } },
    );
    const trace = rastrear(document, "Tablas", "J14");
    expect(trace.dependents).toEqual([
      { sheet: "Resumen", ref: "A1" },
      { sheet: "Resumen", ref: "A2" },
    ]);
    expect(trace.precedents).toEqual([]);
  });

  it("la cadena completa llega a literales y a datos del elemento", () => {
    const document = plantilla({
      D1: { content: "=A5*2" },
      A5: { content: "=B2+C3" },
      B2: { content: "4" },
      C3: { content: "", elementKey: "power" },
    });
    const trace = rastrear(document, "Resumen", "D1", true);

    expect(trace.chain).toEqual([
      [{ sheet: "Resumen", ref: "A5", origin: "formula" }],
      [
        { sheet: "Resumen", ref: "B2", origin: "literal" },
        { sheet: "Resumen", ref: "C3", origin: "element", elementKey: "power" },
      ],
    ]);
    expect(trace.circular).toBe(false);
  });

  it("un ciclo termina y se señala", () => {
    const document = plantilla({ A1: { content: "=B1+1" }, B1: { content: "=A1*2" } });
    const trace = rastrear(document, "Resumen", "A1", true);
    expect(trace.circular).toBe(true);
    expect(trace.chain).toEqual([[{ sheet: "Resumen", ref: "B1", origin: "formula" }]]);
  });

  it("un literal no tiene precedentes, y sí dependientes", () => {
    const document = plantilla({ A1: { content: "7" }, B1: { content: "=A1*2" } });
    const trace = rastrear(document, "Resumen", "A1");
    expect(trace.precedents).toEqual([]);
    expect(trace.dependents).toEqual([{ sheet: "Resumen", ref: "B1" }]);
  });

  it("una fórmula de diseño se muestra con sus argumentos, sin su expresión", () => {
    const document = plantilla({
      A1: { content: "=QUADRATIC(B1+C1)*SUMA(D1:D3)" },
    });
    const trace = rastrear(document, "Resumen", "A1");
    expect(trace.designCalls).toEqual([
      {
        code: "QUADRATIC",
        refs: [
          { sheet: "Resumen", ref: "B1" },
          { sheet: "Resumen", ref: "C1" },
        ],
      },
    ]);
  });

  it("works with any cell reader, like the client's design sheets", () => {
    // The client keeps a formula and a value per cell, not a template
    const sheets: Record<string, Record<string, { formula: string; value: string }>> = {
      Resumen: { A1: { formula: "=Tablas!J14*2", value: "" } },
      Tablas: { J14: { formula: "", value: "5" } },
    };
    const book = {
      "Resumen!A1": { formula: "=Tablas!J14*2" },
      "Tablas!J14": { formula: "5" },
    };
    const lookup = (sheet: string, ref: string) => {
      const cell = sheets[sheet]?.[ref];
      return cell && { content: cell.formula || cell.value };
    };

    const trace = traceCell(lookup, buildGraph(book), "Tablas", "J14");
    const chain = traceCell(lookup, buildGraph(book), "Resumen", "A1", { full: true }).chain;

    expect(trace.dependents).toEqual([{ sheet: "Resumen", ref: "A1" }]);
    expect(chain).toEqual([[{ sheet: "Tablas", ref: "J14", origin: "literal" }]]);
  });
});

