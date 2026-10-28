import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateSheet } from "@rymel/formula-engine";
import {
  BOM_BASE_SHEET_NAME,
  bomBaseSheet,
  buildBomBaseSheet,
  evaluateBomBase,
  withAccessories,
} from "./bomBase.js";
import {
  buildBomSummaryCells,
  type BomElement,
  type BomSourceSheet,
  type BomStructure,
  type BomStructureNode,
  type BomSummaryCell,
} from "./bom.js";
import { sheetToBook } from "./book.js";
import { readSheet, writeSheet } from "./serialize.js";
import { validateTemplate } from "./validate.js";
import { emptySheetStyles, type TemplateDocument, type TemplateSheet } from "./types.js";

type Case = { sheets: BomSourceSheet[]; bom: BomStructure; element: BomElement };
const cases = JSON.parse(
  readFileSync(new URL("../test/fixtures/bom-cases.json", import.meta.url), "utf8"),
) as Record<string, Case>;

/**
 * La hoja guardada de un diseño, como hoja de plantilla. Lo calculado va como
 * literal: así se evalúa sin las fórmulas de diseño, que son del servidor.
 */
const asTemplateSheet = (sheet: BomSourceSheet): TemplateSheet => ({
  name: sheet.name,
  position: 0,
  cells: Object.fromEntries(
    Object.entries(sheet.cells).flatMap(([ref, cell]) => {
      if (!cell) return [];
      const shown = cell.computed ?? cell.value ?? "";
      return [[ref, {
        content: String(shown),
        ...(cell.itemLink ? { itemLink: { catalogSheetName: sheet.name, catalogTableId: cell.itemLink.catalogTableId, itemId: cell.itemLink.itemId } } : {}),
      }]];
    }),
  ),
  styles: {
    ...emptySheetStyles(),
    semiFinishedZones: (sheet.semiFinishedZones ?? []).map((zone, index) => ({
      id: `z${index}`,
      semiFinishedId: zone.semiFinishedId,
      semiFinishedCode: "",
      semiFinishedName: "",
      startCell: zone.startCell ?? "",
      endCell: zone.endCell ?? "",
    })),
    itemCatalogTables: (sheet.itemCatalogTables ?? []).map((table) => ({ ...table, name: table.id })),
  },
});

const STRUCTURE = { ...cases["sub_design 90 · plegado"]!.bom, id: 2, code: "1-25-220-120", name: "Estructura de prueba" };
const allNodeIds = (nodes: BomStructureNode[]): number[] =>
  nodes.flatMap((node) => [node.id, ...allNodeIds(node.children)]);
const NO_ACCESSORIES: BomElement = { values: "[]" };

/** La base calculada: sus celdas con el valor que da el motor. */
const evaluatedBase = async (designSheet: TemplateSheet, base: TemplateSheet) => {
  const book = { ...sheetToBook(designSheet), ...sheetToBook(base) };
  const { values } = await evaluateSheet(book);
  return Object.fromEntries(
    Object.keys(base.cells).map((ref) => {
      const value = values[`${base.name}!${ref}`];
      return [ref, { value: value === undefined || value === null ? "" : String(value) }];
    }),
  );
};

describe("buildBomBaseSheet", () => {
  const designSheet = asTemplateSheet(cases["sub_design 90 · plegado"]!.sheets[0]!);
  const base = buildBomBaseSheet(STRUCTURE, [designSheet]);

  it("es la hoja «Lista de materiales», marcada con su estructura", () => {
    expect(base.name).toBe(BOM_BASE_SHEET_NAME);
    expect(base.styles.billOfMaterials).toEqual({
      structureId: 2,
      structureCode: "1-25-220-120",
      structureName: "Estructura de prueba",
    });
    expect(bomBaseSheet([designSheet, base])).toBe(base);
  });

  it("la cantidad, la descripción y la unidad del ítem vinculado son fórmulas", () => {
    const row = Object.entries(base.cells).find(([ref, cell]) => ref.startsWith("B") && cell.content === "240")![0].slice(1);
    expect(base.cells[`D${row}`]!.content).toBe("=Hoja1!L50");
    expect(base.cells[`C${row}`]!.content).toMatch(/^=Hoja1![A-Z]+\d+$/);
    expect(base.cells[`E${row}`]!.content).toMatch(/^=Hoja1![A-Z]+\d+$/);
  });

  it("calculada, da las mismas filas que la lista de hoy con todo desplegado", async () => {
    for (const name of ["sub_design 90 · plegado", "sub_design 91 · plegado"]) {
      const runtime = cases[name]!.sheets[0]!;
      const sheet = asTemplateSheet(runtime);
      const computed = await evaluatedBase(sheet, buildBomBaseSheet(STRUCTURE, [sheet]));
      const today = buildBomSummaryCells(STRUCTURE, new Set(allNodeIds(STRUCTURE.nodes)), [runtime], NO_ACCESSORIES);
      for (const [ref, cell] of Object.entries(today)) {
        // En la base no hay ▶/▼: los hijos van siempre desplegados
        if (ref.startsWith("A") && (cell.value === "▼" || cell.value === "▶")) continue;
        expect(computed[ref]?.value ?? "", `${name} ${ref}`).toBe(cell.value);
      }
    }
  });

  it("un nombre de hoja con espacios va entre comillas", () => {
    const spaced = { ...designSheet, name: "Hoja de cálculo" };
    const cells = buildBomBaseSheet(STRUCTURE, [spaced]).cells;
    expect(Object.values(cells).some((cell) => cell.content === "='Hoja de cálculo'!L50")).toBe(true);
  });

  it("la marca sobrevive a guardar y volver a leer", () => {
    const read = readSheet(writeSheet(base), 1);
    expect(read.styles.billOfMaterials).toEqual(base.styles.billOfMaterials);
    expect(readSheet(writeSheet(designSheet), 0).styles.billOfMaterials).toBeUndefined();
  });
});

describe("familias de fantasmas en el árbol", () => {
  // El servidor añade `phantomFamilies` a cada nodo; aquí, F. Acc Sol bajo la raíz
  const ROOT_ID = STRUCTURE.nodes[0]!.id;
  const withFamilies = (nodes: BomStructureNode[]): BomStructureNode[] =>
    nodes.map((node) => ({
      ...node,
      phantomFamilies:
        node.id === ROOT_ID
          ? [{ id: 1, family: { id: 20, name: "F. Acc Sol" }, process: { id: 5, name: "METALMECANICA" } }]
          : [],
      children: withFamilies(node.children),
    }));
  const families = { ...STRUCTURE, nodes: withFamilies(STRUCTURE.nodes) };
  const runtime = cases["sub_design 90 · plegado"]!.sheets[0]!;
  const sheet = asTemplateSheet(runtime);
  const rowOf = (cells: Record<string, { content?: string; value?: string }>, text: string) =>
    Number(Object.entries(cells).find(([ref, c]) => ref.startsWith("B") && (c.content ?? c.value) === text)?.[0].slice(1));

  it("la base lleva una fila por familia en la sección de su semielaborado", () => {
    const base = buildBomBaseSheet(families, [sheet]);
    const row = rowOf(base.cells, "F. Acc Sol");
    expect(base.cells[`C${row}`]!.content).toBe("Fantasma : METALMECANICA");
    expect([base.cells[`D${row}`]!.content, base.cells[`E${row}`]!.content]).toEqual(["1", "UND"]);
    expect(base.cells[`I${row}`]!.content).toBe("Fantasma por elegir");
    expect(base.cells[`B${row}`]!.format?.backgroundColor).toBe("#ede9fe");
    // Después de los semielaborados hijos y antes de los ítems de la raíz
    const rootTitle = rowOf(base.cells, `Semielaborado : ${STRUCTURE.nodes[0]!.semiFinished.name}`);
    const childCodes = STRUCTURE.nodes[0]!.children.map((child) => rowOf(base.cells, child.semiFinished.code));
    expect(row).toBeGreaterThan(rootTitle);
    childCodes.forEach((childRow) => expect(row).toBeGreaterThan(childRow));
    expect(base.cells[`B${row + 1}`]?.content).not.toBe("");
  });

  it("calculada, sigue dando las mismas filas que la lista generada", async () => {
    const computed = await evaluatedBase(sheet, buildBomBaseSheet(families, [sheet]));
    const today = buildBomSummaryCells(families, new Set(allNodeIds(STRUCTURE.nodes)), [runtime], NO_ACCESSORIES);
    expect(Object.values(today).some((c) => c.value === "F. Acc Sol")).toBe(true);
    for (const [ref, cell] of Object.entries(today)) {
      if (ref.startsWith("A") && (cell.value === "▼" || cell.value === "▶")) continue;
      expect(computed[ref]?.value ?? "", ref).toBe(cell.value);
    }
  });

  it("los accesorios siguen al final de la sección, tras las familias", () => {
    // Los accesorios de la norma de prueba son del semielaborado 1
    const cells: Record<string, BomSummaryCell> = {
      A1: { value: "1", formula: "1", computed: "1" },
      B1: { value: "Semielaborado : SF 1", formula: "", computed: "" },
      B2: { value: "Item", formula: "", computed: "" },
      B3: { value: "F. Acc Sol", formula: "", computed: "" },
      B4: { value: "240", formula: "", computed: "" },
    };
    const result = withAccessories(cells, cases["accesorios de la norma"]!.element);
    expect(["B3", "B4", "B5", "B6", "B7"].map((ref) => result[ref]?.value)).toEqual(["F. Acc Sol", "240", "601", "602", "603"]);
  });

  it("sin familias, todo queda como antes", () => {
    const empty = { ...STRUCTURE, nodes: STRUCTURE.nodes.map((n) => ({ ...n, phantomFamilies: [] })) };
    expect(buildBomBaseSheet(empty, [sheet])).toEqual(buildBomBaseSheet(STRUCTURE, [sheet]));
  });
});

describe("evaluateBomBase", () => {
  it("calcula la base con los valores actuales de las hojas del diseño, no con lo guardado", async () => {
    const runtime = cases["sub_design 90 · plegado"]!.sheets[0]!;
    const base = buildBomBaseSheet(STRUCTURE, [asTemplateSheet(runtime)]);
    // La base guardada en el diseño, como la deja el cliente: fórmula y un
    // `computed` viejo
    const savedBase = {
      name: base.name,
      cells: Object.fromEntries(
        Object.entries(base.cells).map(([ref, cell]) => [
          ref,
          { value: cell.content, formula: cell.content, computed: cell.content.startsWith("=") ? "viejo" : cell.content, ...(cell.format?.bold ? { bold: true } : {}) },
        ]),
      ),
    };
    const edited = { ...runtime, cells: { ...runtime.cells, L50: { value: "7", formula: "7", computed: 7 } } };
    const result = await evaluateBomBase(savedBase, [edited]);
    const row = Object.entries(result).find(([ref, cell]) => ref.startsWith("B") && cell.value === "240")![0].slice(1);
    expect(result[`D${row}`]?.value).toBe("7");
    expect(result[`C${row}`]?.value).toBe("Fibra de 2 mm");
    expect(Object.values(result).some((cell) => cell.value === "viejo")).toBe(false);
    expect(Object.values(result).some((cell) => cell.bold)).toBe(true);
  });
});

describe("withAccessories", () => {
  const element = cases["accesorios de la norma"]!.element;
  const cells: Record<string, BomSummaryCell> = {
    A1: { value: "1", formula: "1", computed: "1" },
    B1: { value: "Semielaborado : SF 1", formula: "", computed: "" },
    B2: { value: "Item", formula: "", computed: "" },
    B3: { value: "240", formula: "", computed: "" },
    D3: { value: "3", formula: "", computed: "" },
    A5: { value: "4", formula: "4", computed: "4" },
    B5: { value: "Semielaborado : SF 4", formula: "", computed: "" },
    B6: { value: "Item", formula: "", computed: "" },
  };

  it("suma los accesorios al final de la sección de su semielaborado y desplaza lo de debajo", () => {
    const result = withAccessories(cells, element);
    // Tres accesorios de SF 1 tras el ítem 240: filas 4, 5 y 6
    expect(["B4", "B5", "B6"].map((ref) => result[ref]?.value)).toEqual(["601", "602", "603"]);
    expect(result.F4?.value).toBe("06010504");
    expect(result.I5?.value).toContain("sin cantidad en la norma");
    // La sección SF 4 baja tres filas
    expect(result.B8?.value).toBe("Semielaborado : SF 4");
    expect(result.B9?.value).toBe("Item");
    expect(cells.B5?.value).toBe("Semielaborado : SF 4");
  });

  it("sin accesorios, la lista queda igual", () => {
    expect(withAccessories(cells, NO_ACCESSORIES)).toEqual(cells);
  });
});

describe("validación", () => {
  it("dos hojas de lista de materiales es un error", () => {
    const designSheet = asTemplateSheet(cases["sub_design 90 · plegado"]!.sheets[0]!);
    const base = buildBomBaseSheet(STRUCTURE, [designSheet]);
    const document: TemplateDocument = {
      name: "Prueba",
      code: "P",
      type: "DESIGN",
      status: "DRAFT",
      version: 0,
      sheets: [designSheet, base, { ...base, name: "Otra lista", position: 2 }],
    } as TemplateDocument;
    const diagnostics = validateTemplate(document).filter((d) => d.code === "duplicate-bom-sheet");
    expect(diagnostics.map((d) => d.sheet).sort()).toEqual([BOM_BASE_SHEET_NAME, "Otra lista"]);
  });
});
