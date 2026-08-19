/**
 * Traducción entre lo que está guardado y el modelo canónico.
 *
 * Es el único sitio del sistema donde esa traducción ocurre, y esa es toda la
 * idea: mientras cada consumidor la hacía por su cuenta, un lado escribía
 * `templateHiddenRows` y el otro leía `hiddenRows`, así que las filas que un
 * autor ocultaba en la plantilla reaparecían en la pantalla del diseñador.
 *
 * Al escribir se normaliza además: se descartan las celdas que no tienen nada
 * dentro —975 de las 3013 de la plantilla real, un 32 %— y no se persiste
 * ningún valor calculado.
 */

import { CONTRACT_VERSION } from "./version.js";
import { isGraphicContent, normalizeGraphicContent } from "./graphic.js";
import {
  emptySheetStyles,
  TemplateStatus,
  TemplateType,
  type CellFormat,
  type SheetStyles,
  type TemplateCell,
  type TemplateDocument,
  type TemplateSheet,
} from "./types.js";
import type {
  PersistedCell,
  PersistedSheet,
  PersistedSheetStyles,
  PersistedTemplate,
} from "./persisted.js";

const numericRecord = (
  source: Record<string | number, number> | undefined,
): Record<number, number> => {
  const result: Record<number, number> = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    const index = Number(key);
    if (Number.isInteger(index) && typeof value === "number") result[index] = value;
  }
  return result;
};

const uniqueSorted = (values: readonly number[] | undefined): number[] =>
  [...new Set((values ?? []).filter((value) => Number.isInteger(value)))].sort(
    (a, b) => a - b,
  );

/**
 * Filas o columnas ocultas de la plantilla.
 *
 * Se admiten los dos nombres. Cuando vienen los dos y no coinciden gana el
 * canónico: es el que este contrato escribe, así que es el que refleja la
 * última intención del autor.
 */
const hiddenOf = (
  canonical: readonly number[] | undefined,
  legacy: readonly number[] | undefined,
): number[] => {
  const fromCanonical = uniqueSorted(canonical);
  if (fromCanonical.length > 0) return fromCanonical;
  return uniqueSorted(legacy);
};

const formatOf = (cell: PersistedCell): CellFormat | undefined => {
  const format: CellFormat = {};
  if (cell.bold !== undefined) format.bold = cell.bold;
  if (cell.textColor !== undefined) format.textColor = cell.textColor;
  if (cell.backgroundColor !== undefined) format.backgroundColor = cell.backgroundColor;
  if (cell.border !== undefined) format.border = cell.border;
  if (cell.borderTop !== undefined) format.borderTop = cell.borderTop;
  if (cell.borderRight !== undefined) format.borderRight = cell.borderRight;
  if (cell.borderBottom !== undefined) format.borderBottom = cell.borderBottom;
  if (cell.borderLeft !== undefined) format.borderLeft = cell.borderLeft;
  if (cell.decimals !== undefined) format.decimals = cell.decimals;
  if (cell.conditionalFormat !== undefined) {
    format.conditionalFormat = { ...cell.conditionalFormat };
  }
  return Object.keys(format).length > 0 ? format : undefined;
};

/**
 * El contenido de la celda.
 *
 * `formula` manda sobre `value`. En las 2963 celdas reales que traen ambos
 * son idénticos, así que la regla no cambia ningún dato existente; existe
 * para que un documento antiguo con los dos campos desalineados se resuelva
 * de una forma y no de dos.
 */
const contentOf = (cell: PersistedCell): string => {
  const raw = cell.formula ?? cell.value ?? "";
  const text = String(raw);
  return isGraphicContent(text) ? normalizeGraphicContent(text) : text;
};

const readCell = (cell: PersistedCell): TemplateCell | undefined => {
  const content = contentOf(cell);
  const format = formatOf(cell);

  const parsed: TemplateCell = { content };
  if (format !== undefined) parsed.format = format;
  if (cell.note !== undefined) parsed.note = cell.note;
  if (cell.options !== undefined) parsed.options = [...cell.options];
  if (cell.elementKey !== undefined) parsed.elementKey = cell.elementKey;
  if (cell.goTo !== undefined) {
    parsed.goTo = { conditionCells: [...cell.goTo.conditionCells] };
  }
  if (cell.itemLink !== undefined) {
    parsed.itemLink = {
      catalogSheetName:
        cell.itemLink.catalogSheetName ?? cell.itemLink.catalogSheetId ?? "",
      catalogTableId: cell.itemLink.catalogTableId,
      itemId: cell.itemLink.itemId,
    };
  }
  if (cell.catalogConditionCells !== undefined) {
    parsed.catalogConditionCells = [...cell.catalogConditionCells];
  }
  if (cell.bomToggleNodeId !== undefined) parsed.bomToggleNodeId = cell.bomToggleNodeId;
  if (cell.materialTag !== undefined) parsed.materialTag = cell.materialTag;

  return isEmptyCell(parsed) ? undefined : parsed;
};

/**
 * Una celda sin nada dentro: sin contenido y sin nada que la distinga.
 *
 * El formato **sí** cuenta como contenido. Los bordes de una tabla vacía son
 * el dibujo de la tabla; borrarlos por estar la celda "vacía" desmonta la
 * plantilla. En la plantilla real son 224 celdas.
 */
export const isEmptyCell = (cell: TemplateCell): boolean =>
  cell.content.trim() === "" &&
  cell.format === undefined &&
  cell.note === undefined &&
  cell.options === undefined &&
  cell.elementKey === undefined &&
  cell.goTo === undefined &&
  cell.itemLink === undefined &&
  cell.catalogConditionCells === undefined &&
  cell.bomToggleNodeId === undefined &&
  cell.materialTag === undefined;

const readStyles = (styles: PersistedSheetStyles | null | undefined): SheetStyles => {
  const source = styles ?? {};
  return {
    columnWidths: numericRecord(source.columnWidths),
    rowHeights: numericRecord(source.rowHeights),
    hiddenRows: hiddenOf(source.hiddenRows, source.templateHiddenRows),
    hiddenColumns: hiddenOf(source.hiddenColumns, source.templateHiddenColumns),
    freezeRow: source.freezeRow ?? 0,
    freezeColumn: source.freezeColumn ?? 0,
    mergedCells: (source.mergedCells ?? []).map((merged) => ({ ...merged })),
    namedRanges: (source.namedRanges ?? []).map((range) => ({
      ...range,
      tags: [...(range.tags ?? [])],
    })),
    semiFinishedZones: (source.semiFinishedZones ?? []).map((zone) => ({ ...zone })),
    itemCatalogTables: (source.itemCatalogTables ?? []).map((table) => ({
      ...table,
      ...(table.tags === undefined ? {} : { tags: [...table.tags] }),
    })),
  };
};

/** Lee una hoja guardada y la lleva al modelo canónico. */
export const readSheet = (sheet: PersistedSheet, position: number): TemplateSheet => {
  const cells: Record<string, TemplateCell> = {};
  for (const [ref, persisted] of Object.entries(sheet.cells ?? {})) {
    const cell = readCell(persisted ?? {});
    if (cell !== undefined) cells[ref.toUpperCase()] = cell;
  }

  return {
    ...(sheet.id === undefined ? {} : { id: sheet.id }),
    name: sheet.name,
    position,
    cells,
    styles: readStyles(sheet.cellsStyles),
  };
};

/**
 * Lee una plantilla guardada.
 *
 * Las posiciones se reasignan por el orden en que llegan las hojas: en la
 * base, las dos hojas de la única plantilla real valen ambas 0, así que el
 * orden efectivo lo decidía el motor de base de datos. Aquí siempre queda
 * uno, explícito y sin huecos.
 */
export const readTemplate = (template: PersistedTemplate): TemplateDocument => {
  const sheets = [...(template.sheets ?? [])]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((sheet, index) => readSheet(sheet, index));

  return {
    ...(template.id === undefined ? {} : { id: template.id }),
    name: template.name,
    code: template.code,
    ...(template.description === undefined ? {} : { description: template.description }),
    type: template.type === TemplateType.COST ? TemplateType.COST : TemplateType.DESIGN,
    ...(template.designSubTypeId === undefined
      ? {}
      : { designSubTypeId: template.designSubTypeId }),
    status:
      template.status === TemplateStatus.PUBLISHED
        ? TemplateStatus.PUBLISHED
        : TemplateStatus.DRAFT,
    version: template.version ?? 0,
    ...(template.contractVersion === undefined
      ? {}
      : { contractVersion: template.contractVersion }),
    sheets,
  };
};

const writeCell = (cell: TemplateCell): PersistedCell => {
  const persisted: PersistedCell = {
    formula: cell.content,
    // Espejo obsoleto: el renderizador de project-front todavía busca las
    // celdas de gráfico en `value`. Se retira cuando adopte el contrato.
    value: cell.content,
  };

  const format = cell.format ?? {};
  if (format.bold !== undefined) persisted.bold = format.bold;
  if (format.textColor !== undefined) persisted.textColor = format.textColor;
  if (format.backgroundColor !== undefined) {
    persisted.backgroundColor = format.backgroundColor;
  }
  if (format.border !== undefined) persisted.border = format.border;
  if (format.borderTop !== undefined) persisted.borderTop = format.borderTop;
  if (format.borderRight !== undefined) persisted.borderRight = format.borderRight;
  if (format.borderBottom !== undefined) persisted.borderBottom = format.borderBottom;
  if (format.borderLeft !== undefined) persisted.borderLeft = format.borderLeft;
  if (format.decimals !== undefined) persisted.decimals = format.decimals;
  if (format.conditionalFormat !== undefined) {
    persisted.conditionalFormat = { ...format.conditionalFormat };
  }

  if (cell.note !== undefined) persisted.note = cell.note;
  if (cell.options !== undefined) persisted.options = [...cell.options];
  if (cell.elementKey !== undefined) persisted.elementKey = cell.elementKey;
  if (cell.goTo !== undefined) {
    persisted.goTo = { conditionCells: [...cell.goTo.conditionCells] };
  }
  if (cell.itemLink !== undefined) {
    persisted.itemLink = {
      catalogSheetName: cell.itemLink.catalogSheetName,
      // Espejo obsoleto, por la misma razón que `value`.
      catalogSheetId: cell.itemLink.catalogSheetName,
      catalogTableId: cell.itemLink.catalogTableId,
      itemId: cell.itemLink.itemId,
    };
  }
  if (cell.catalogConditionCells !== undefined) {
    persisted.catalogConditionCells = [...cell.catalogConditionCells];
  }
  if (cell.bomToggleNodeId !== undefined) {
    persisted.bomToggleNodeId = cell.bomToggleNodeId;
  }
  if (cell.materialTag !== undefined) persisted.materialTag = cell.materialTag;

  return persisted;
};

const writeStyles = (styles: SheetStyles): PersistedSheetStyles => ({
  columnWidths: { ...styles.columnWidths },
  rowHeights: { ...styles.rowHeights },
  hiddenRows: [...styles.hiddenRows],
  hiddenColumns: [...styles.hiddenColumns],
  // Espejo obsoleto: `loadTemplate` en project-front todavía lee estos.
  templateHiddenRows: [...styles.hiddenRows],
  templateHiddenColumns: [...styles.hiddenColumns],
  freezeRow: styles.freezeRow,
  freezeColumn: styles.freezeColumn,
  mergedCells: styles.mergedCells.map((merged) => ({ ...merged })),
  namedRanges: styles.namedRanges.map((range) => ({ ...range, tags: [...range.tags] })),
  semiFinishedZones: styles.semiFinishedZones.map((zone) => ({ ...zone })),
  itemCatalogTables: styles.itemCatalogTables.map((table) => ({
    ...table,
    ...(table.tags === undefined ? {} : { tags: [...table.tags] }),
  })),
});

/** Lleva una hoja canónica a la forma que se guarda, descartando lo vacío. */
export const writeSheet = (sheet: TemplateSheet): PersistedSheet => {
  const cells: Record<string, PersistedCell> = {};
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    if (isEmptyCell(cell)) continue;
    cells[ref] = writeCell(cell);
  }

  return {
    ...(sheet.id === undefined ? {} : { id: sheet.id }),
    name: sheet.name,
    order: sheet.position,
    cells,
    cellsStyles: writeStyles(sheet.styles),
  };
};

/** Lleva una plantilla canónica a la forma que se guarda. */
export const writeTemplate = (template: TemplateDocument): PersistedTemplate => ({
  ...(template.id === undefined ? {} : { id: template.id }),
  name: template.name,
  code: template.code,
  ...(template.description === undefined ? {} : { description: template.description }),
  type: template.type,
  ...(template.designSubTypeId === undefined
    ? {}
    : { designSubTypeId: template.designSubTypeId }),
  status: template.status,
  version: template.version,
  contractVersion: CONTRACT_VERSION,
  sheets: template.sheets
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((sheet, index) => writeSheet({ ...sheet, position: index })),
});

/** Estilos de una hoja nueva, para quien empieza una plantilla desde cero. */
export { emptySheetStyles };
