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
} from "./deprecated.js";
import { writeSheet, writeTemplate } from "./serialize.js";
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
  it("cada uno dice de qué canónico es copia y quién lo lee", () => {
    for (const field of DEPRECATED_FIELDS) {
      expect(field.canonical, field.field).not.toBe("");
      expect(field.readBy.length, field.field).toBeGreaterThan(0);
      expect(field.where, field.field).not.toBe("");
    }
  });

  it("hoy los mantiene vivos project-front", () => {
    expect(deprecatedFieldsReadBy("project-front").length).toBe(
      DEPRECATED_FIELDS.length,
    );
    expect(deprecatedFieldsReadBy("project-admin")).toEqual([]);
    expect(deprecatedFieldsReadBy("project-back")).toEqual([]);
  });

  it("todavía no se pueden retirar", () => {
    expect(canRetireDeprecatedFields()).toBe(false);
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
