import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { validateTemplate } from "./validate.js";
import { readTemplate } from "./serialize.js";
import { emptySheetStyles, TemplateStatus, TemplateType } from "./types.js";
import type { TemplateDocument, TemplateSheet } from "./types.js";
import type { PersistedTemplate } from "./persisted.js";

const hoja = (name: string, overrides: Partial<TemplateSheet> = {}): TemplateSheet => ({
  name,
  position: 0,
  cells: {},
  styles: emptySheetStyles(),
  ...overrides,
});

const plantilla = (sheets: TemplateSheet[]): TemplateDocument => ({
  name: "Plantilla",
  code: "PLANTILLA_0001",
  type: TemplateType.DESIGN,
  status: TemplateStatus.DRAFT,
  version: 0,
  sheets: sheets.map((sheet, index) => ({ ...sheet, position: index })),
});

const codigos = (template: TemplateDocument, options = {}) =>
  validateTemplate(template, options).map((diagnostic) => diagnostic.code);

describe("estructura del documento", () => {
  it("no objeta nada a una plantilla correcta", () => {
    expect(
      validateTemplate(
        plantilla([hoja("Resumen", { cells: { A1: { content: "=1+1" } } })]),
      ),
    ).toEqual([]);
  });

  it("rechaza dos hojas con el mismo nombre", () => {
    // Las referencias entre hojas se resuelven por nombre: con dos iguales,
    // `'Tablas'!J14` no designa nada en concreto.
    const diagnosticos = validateTemplate(plantilla([hoja("Tablas"), hoja("Tablas")]));

    expect(diagnosticos).toHaveLength(1);
    expect(diagnosticos[0]!.code).toBe("duplicate-sheet-name");
    expect(diagnosticos[0]!.message).toContain("Tablas");
  });

  it("rechaza una hoja sin nombre", () => {
    expect(codigos(plantilla([hoja("  ")]))).toContain("empty-name");
  });

  it("rechaza una referencia de celda mal formada", () => {
    const diagnosticos = validateTemplate(
      plantilla([hoja("Resumen", { cells: { "A-1": { content: "5" } } })]),
    );

    expect(diagnosticos[0]).toMatchObject({
      sheet: "Resumen",
      cell: "A-1",
      code: "invalid-cell-ref",
    });
  });
});

describe("regiones", () => {
  it("rechaza una región que se sale de la hoja", () => {
    const diagnosticos = validateTemplate(
      plantilla([
        hoja("Tablas", {
          styles: {
            ...emptySheetStyles(),
            namedRanges: [
              {
                id: "nr-1",
                name: "Fuera",
                tags: [],
                startCell: "A1",
                endCell: "A400",
              },
            ],
          },
        }),
      ]),
    );

    expect(diagnosticos[0]).toMatchObject({
      regionId: "nr-1",
      code: "region-out-of-sheet",
    });
  });

  it("rechaza un rango con nombre sin nombre", () => {
    expect(
      codigos(
        plantilla([
          hoja("Tablas", {
            styles: {
              ...emptySheetStyles(),
              namedRanges: [
                { id: "nr-1", name: " ", tags: ["a"], startCell: "A1", endCell: "B2" },
              ],
            },
          }),
        ]),
      ),
    ).toContain("empty-name");
  });

  it("rechaza dos zonas de semielaborado solapadas", () => {
    const zona = (id: string, code: string, startCell: string, endCell: string) => ({
      id,
      semiFinishedId: 1,
      semiFinishedCode: code,
      semiFinishedName: code,
      startCell,
      endCell,
    });

    const diagnosticos = validateTemplate(
      plantilla([
        hoja("Resumen", {
          styles: {
            ...emptySheetStyles(),
            semiFinishedZones: [
              zona("z1", "BOBINA", "A1", "C5"),
              zona("z2", "NUCLEO", "B4", "D8"),
            ],
          },
        }),
      ]),
    );

    expect(diagnosticos[0]).toMatchObject({ regionId: "z2", code: "overlapping-zones" });
    expect(diagnosticos[0]!.message).toContain("BOBINA");
  });

  it("acepta dos zonas que se tocan sin solaparse", () => {
    const zona = (id: string, startCell: string, endCell: string) => ({
      id,
      semiFinishedId: 1,
      semiFinishedCode: "BOBINA",
      semiFinishedName: "BOBINA",
      startCell,
      endCell,
    });

    expect(
      validateTemplate(
        plantilla([
          hoja("Resumen", {
            styles: {
              ...emptySheetStyles(),
              semiFinishedZones: [zona("z1", "A1", "C5"), zona("z2", "D1", "F5")],
            },
          }),
        ]),
      ),
    ).toEqual([]);
  });

  it("rechaza un desplazamiento de columna fuera de la tabla", () => {
    const diagnosticos = validateTemplate(
      plantilla([
        hoja("Tablas", {
          styles: {
            ...emptySheetStyles(),
            itemCatalogTables: [
              {
                id: "t1",
                name: "Aceros",
                startCell: "A1",
                endCell: "C10",
                headerRows: 1,
                idColumnOffset: 0,
                descriptionColumnOffset: 5,
                umColumnOffset: 2,
              },
            ],
          },
        }),
      ]),
    );

    expect(diagnosticos[0]).toMatchObject({
      regionId: "t1",
      code: "invalid-catalog-offsets",
    });
    expect(diagnosticos[0]!.message).toContain("descripción");
  });

  it("rechaza una tabla cuyos encabezados no dejan sitio a los ítems", () => {
    expect(
      codigos(
        plantilla([
          hoja("Tablas", {
            styles: {
              ...emptySheetStyles(),
              itemCatalogTables: [
                {
                  id: "t1",
                  name: "Aceros",
                  startCell: "A1",
                  endCell: "C3",
                  headerRows: 3,
                  idColumnOffset: 0,
                  descriptionColumnOffset: 1,
                  umColumnOffset: 2,
                },
              ],
            },
          }),
        ]),
      ),
    ).toContain("invalid-catalog-offsets");
  });
});

describe("enlaces de celda", () => {
  const conCatalogo = (): TemplateSheet =>
    hoja("Tablas", {
      styles: {
        ...emptySheetStyles(),
        itemCatalogTables: [
          {
            id: "t1",
            name: "Aceros",
            startCell: "A1",
            endCell: "C10",
            headerRows: 1,
            idColumnOffset: 0,
            descriptionColumnOffset: 1,
            umColumnOffset: 2,
          },
        ],
      },
    });

  it("acepta un enlace a una tabla que existe", () => {
    expect(
      validateTemplate(
        plantilla([
          hoja("Resumen", {
            cells: {
              B2: {
                content: "",
                itemLink: {
                  catalogSheetName: "Tablas",
                  catalogTableId: "t1",
                  itemId: "AC-1",
                },
              },
            },
          }),
          conCatalogo(),
        ]),
      ),
    ).toEqual([]);
  });

  it("rechaza un enlace a una tabla que no existe", () => {
    const diagnosticos = validateTemplate(
      plantilla([
        hoja("Resumen", {
          cells: {
            B2: {
              content: "",
              itemLink: {
                catalogSheetName: "Tablas",
                catalogTableId: "t9",
                itemId: "AC-1",
              },
            },
          },
        }),
        conCatalogo(),
      ]),
    );

    expect(diagnosticos[0]).toMatchObject({
      sheet: "Resumen",
      cell: "B2",
      code: "missing-catalog-table",
    });
  });

  it("rechaza un enlace a una hoja que no existe", () => {
    const diagnosticos = validateTemplate(
      plantilla([
        hoja("Resumen", {
          cells: {
            B2: {
              content: "",
              itemLink: {
                catalogSheetName: "Catálogos",
                catalogTableId: "t1",
                itemId: "AC-1",
              },
            },
          },
        }),
      ]),
    );

    expect(diagnosticos[0]!.code).toBe("missing-catalog-table");
    expect(diagnosticos[0]!.message).toContain("Catálogos");
  });

  it("rechaza una celda de condición mal formada", () => {
    expect(
      codigos(
        plantilla([
          hoja("Resumen", {
            cells: { Q10: { content: "", goTo: { conditionCells: ["I23", "nope"] } } },
          }),
        ]),
      ),
    ).toEqual(["missing-condition-cell"]);
  });
});

describe("fórmulas", () => {
  it("rechaza una fórmula mal escrita", () => {
    expect(
      codigos(plantilla([hoja("Resumen", { cells: { A1: { content: "=SUMA(" } } })])),
    ).toEqual(["syntax"]);
  });

  it("rechaza una referencia a una hoja que no existe", () => {
    const diagnosticos = validateTemplate(
      plantilla([hoja("Resumen", { cells: { A1: { content: "=Tablas2!A1" } } })]),
    );

    expect(diagnosticos[0]).toMatchObject({
      sheet: "Resumen",
      cell: "A1",
      code: "unknown-sheet",
    });
  });

  it("acepta una referencia a una hoja vacía de la propia plantilla", () => {
    // El motor deduce las hojas de las claves del libro, así que una hoja sin
    // celdas le resulta invisible. El contrato sí sabe que existe.
    expect(
      validateTemplate(
        plantilla([
          hoja("Resumen", { cells: { A1: { content: "=Tablas!A1" } } }),
          hoja("Tablas"),
        ]),
      ),
    ).toEqual([]);
  });

  it("rechaza una función que no existe en ninguna parte", () => {
    const diagnosticos = validateTemplate(
      plantilla([hoja("Resumen", { cells: { A1: { content: "=INVENTADA(1)" } } })]),
    );

    expect(diagnosticos[0]!.code).toBe("unknown-function");
  });

  it("distingue una función que existe pero no está asignada al subtipo", () => {
    const diagnosticos = validateTemplate(
      plantilla([hoja("Resumen", { cells: { A1: { content: "=CUBIC(2)" } } })]),
      {
        designFunctions: [{ code: "QUADRATIC", variables: ["x"] }],
        catalogFunctionCodes: ["QUADRATIC", "CUBIC"],
      },
    );

    expect(diagnosticos[0]!.code).toBe("function-not-assigned");
    expect(diagnosticos[0]!.message).toContain("no está asignada");
  });

  it("acepta una función de diseño asignada al subtipo", () => {
    expect(
      validateTemplate(
        plantilla([hoja("Resumen", { cells: { A1: { content: "=QUADRATIC(2)" } } })]),
        { designFunctions: [{ code: "QUADRATIC", variables: ["x"] }] },
      ),
    ).toEqual([]);
  });

  it("rechaza una función de diseño con los argumentos cambiados", () => {
    expect(
      codigos(
        plantilla([hoja("Resumen", { cells: { A1: { content: "=CUBIC(2)" } } })]),
        { designFunctions: [{ code: "CUBIC", variables: ["x", "b"] }] },
      ),
    ).toEqual(["argument-count"]);
  });

  it("señala un ciclo que cruza dos hojas", () => {
    const diagnosticos = validateTemplate(
      plantilla([
        hoja("Resumen", { cells: { A1: { content: "=Tablas!B1+1" } } }),
        hoja("Tablas", { cells: { B1: { content: "=Resumen!A1+1" } } }),
      ]),
    );

    expect(diagnosticos.map((d) => d.code)).toEqual(["circular", "circular"]);
  });

  it("no analiza la celda de gráfico como fórmula", () => {
    expect(
      validateTemplate(
        plantilla([
          hoja("Resumen", {
            cells: { K73: { content: "DRAW:FRONTAL:NUCLEO:H53,H54" } },
          }),
        ]),
      ),
    ).toEqual([]);
  });

  it("sí señala una directiva de gráfico mal escrita", () => {
    expect(
      codigos(
        plantilla([
          hoja("Resumen", { cells: { K73: { content: "DRAW:LATERAL:NUCLEO:H53" } } }),
        ]),
      ),
    ).toEqual(["graphic-directive"]);
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

  it("no produce ni un falso positivo", () => {
    // Sus fórmulas usan `;`, rangos calificados en los dos extremos y una
    // celda de gráfico. Si el validador las marcara, el editor rechazaría la
    // única plantilla completa que existe.
    expect(validateTemplate(readTemplate(plantillaReal()))).toEqual([]);
  });
});
