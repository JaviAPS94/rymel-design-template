/**
 * Lo que hace verificable la retirada de los campos espejo.
 *
 * Sin estas pruebas, «los espejos se quitan cuando project-front adopte el
 * contrato» es una promesa en un documento. Con ellas, la declaración y el
 * serializador tienen que coincidir: quitar una entrada de la lista obliga a
 * quitar la escritura, y escribir un campo sin declararlo falla.
 */

import { describe, expect, it } from "vitest";
import {
  canRetireDeprecatedFields,
  DEPRECATED_FIELDS,
  deprecatedFieldsReadBy,
  RETIRED_FIELDS,
} from "./deprecated.js";
import { readSheet, writeSheet, writeTemplate } from "./serialize.js";
import { emptySheetStyles, TemplateStatus, TemplateType } from "./types.js";
import type { TemplateDocument } from "./types.js";

const sheet = () => ({
  name: "Resumen",
  position: 0,
  cells: {
    A1: { content: "=SUMA(B1:B2)" },
    B5: {
      content: "",
      itemLink: {
        catalogSheetName: "Tablas",
        catalogTableId: "ct-1",
        itemId: "AC-1",
      },
    },
  },
  styles: { ...emptySheetStyles(), hiddenRows: [4], hiddenColumns: [2] },
});

const document = (): TemplateDocument => ({
  name: "Plantilla",
  code: "P_0001",
  type: TemplateType.DESIGN,
  status: TemplateStatus.DRAFT,
  version: 0,
  sheets: [sheet()],
});

describe("declaración de los campos espejo", () => {
  it("no queda ninguno vivo", () => {
    expect(DEPRECATED_FIELDS).toEqual([]);
    expect(canRetireDeprecatedFields()).toBe(true);
    expect(deprecatedFieldsReadBy("project-front")).toEqual([]);
  });

  it("cada uno que se añada tendrá que decir de qué es copia y quién lo lee", () => {
    // La lista está vacía; esto protege el día que alguien la vuelva a llenar.
    for (const field of DEPRECATED_FIELDS) {
      expect(field.canonical, field.field).not.toBe("");
      expect(field.readBy.length, field.field).toBeGreaterThan(0);
      expect(field.where, field.field).not.toBe("");
    }
  });

  it("los cuatro retirados constan, con la versión en que se fueron", () => {
    expect(RETIRED_FIELDS.map((field) => field.field).sort()).toEqual([
      "catalogSheetId",
      "templateHiddenColumns",
      "templateHiddenRows",
      "value",
    ]);
    for (const field of RETIRED_FIELDS) {
      expect(field.retiredIn, field.field).toBe("2.0.0");
    }
  });
});

describe("el serializador escribe lo declarado y solo lo declarado", () => {
  const declared = new Set(DEPRECATED_FIELDS.map((field) => field.field));

  it("escribe los campos de ocultamiento en espejo si están declarados", () => {
    const persisted = writeSheet(sheet());
    const styles = persisted.cellsStyles!;

    for (const field of ["templateHiddenRows", "templateHiddenColumns"]) {
      const written = (styles as Record<string, unknown>)[field] !== undefined;
      expect(written, `${field}: escrito=${written}, declarado=${declared.has(field)}`).toBe(
        declared.has(field),
      );
    }
  });

  it("espeja el contenido en `value` si está declarado", () => {
    const cell = writeSheet(sheet()).cells.A1!;

    expect(cell.value !== undefined).toBe(declared.has("value"));
    if (declared.has("value")) expect(cell.value).toBe(cell.formula);
  });

  it("espeja el identificador de hoja del catálogo si está declarado", () => {
    const cell = writeSheet(sheet()).cells.B5!;

    expect(cell.itemLink?.catalogSheetId !== undefined).toBe(
      declared.has("catalogSheetId"),
    );
  });

  it("los retirados se siguen entendiendo al leer", () => {
    // Dejar de escribir algo no es dejar de entenderlo: hay plantillas
    // guardadas que todavía los traen, y una copia antigua tiene que poder
    // restaurarse.
    const leida = readSheet(
      {
        name: "Antigua",
        cells: {
          A1: { value: "=SUMA(B1:B2)" },
          B5: {
            value: "",
            border: "1px solid #000",
            itemLink: {
              catalogSheetId: "Tablas",
              catalogTableId: "ct-1",
              itemId: "AC-1",
            },
          },
        },
        cellsStyles: { templateHiddenRows: [4], templateHiddenColumns: [2] },
      },
      0,
    );

    expect(leida.cells.A1!.content).toBe("=SUMA(B1:B2)");
    expect(leida.styles.hiddenRows).toEqual([4]);
    expect(leida.styles.hiddenColumns).toEqual([2]);
    expect(leida.cells.B5!.itemLink?.catalogSheetName).toBe("Tablas");
  });

  it("los campos canónicos se escriben siempre, se retire lo que se retire", () => {
    const persisted = writeTemplate(document());
    const styles = persisted.sheets![0]!.cellsStyles!;

    expect(styles.hiddenRows).toEqual([4]);
    expect(styles.hiddenColumns).toEqual([2]);
    expect(persisted.sheets![0]!.cells.A1!.formula).toBe("=SUMA(B1:B2)");
    expect(
      persisted.sheets![0]!.cells.B5!.itemLink?.catalogSheetName,
    ).toBe("Tablas");
  });

  it("el estado de sesión del diseñador no se escribe nunca", () => {
    // No es un campo espejo: no es de la plantilla y no vuelve, se retire lo
    // que se retire.
    const styles = writeSheet(sheet()).cellsStyles as Record<string, unknown>;

    for (const field of ["userHiddenRows", "userHiddenColumns", "hiddenCells"]) {
      expect(styles[field], field).toBeUndefined();
    }
  });
});
