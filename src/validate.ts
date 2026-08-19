/**
 * Validación de una plantilla.
 *
 * Corre igual en el editor y en el servidor, y esa es la razón de que viva
 * aquí: el navegador no puede ser la autoridad sobre lo que entra a la base.
 * Lo que hoy no hay es precisamente esto, y por eso conviven en producción
 * tres plantillas sin una sola hoja, ofreciéndose a los diseñadores como si
 * sirvieran.
 *
 * No evalúa nada. Todas las comprobaciones son estáticas, así que validar no
 * depende de que el motor cifrado esté arriba ni gasta una petición de red
 * por cada función de diseño que la plantilla invoque.
 */

import { analyzeSheet, columnLabelToIndex, parseCellRef } from "@rymel/formula-engine";
import { toEngineBook } from "./book.js";
import { isGraphicContent, parseGraphicDirective } from "./graphic.js";
import type { TemplateDiagnostic } from "./diagnostics.js";
import type {
  ItemCatalogTable,
  SemiFinishedZone,
  TemplateDocument,
  TemplateSheet,
} from "./types.js";

/**
 * Tamaño de la rejilla, el mismo que el diseñador de project-front.
 *
 * Es contrato, no preferencia: una plantilla escrita en el editor tiene que
 * caber en la pantalla del diseñador. La hoja `Tablas` de la plantilla real
 * llega a la fila 232 y `Resumen` a la columna `AH`, la 34.ª.
 */
export const GRID_ROWS = 250;
export const GRID_COLUMNS = 50;

export interface ValidateOptions {
  /**
   * Funciones de diseño asignadas al subtipo de la plantilla, con sus
   * variables en orden. Una celda que invoque un código que no esté aquí es
   * un error: existirá en el catálogo, pero no para este subtipo.
   */
  designFunctions?: readonly { code: string; variables: string[] }[];
  /**
   * Todos los códigos de función de diseño que existen en el catálogo, estén
   * asignados a este subtipo o no.
   *
   * Sirve para distinguir dos errores que se arreglan de forma distinta: una
   * función que no existe está mal escrita; una que existe pero no está
   * asignada a este subtipo se arregla asignándola.
   */
  catalogFunctionCodes?: readonly string[];
}

interface Position {
  row: number;
  column: number;
}

const positionOf = (ref: string): Position | null => {
  const parsed = parseCellRef(ref.trim());
  if (parsed === null) return null;
  return { row: parsed.row, column: parsed.col };
};

const withinGrid = (position: Position): boolean =>
  position.row >= 0 &&
  position.row < GRID_ROWS &&
  position.column >= 0 &&
  position.column < GRID_COLUMNS;

interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

const rectOf = (startCell: string, endCell: string): Rect | null => {
  const start = positionOf(startCell);
  const end = positionOf(endCell);
  if (start === null || end === null) return null;
  return {
    top: Math.min(start.row, end.row),
    left: Math.min(start.column, end.column),
    bottom: Math.max(start.row, end.row),
    right: Math.max(start.column, end.column),
  };
};

const overlaps = (a: Rect, b: Rect): boolean =>
  a.left <= b.right && b.left <= a.right && a.top <= b.bottom && b.top <= a.bottom;

/** Comprueba que una región esté bien formada y dentro de la hoja. */
const checkRegionBounds = (
  sheet: TemplateSheet,
  region: { id: string; startCell: string; endCell: string },
  label: string,
  diagnostics: TemplateDiagnostic[],
): Rect | null => {
  const rect = rectOf(region.startCell, region.endCell);

  if (rect === null) {
    diagnostics.push({
      sheet: sheet.name,
      regionId: region.id,
      code: "invalid-cell-ref",
      message: `${label} usa referencias mal formadas (${region.startCell}:${region.endCell})`,
    });
    return null;
  }

  if (
    !withinGrid({ row: rect.top, column: rect.left }) ||
    !withinGrid({ row: rect.bottom, column: rect.right })
  ) {
    diagnostics.push({
      sheet: sheet.name,
      regionId: region.id,
      code: "region-out-of-sheet",
      message: `${label} se sale de la hoja, que llega hasta la fila ${GRID_ROWS} y la columna ${GRID_COLUMNS}`,
    });
    return null;
  }

  return rect;
};

const checkNamedRanges = (
  sheet: TemplateSheet,
  diagnostics: TemplateDiagnostic[],
): void => {
  for (const range of sheet.styles.namedRanges) {
    checkRegionBounds(sheet, range, `El rango "${range.name}"`, diagnostics);

    if (range.name.trim() === "") {
      diagnostics.push({
        sheet: sheet.name,
        regionId: range.id,
        code: "empty-name",
        message: "Un rango con nombre no puede quedarse sin nombre",
      });
    }

    if (range.tags.some((tag) => tag.trim() === "")) {
      diagnostics.push({
        sheet: sheet.name,
        regionId: range.id,
        code: "empty-name",
        message: `El rango "${range.name}" tiene una etiqueta vacía`,
      });
    }
  }
};

const checkSemiFinishedZones = (
  sheet: TemplateSheet,
  diagnostics: TemplateDiagnostic[],
): void => {
  const placed: { zone: SemiFinishedZone; rect: Rect }[] = [];

  for (const zone of sheet.styles.semiFinishedZones) {
    const rect = checkRegionBounds(
      sheet,
      zone,
      `La zona de "${zone.semiFinishedName}"`,
      diagnostics,
    );
    if (rect === null) continue;

    // Una celda pertenece como mucho a un semielaborado: si dos zonas se
    // solapan, el BOM no puede decidir a cuál atribuir su consumo.
    const collision = placed.find((other) => overlaps(other.rect, rect));
    if (collision !== undefined) {
      diagnostics.push({
        sheet: sheet.name,
        regionId: zone.id,
        code: "overlapping-zones",
        message: `La zona de "${zone.semiFinishedName}" se solapa con la de "${collision.zone.semiFinishedName}"`,
      });
      continue;
    }

    placed.push({ zone, rect });
  }
};

const checkCatalogTables = (
  sheet: TemplateSheet,
  diagnostics: TemplateDiagnostic[],
): void => {
  for (const table of sheet.styles.itemCatalogTables) {
    const rect = checkRegionBounds(sheet, table, `La tabla "${table.name}"`, diagnostics);
    if (rect === null) continue;

    const width = rect.right - rect.left + 1;
    const offsets: [keyof ItemCatalogTable, number, string][] = [
      ["idColumnOffset", table.idColumnOffset, "identificador"],
      ["descriptionColumnOffset", table.descriptionColumnOffset, "descripción"],
      ["umColumnOffset", table.umColumnOffset, "unidad de medida"],
    ];

    for (const [, offset, label] of offsets) {
      if (!Number.isInteger(offset) || offset < 0 || offset >= width) {
        diagnostics.push({
          sheet: sheet.name,
          regionId: table.id,
          code: "invalid-catalog-offsets",
          message: `En la tabla "${table.name}", la columna de ${label} (${offset}) cae fuera del rango, que tiene ${width} columna(s)`,
        });
      }
    }

    const height = rect.bottom - rect.top + 1;
    if (!Number.isInteger(table.headerRows) || table.headerRows < 0) {
      diagnostics.push({
        sheet: sheet.name,
        regionId: table.id,
        code: "invalid-catalog-offsets",
        message: `La tabla "${table.name}" declara ${table.headerRows} filas de encabezado`,
      });
    } else if (table.headerRows >= height) {
      diagnostics.push({
        sheet: sheet.name,
        regionId: table.id,
        code: "invalid-catalog-offsets",
        message: `La tabla "${table.name}" se queda sin ítems: ${table.headerRows} fila(s) de encabezado sobre ${height} fila(s)`,
      });
    }
  }
};

const checkCells = (
  template: TemplateDocument,
  sheet: TemplateSheet,
  diagnostics: TemplateDiagnostic[],
): void => {
  const catalogTablesBySheet = new Map<string, Set<string>>();
  for (const other of template.sheets) {
    catalogTablesBySheet.set(
      other.name,
      new Set(other.styles.itemCatalogTables.map((table) => table.id)),
    );
  }

  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (positionOf(ref) === null) {
      diagnostics.push({
        sheet: sheet.name,
        cell: ref,
        code: "invalid-cell-ref",
        message: `"${ref}" no es una referencia de celda válida`,
      });
      continue;
    }

    if (isGraphicContent(cell.content)) {
      const parsed = parseGraphicDirective(cell.content);
      if (!parsed.ok) {
        for (const problem of parsed.problems) {
          diagnostics.push({
            sheet: sheet.name,
            cell: ref,
            code: "graphic-directive",
            message: problem.message,
          });
        }
      }
    }

    const conditionCells = [
      ...(cell.goTo?.conditionCells ?? []),
      ...(cell.catalogConditionCells ?? []),
    ];
    for (const condition of conditionCells) {
      if (positionOf(condition) === null) {
        diagnostics.push({
          sheet: sheet.name,
          cell: ref,
          code: "missing-condition-cell",
          message: `"${condition}" no es una referencia de celda válida`,
        });
      }
    }

    if (cell.itemLink !== undefined) {
      const tables = catalogTablesBySheet.get(cell.itemLink.catalogSheetName);
      if (tables === undefined) {
        diagnostics.push({
          sheet: sheet.name,
          cell: ref,
          code: "missing-catalog-table",
          message: `La celda apunta a la hoja "${cell.itemLink.catalogSheetName}", que no existe`,
        });
      } else if (!tables.has(cell.itemLink.catalogTableId)) {
        diagnostics.push({
          sheet: sheet.name,
          cell: ref,
          code: "missing-catalog-table",
          message: `La celda apunta a la tabla de catálogo "${cell.itemLink.catalogTableId}", que no existe en "${cell.itemLink.catalogSheetName}"`,
        });
      }
    }
  }
};

/**
 * Comprueba las fórmulas apoyándose en el análisis estático del motor.
 *
 * El motor deduce las hojas existentes de las claves del libro, así que una
 * hoja vacía le resultaría invisible y toda referencia hacia ella parecería un
 * error. Aquí sí se sabe qué hojas hay, de modo que ese diagnóstico se calcula
 * por separado y el del motor se descarta.
 */
const checkFormulas = (
  template: TemplateDocument,
  options: ValidateOptions,
  diagnostics: TemplateDiagnostic[],
): void => {
  const book = toEngineBook(template);
  const sheetNames = new Set(template.sheets.map((sheet) => sheet.name));
  const inCatalog = new Set(
    (options.catalogFunctionCodes ?? []).map((code) => code.toUpperCase()),
  );

  const engineDiagnostics = analyzeSheet(book, {
    customFunctions: (options.designFunctions ?? []).map((definition) => ({
      code: definition.code,
      variables: definition.variables,
    })),
  });

  for (const diagnostic of engineDiagnostics) {
    const separator = diagnostic.cell.lastIndexOf("!");
    const sheet = separator === -1 ? undefined : diagnostic.cell.slice(0, separator);
    const cell = separator === -1 ? diagnostic.cell : diagnostic.cell.slice(separator + 1);

    if (diagnostic.code === "unknown-sheet") continue;

    // Una función que el motor no conoce puede ser una función de diseño que
    // existe en el catálogo pero no está asignada a este subtipo. Distinguirlo
    // importa: una está mal escrita y la otra solo hay que asignarla.
    if (diagnostic.code === "unknown-function") {
      const name = (diagnostic.message.match(/"([^"]+)"/)?.[1] ?? "").toUpperCase();
      const existe = inCatalog.has(name);
      diagnostics.push({
        ...(sheet === undefined ? {} : { sheet }),
        cell,
        code: existe ? "function-not-assigned" : "unknown-function",
        message: existe
          ? `La función "${name}" existe, pero no está asignada a este subtipo de diseño`
          : diagnostic.message,
      });
      continue;
    }

    diagnostics.push({
      ...(sheet === undefined ? {} : { sheet }),
      cell,
      code: diagnostic.code,
      message: diagnostic.message,
    });
  }

  // Referencias a hojas inexistentes, con la lista real de hojas por delante.
  for (const sheet of template.sheets) {
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      if (!cell.content.startsWith("=") || isGraphicContent(cell.content)) continue;

      for (const match of cell.content.matchAll(/(?:'([^']+)'|([A-Za-z0-9_.]+))!/g)) {
        const referenced = match[1] ?? match[2] ?? "";
        if (sheetNames.has(referenced)) continue;
        diagnostics.push({
          sheet: sheet.name,
          cell: ref,
          code: "unknown-sheet",
          message: `La hoja "${referenced}" no existe en la plantilla`,
        });
      }
    }
  }
};

/**
 * Valida una plantilla completa y devuelve todo lo que está mal.
 *
 * Devuelve una lista vacía cuando no hay nada que objetar.
 */
export const validateTemplate = (
  template: TemplateDocument,
  options: ValidateOptions = {},
): TemplateDiagnostic[] => {
  const diagnostics: TemplateDiagnostic[] = [];

  // Los nombres de hoja son la clave con la que se resuelven las referencias
  // entre hojas: dos iguales hacen ambiguo a qué apunta `'Tablas'!J14`.
  const seen = new Set<string>();
  for (const sheet of template.sheets) {
    if (sheet.name.trim() === "") {
      diagnostics.push({
        sheet: sheet.name,
        code: "empty-name",
        message: "Una hoja no puede quedarse sin nombre",
      });
    }
    if (seen.has(sheet.name)) {
      diagnostics.push({
        sheet: sheet.name,
        code: "duplicate-sheet-name",
        message: `Hay más de una hoja llamada "${sheet.name}"`,
      });
    }
    seen.add(sheet.name);
  }

  for (const sheet of template.sheets) {
    checkNamedRanges(sheet, diagnostics);
    checkSemiFinishedZones(sheet, diagnostics);
    checkCatalogTables(sheet, diagnostics);
    checkCells(template, sheet, diagnostics);
  }

  checkFormulas(template, options, diagnostics);

  return diagnostics;
};

/** Índice de columna de una etiqueta (`A` → 0), reexportado por comodidad. */
export { columnLabelToIndex };
