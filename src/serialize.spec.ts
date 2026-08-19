/**
 * Ida y vuelta contra las plantillas reales.
 *
 * El fixture es el volcado literal de la tabla `template` de la base
 * `project`, sin tocar: cuatro plantillas, de las cuales solo
 * `TEMPLATE_1F_0001` tiene hojas. Es la única prueba que puede decir si el
 * contrato entiende de verdad lo que hay guardado, en vez de lo que los tipos
 * de project-front dicen que debería haber.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { readTemplate, writeTemplate, readSheet, writeSheet } from "./serialize.js";
import { CONTRACT_VERSION } from "./version.js";
import { TemplateStatus, TemplateType, emptySheetStyles } from "./types.js";
import type { PersistedSheet, PersistedTemplate } from "./persisted.js";

interface LegacyRow extends PersistedTemplate {
  design_sub_type_id?: number;
  sheets?: (PersistedSheet & { order?: number })[];
}

const legado = (): LegacyRow[] =>
  JSON.parse(
    readFileSync(new URL("../test/fixtures/legacy-templates.json", import.meta.url), "utf8"),
  );

const plantillaReal = (): LegacyRow =>
  legado().find((row) => row.code === "TEMPLATE_1F_0001")!;

describe("lectura de las plantillas reales", () => {
  it("lee las cuatro plantillas guardadas", () => {
    const filas = legado();

    expect(filas).toHaveLength(4);
    expect(filas.map((row) => row.code).sort()).toEqual([
      "COST_TEMPLATE_1F_0001",
      "TEMPLATE_1F_0001",
      "TEMPLATE_3F_0001",
      "TEMPLATE_3F_0002",
    ]);
  });

  it("las tres plantillas sin hojas se leen como plantillas sin hojas", () => {
    // No es una obviedad: son las que hoy se ofrecen en la biblioteca de
    // project-front y cargan en blanco.
    const vacias = legado()
      .filter((row) => row.code !== "TEMPLATE_1F_0001")
      .map((row) => readTemplate(row));

    for (const plantilla of vacias) {
      expect(plantilla.sheets).toEqual([]);
    }
  });

  it("da a las dos hojas posiciones distintas, aunque ambas valgan 0 en la base", () => {
    const guardadas = plantillaReal().sheets ?? [];
    expect(guardadas.map((sheet) => sheet.order)).toEqual([0, 0]);

    const plantilla = readTemplate(plantillaReal());

    expect(plantilla.sheets.map((sheet) => sheet.position)).toEqual([0, 1]);
    expect(plantilla.sheets.map((sheet) => sheet.name)).toEqual(["Resumen", "Tablas"]);
  });

  it("descarta las celdas sin contenido y conserva las que solo llevan formato", () => {
    const plantilla = readTemplate(plantillaReal());
    const [resumen, tablas] = plantilla.sheets;
    const guardadas = plantillaReal().sheets ?? [];

    // Medido sobre el volcado: 3013 celdas guardadas, 975 sin nada dentro.
    expect(Object.keys(guardadas[0]!.cells)).toHaveLength(1111);
    expect(Object.keys(guardadas[1]!.cells)).toHaveLength(1902);

    expect(Object.keys(resumen!.cells)).toHaveLength(1111 - 671);
    expect(Object.keys(tablas!.cells)).toHaveLength(1902 - 304);

    // `A1` de `Resumen` no tiene contenido pero está en negrita: se queda.
    expect(resumen!.cells.A1).toEqual({ content: "", format: { bold: true } });
  });

  it("toma `formula` como contenido y no arrastra el valor calculado", () => {
    const plantilla = readTemplate(plantillaReal());
    const resumen = plantilla.sheets[0]!;

    expect(resumen.cells.G17!.content).toBe(
      "=G14*(VLOOKUP(G13;Tablas!B3:Tablas!C10;2;TRUE))",
    );
    expect(Object.keys(resumen.cells.G17!)).not.toContain("computed");
  });

  it("le quita el `=` a la celda de gráfico", () => {
    const plantilla = readTemplate(plantillaReal());
    const k73 = plantilla.sheets[0]!.cells.K73!;

    expect(k73.content.startsWith("DRAW:BOBINADO:")).toBe(true);
    expect(k73.content.startsWith("=")).toBe(false);
  });

  it("conserva las regiones y el formato de hoja", () => {
    const plantilla = readTemplate(plantillaReal());
    const [resumen, tablas] = plantilla.sheets;

    expect(resumen!.styles.freezeRow).toBe(7);
    expect(resumen!.styles.mergedCells).toHaveLength(141);
    expect(tablas!.styles.mergedCells).toHaveLength(10);
    expect(tablas!.styles.namedRanges).toEqual([
      {
        id: "nr-1775530248839",
        name: "Tabla aluminio",
        tags: ["aluminio"],
        startCell: "J14",
        endCell: "J14",
      },
    ]);
  });

  it("descarta lo que oculta el diseñador, que no es de la plantilla", () => {
    const conEstadoDeUsuario: PersistedSheet = {
      name: "Hoja1",
      cells: {},
      cellsStyles: {
        userHiddenRows: [3, 4],
        userHiddenColumns: [1],
        hiddenCells: ["A1"],
      },
    };

    const hoja = readSheet(conEstadoDeUsuario, 0);

    expect(hoja.styles.hiddenRows).toEqual([]);
    expect(hoja.styles.hiddenColumns).toEqual([]);
    expect(Object.keys(hoja.styles)).not.toContain("hiddenCells");
  });
});

describe("filas y columnas ocultas", () => {
  const conOcultas = (styles: Record<string, unknown>): PersistedSheet => ({
    name: "Hoja1",
    cells: {},
    cellsStyles: styles,
  });

  it("lee el nombre antiguo, que es el que hay escrito hoy", () => {
    const hoja = readSheet(
      conOcultas({ templateHiddenRows: [5, 6], templateHiddenColumns: [2] }),
      0,
    );

    expect(hoja.styles.hiddenRows).toEqual([5, 6]);
    expect(hoja.styles.hiddenColumns).toEqual([2]);
  });

  it("lee el nombre canónico", () => {
    const hoja = readSheet(conOcultas({ hiddenRows: [1], hiddenColumns: [9] }), 0);

    expect(hoja.styles.hiddenRows).toEqual([1]);
    expect(hoja.styles.hiddenColumns).toEqual([9]);
  });

  it("prefiere el canónico cuando los dos vienen y no coinciden", () => {
    const hoja = readSheet(
      conOcultas({ hiddenRows: [1, 2], templateHiddenRows: [7] }),
      0,
    );

    expect(hoja.styles.hiddenRows).toEqual([1, 2]);
  });

  it("escribe los dos nombres, para que project-front siga leyéndolas", () => {
    const hoja = writeSheet({
      name: "Hoja1",
      position: 0,
      cells: {},
      styles: { ...emptySheetStyles(), hiddenRows: [4], hiddenColumns: [8] },
    });

    expect(hoja.cellsStyles!.hiddenRows).toEqual([4]);
    expect(hoja.cellsStyles!.templateHiddenRows).toEqual([4]);
    expect(hoja.cellsStyles!.hiddenColumns).toEqual([8]);
    expect(hoja.cellsStyles!.templateHiddenColumns).toEqual([8]);
  });

  it("sobrevive a una ida y vuelta completa", () => {
    const original = readSheet(
      conOcultas({ templateHiddenRows: [10, 11], templateHiddenColumns: [3] }),
      0,
    );

    const devuelta = readSheet(writeSheet(original), 0);

    expect(devuelta.styles.hiddenRows).toEqual([10, 11]);
    expect(devuelta.styles.hiddenColumns).toEqual([3]);
  });
});

describe("ida y vuelta de la plantilla real", () => {
  it("leer, escribir y volver a leer da el mismo documento", () => {
    const original = readTemplate(plantillaReal());
    const devuelta = readTemplate({
      ...writeTemplate(original),
      sheets: writeTemplate(original).sheets,
    });

    expect(devuelta.sheets).toEqual(original.sheets);
  });

  it("la segunda escritura ya no descarta nada: la normalización es estable", () => {
    const original = readTemplate(plantillaReal());
    const primera = writeTemplate(original);
    const segunda = writeTemplate(readTemplate(primera));

    for (const [index, sheet] of segunda.sheets!.entries()) {
      expect(Object.keys(sheet.cells)).toHaveLength(
        Object.keys(primera.sheets![index]!.cells).length,
      );
    }
  });

  it("sella la versión del contrato al escribir", () => {
    const escrita = writeTemplate(readTemplate(plantillaReal()));

    expect(escrita.contractVersion).toBe(CONTRACT_VERSION);
  });

  it("espeja el contenido en `value`, que project-front todavía lee", () => {
    const escrita = writeTemplate(readTemplate(plantillaReal()));
    const k73 = escrita.sheets![0]!.cells.K73!;

    expect(k73.value).toBe(k73.formula);
    expect(k73.formula!.startsWith("DRAW:BOBINADO:")).toBe(true);
  });

  it("no vuelve a escribir ningún valor calculado", () => {
    const escrita = writeTemplate(readTemplate(plantillaReal()));

    for (const sheet of escrita.sheets ?? []) {
      for (const cell of Object.values(sheet.cells)) {
        expect(cell.computed).toBeUndefined();
      }
    }
  });

  it("una plantilla nueva nace en borrador", () => {
    const plantilla = readTemplate({ name: "Nueva", code: "NUEVA_0001" });

    expect(plantilla.status).toBe(TemplateStatus.DRAFT);
    expect(plantilla.type).toBe(TemplateType.DESIGN);
    expect(plantilla.version).toBe(0);
  });
});
