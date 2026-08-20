/**
 * Lo que estas pruebas protegen es sobre todo lo que **no** se toca. Convertir
 * de más en una plantilla de 3000 celdas es peor que no convertir: rompe texto
 * que estaba bien y nadie lo mira dos veces.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  findDecimalCommaCells,
  isDecimalComma,
  normalizeDecimalComma,
  normalizeDecimalCommas,
} from "./decimals.js";
import { readTemplate } from "./serialize.js";
import { emptySheetStyles, TemplateStatus, TemplateType } from "./types.js";
import type { TemplateDocument } from "./types.js";
import type { PersistedTemplate } from "./persisted.js";

const document = (cells: Record<string, string>): TemplateDocument => ({
  name: "Plantilla",
  code: "P_0001",
  type: TemplateType.DESIGN,
  status: TemplateStatus.DRAFT,
  version: 0,
  sheets: [
    {
      name: "Resumen",
      position: 0,
      cells: Object.fromEntries(
        Object.entries(cells).map(([ref, content]) => [ref, { content }]),
      ),
      styles: emptySheetStyles(),
    },
  ],
});

describe("qué es un decimal con coma", () => {
  it.each(["3,36", "0,022", "16,708", "-2,5", "1,0", " 4,25 "])(
    "reconoce %s",
    (content) => {
      expect(isDecimalComma(content)).toBe(true);
    },
  );

  it.each([
    ["=SUMA(1,2)", "la coma separa argumentos de una fórmula"],
    ["=BUSCARV(A1;B1:C2;2;FALSO)", "una fórmula con separador regional"],
    ["Aislamiento (0,25 mm)", "texto que contiene un número con coma"],
    ["M0 0,75", "un código con coma dentro"],
    ["DRAW:FRONTAL:NUCLEO:H53,H54", "una directiva de gráfico"],
    ["Aluminio, Cobre", "una enumeración"],
    ["1.234,56", "notación de miles, que exige otra decisión"],
    ["115.2", "un decimal que ya usa punto"],
    ["3,", "una coma sin decimales"],
    [",5", "una coma sin parte entera"],
    ["", "el contenido vacío"],
  ])("no toca %s — %s", (content) => {
    expect(isDecimalComma(content)).toBe(false);
    expect(normalizeDecimalComma(content)).toBe(content);
  });
});

describe("conversión", () => {
  it("cambia la coma por punto", () => {
    expect(normalizeDecimalComma("3,36")).toBe("3.36");
    expect(normalizeDecimalComma("0,022")).toBe("0.022");
    expect(normalizeDecimalComma("-2,5")).toBe("-2.5");
  });

  it("el resultado ya es un número para el motor", () => {
    expect(Number(normalizeDecimalComma("16,708"))).toBe(16.708);
    // Y esto es lo que hacía el evaluador anterior con el original.
    expect(Number.parseFloat("16,708")).toBe(16);
  });

  it("deja el documento intacto si no hay ninguno", () => {
    const original = document({ A1: "115.2", A2: "=A1*2" });
    expect(normalizeDecimalCommas(original)).toBe(original);
  });

  it("convierte solo las celdas que lo son", () => {
    const normalized = normalizeDecimalCommas(
      document({
        A1: "3,36",
        A2: "Aislamiento (0,25 mm)",
        A3: "=SUMA(1,2)",
        A4: "115.2",
      }),
    );
    const cells = normalized.sheets[0]!.cells;

    expect(cells.A1!.content).toBe("3.36");
    expect(cells.A2!.content).toBe("Aislamiento (0,25 mm)");
    expect(cells.A3!.content).toBe("=SUMA(1,2)");
    expect(cells.A4!.content).toBe("115.2");
  });

  it("conserva el formato y los enlaces de la celda", () => {
    const original = document({ A1: "3,36" });
    original.sheets[0]!.cells.A1 = {
      content: "3,36",
      format: { bold: true },
      note: "una nota",
    };

    const cell = normalizeDecimalCommas(original).sheets[0]!.cells.A1!;

    expect(cell.content).toBe("3.36");
    expect(cell.format).toEqual({ bold: true });
    expect(cell.note).toBe("una nota");
  });
});

describe("qué cambiaría, antes de cambiarlo", () => {
  it("señala como ambiguo el caso de tres decimales", () => {
    const found = findDecimalCommaCells(
      document({ A1: "16,708", A2: "3,36", A3: "1,000" }),
    );

    expect(found.find((cell) => cell.ref === "A1")?.ambiguous).toBe(true);
    expect(found.find((cell) => cell.ref === "A3")?.ambiguous).toBe(true);
    expect(found.find((cell) => cell.ref === "A2")?.ambiguous).toBe(false);
  });

  it("dice de dónde a dónde", () => {
    const [found] = findDecimalCommaCells(document({ B7: "0,022" }));

    expect(found).toMatchObject({
      sheet: "Resumen",
      ref: "B7",
      before: "0,022",
      after: "0.022",
    });
  });
});

describe("la plantilla real", () => {
  const plantillaReal = (): PersistedTemplate =>
    (
      JSON.parse(
        readFileSync(
          new URL("../test/fixtures/legacy-templates.json", import.meta.url),
          "utf8",
        ),
      ) as PersistedTemplate[]
    ).find((row) => row.code === "TEMPLATE_1F_0001")!;

  it("encuentra las 1200 celdas medidas, ni una más", () => {
    const found = findDecimalCommaCells(readTemplate(plantillaReal()));

    expect(found).toHaveLength(1200);
    // 404 llevan tres decimales: son las que conviene mirar antes de aceptar.
    expect(found.filter((cell) => cell.ambiguous)).toHaveLength(404);
  });

  it("no toca ninguna de las 21 celdas de texto con coma", () => {
    const template = readTemplate(plantillaReal());
    const normalized = normalizeDecimalCommas(template);

    for (const [index, sheet] of template.sheets.entries()) {
      for (const [ref, cell] of Object.entries(sheet.cells)) {
        if (isDecimalComma(cell.content)) continue;
        expect(
          normalized.sheets[index]!.cells[ref]!.content,
          `${sheet.name}!${ref}`,
        ).toBe(cell.content);
      }
    }
  });

  it("después no queda ninguno", () => {
    const normalized = normalizeDecimalCommas(readTemplate(plantillaReal()));

    expect(findDecimalCommaCells(normalized)).toHaveLength(0);
  });
});
