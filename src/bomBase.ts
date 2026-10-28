/**
 * La lista de materiales base de una plantilla.
 *
 * El administrador la genera en el editor desde una estructura BOM y lo que la
 * plantilla vincula (zonas de semielaborado, tablas de catálogo e ítems), la
 * ajusta como cualquier hoja y la publica con la plantilla. Cada diseño se
 * lleva su copia y la calcula con sus valores; al mostrarla se le suman los
 * accesorios que la norma asigna a su elemento.
 *
 * Cantidad, descripción y unidad son fórmulas a la celda vinculada y a su
 * fila del catálogo, no valores copiados: la cantidad depende de cada diseño.
 */

import { columnIndexToLabel, evaluateSheet, parseCellRef } from "@rymel/formula-engine";
import { emptySheetStyles, type CellFormat, type TemplateCell, type TemplateSheet } from "./types.js";
import {
  BOM_SUMMARY_COLUMN_WIDTHS,
  bomAccessoryRows,
  type BomElement,
  type BomStructure,
  type BomStructureNode,
  type BomSummaryCell,
  type BomSummaryRow,
} from "./bom.js";

export const BOM_BASE_SHEET_NAME = "Lista de materiales";

export const BOM_HEADERS = [
  "Item",
  "Descripción",
  "Cantidad",
  "U.M.",
  "Referencia",
  "Costo promedio",
  "Último costo",
  "Observación",
] as const;

/** La hoja de lista de materiales de una plantilla, si la tiene. */
export const bomBaseSheet = <S extends Pick<TemplateSheet, "styles">>(sheets: S[]): S | undefined =>
  sheets.find((sheet) => sheet.styles.billOfMaterials !== undefined);

/**
 * El nombre de hoja tal como va dentro de una fórmula: entre comillas si
 * lleva algo que el analizador no acepta suelto. Es la regla de
 * `quoteSheetName` del motor, que esta versión del motor aún no exporta.
 */
const quoteSheet = (name: string): string =>
  /^[A-Za-z0-9_][A-Za-z0-9_.]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;

const refAt = (row: number, col: number) => `${columnIndexToLabel(col)}${row + 1}`;

type ItemRow = { itemId: string; description: string; quantity: string; um: string };

/** Los ítems que la plantilla vincula dentro de las zonas del semielaborado. */
const templateItems = (sheets: TemplateSheet[], sfId: number): ItemRow[] => {
  const rows: ItemRow[] = [];
  for (const sheet of sheets) {
    for (const zone of sheet.styles.semiFinishedZones) {
      if (zone.semiFinishedId !== sfId) continue;
      const start = parseCellRef(zone.startCell);
      const end = parseCellRef(zone.endCell);
      if (!start || !end) continue;
      for (let r = Math.min(start.row, end.row); r <= Math.max(start.row, end.row); r++) {
        for (let c = Math.min(start.col, end.col); c <= Math.max(start.col, end.col); c++) {
          const ref = refAt(r, c);
          const link = sheet.cells[ref]?.itemLink;
          if (!link) continue;
          rows.push({
            itemId: link.itemId,
            quantity: `=${quoteSheet(sheet.name)}!${ref}`,
            ...catalogFormulas(sheets, link.catalogTableId, link.itemId),
          });
        }
      }
    }
  }
  return rows;
};

/** Descripción y unidad como fórmulas a la fila del ítem en su catálogo. */
const catalogFormulas = (
  sheets: TemplateSheet[],
  tableId: string,
  itemId: string,
): { description: string; um: string } => {
  for (const sheet of sheets) {
    const table = sheet.styles.itemCatalogTables.find((candidate) => candidate.id === tableId);
    if (!table) continue;
    const start = parseCellRef(table.startCell);
    const end = parseCellRef(table.endCell);
    if (!start || !end) break;
    const minCol = Math.min(start.col, end.col);
    const quoted = quoteSheet(sheet.name);
    for (let r = Math.min(start.row, end.row) + table.headerRows; r <= Math.max(start.row, end.row); r++) {
      const id = sheet.cells[refAt(r, minCol + table.idColumnOffset)]?.content.trim();
      if (id !== itemId) continue;
      return {
        description: `=${quoted}!${refAt(r, minCol + table.descriptionColumnOffset)}`,
        um: `=${quoted}!${refAt(r, minCol + table.umColumnOffset)}`,
      };
    }
    return { description: "(item no encontrado)", um: "" };
  }
  return { description: "(catálogo borrado)", um: "" };
};

/** Recorrido de hojas a raíz: los semielaborados hijos van antes que el padre. */
const leavesFirst = (nodes: BomStructureNode[]): BomStructureNode[] =>
  nodes.flatMap((node) => [...leavesFirst(node.children), node]);

const TITLE: CellFormat = { bold: true, textColor: "#7c3aed" };
const HEADER: CellFormat = { bold: true, backgroundColor: "#dbeafe" };
const CHILD: CellFormat = { backgroundColor: "#fed7aa" };
const CHILD_ITEM: CellFormat = { backgroundColor: "#fff7ed" };

/**
 * Genera la hoja base: por cada semielaborado de la estructura, de hojas a
 * raíz, su título, el encabezado, sus hijos (desplegados, con sus ítems) y
 * los ítems que la plantilla vincula en sus zonas.
 *
 * `sheets` son las demás hojas de la plantilla, no la base.
 */
export const buildBomBaseSheet = (
  structure: BomStructure & { id: number; code: string; name: string },
  sheets: TemplateSheet[],
): TemplateSheet => {
  const cells: Record<string, TemplateCell> = {};
  const set = (row: number, col: number, content: string, format?: CellFormat) => {
    if (content === "" && !format) return;
    cells[refAt(row, col)] = { content, ...(format ? { format: { ...format } } : {}) };
  };
  const writeItem = (row: number, item: ItemRow, format?: CellFormat) => {
    [item.itemId, item.description, item.quantity, item.um].forEach((content, index) =>
      set(row, index + 1, content, format),
    );
  };

  let row = 0;
  for (const node of leavesFirst(structure.nodes)) {
    set(row, 0, String(node.semiFinished.id), { bold: true });
    set(row, 1, `Semielaborado : ${node.semiFinished.name}`, TITLE);
    row++;
    BOM_HEADERS.forEach((header, index) => set(row, index + 1, header, HEADER));
    row++;
    for (const child of node.children) {
      set(row, 0, "", CHILD);
      set(row, 1, child.semiFinished.code, CHILD);
      set(row, 2, `Semielaborado : ${child.semiFinished.name}`, CHILD);
      set(row, 3, "1", CHILD);
      set(row, 4, "UND", CHILD);
      row++;
      for (const item of templateItems(sheets, child.semiFinished.id)) writeItem(row++, item, CHILD_ITEM);
    }
    for (const item of templateItems(sheets, node.semiFinished.id)) writeItem(row++, item);
    row++;
  }

  return {
    name: BOM_BASE_SHEET_NAME,
    position: sheets.length,
    cells,
    styles: {
      ...emptySheetStyles(),
      columnWidths: { ...BOM_SUMMARY_COLUMN_WIDTHS },
      billOfMaterials: {
        structureId: structure.id,
        structureCode: structure.code,
        structureName: structure.name,
      },
    },
  };
};

// --- Cálculo en el diseño -------------------------------------------------

/** Una celda de una hoja de diseño guardada: fórmula, valor y lo calculado. */
export interface BomRuntimeCell {
  value?: unknown;
  formula?: string;
  computed?: unknown;
  bold?: boolean;
  textColor?: string;
  backgroundColor?: string;
}

const shownOf = (cell: BomRuntimeCell): string => {
  const computed = cell.computed;
  if (computed !== undefined && computed !== null && computed !== "") return String(computed);
  return cell.value === undefined || cell.value === null ? "" : String(cell.value);
};

/**
 * La hoja base de un diseño, calculada con los valores **actuales** de sus
 * demás hojas.
 *
 * No se fía del `computed` guardado de la base: el diseñador recalcula la hoja
 * que edita, no las que dependen de ella en otras hojas, y la base no se
 * edita nunca. Las demás hojas entran con lo que muestran, así que una
 * fórmula de diseño de esas hojas no se vuelve a evaluar aquí.
 */
export const evaluateBomBase = async (
  base: { name: string; cells: Record<string, BomRuntimeCell | undefined> },
  sheets: { name: string; cells: Record<string, BomRuntimeCell | undefined> }[],
): Promise<Record<string, BomSummaryCell>> => {
  const book: Record<string, { formula: string }> = {};
  for (const sheet of sheets) {
    if (sheet.name === base.name) continue;
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      if (cell) book[`${sheet.name}!${ref}`] = { formula: shownOf(cell) };
    }
  }
  for (const [ref, cell] of Object.entries(base.cells)) {
    if (cell) book[`${base.name}!${ref}`] = { formula: cell.formula || shownOf(cell) };
  }
  const { values } = await evaluateSheet(book);

  const result: Record<string, BomSummaryCell> = {};
  for (const [ref, cell] of Object.entries(base.cells)) {
    if (!cell) continue;
    const value = values[`${base.name}!${ref}`];
    const shown = value === undefined || value === null ? "" : String(value);
    result[ref] = {
      value: shown,
      formula: shown,
      computed: shown,
      ...(cell.bold ? { bold: true } : {}),
      ...(cell.textColor ? { textColor: cell.textColor } : {}),
      ...(cell.backgroundColor ? { backgroundColor: cell.backgroundColor } : {}),
    };
  }
  return result;
};

// --- Accesorios -----------------------------------------------------------

const COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];

const textOf = (cell: { value?: unknown } | undefined): string =>
  cell?.value === undefined || cell.value === null ? "" : String(cell.value).trim();

const summaryCell = (value: string): BomSummaryCell => ({ value, formula: value, computed: value });

/**
 * Suma a la lista los accesorios del elemento, al final de la sección de su
 * semielaborado, y desplaza lo que viene debajo. La sección se reconoce por
 * su título (A: id del semielaborado; B: «Semielaborado : …») y termina en
 * la primera fila vacía o en el título siguiente.
 *
 * No modifica `cells`. Se aplica al mostrar: el elemento es dato del diseño,
 * y la base, de la plantilla.
 */
export const withAccessories = <T extends { value?: unknown }>(
  cells: Record<string, T>,
  element: BomElement,
): Record<string, T | BomSummaryCell> => {
  const rowsOf = new Map<number, Map<string, T>>();
  for (const [ref, cell] of Object.entries(cells)) {
    const parsed = parseCellRef(ref);
    if (!parsed) continue;
    const row = rowsOf.get(parsed.row) ?? new Map<string, T>();
    row.set(ref.replace(/\d+$/, ""), cell);
    rowsOf.set(parsed.row, row);
  }
  const lastRow = Math.max(-1, ...rowsOf.keys());
  const at = (row: number, column: string) => rowsOf.get(row)?.get(column);
  const isEmpty = (row: number) => COLUMNS.every((column) => textOf(at(row, column)) === "");
  const isTitle = (row: number) =>
    /^\d+$/.test(textOf(at(row, "A"))) && textOf(at(row, "B")).startsWith("Semielaborado");

  // Dónde se insertan los accesorios de cada sección
  const insertions: { after: number; rows: BomSummaryRow[] }[] = [];
  for (let row = 0; row <= lastRow; row++) {
    if (!isTitle(row)) continue;
    let end = row;
    for (let next = row + 1; next <= lastRow && !isEmpty(next) && !isTitle(next); next++) end = next;
    const accessories = bomAccessoryRows(element, Number(textOf(at(row, "A"))));
    if (accessories.length > 0) insertions.push({ after: end, rows: accessories });
  }
  if (insertions.length === 0) return { ...cells };

  const shiftOf = (row: number) =>
    insertions.reduce((shift, insertion) => (row > insertion.after ? shift + insertion.rows.length : shift), 0);
  const result: Record<string, T | BomSummaryCell> = {};
  for (const [ref, cell] of Object.entries(cells)) {
    const parsed = parseCellRef(ref);
    if (!parsed) {
      result[ref] = cell;
      continue;
    }
    result[refAt(parsed.row + shiftOf(parsed.row), parsed.col)] = cell;
  }
  for (const insertion of insertions) {
    const first = insertion.after + 1 + shiftOf(insertion.after);
    insertion.rows.forEach((accessory, index) => {
      const values = [
        accessory.itemId,
        accessory.description,
        accessory.cantidad,
        accessory.um,
        accessory.reference,
        accessory.averageCost,
        accessory.lastCost,
        accessory.note,
      ];
      values.forEach((value, column) => {
        if (value !== "") result[refAt(first + index, column + 1)] = summaryCell(value);
      });
    });
  }
  return result;
};
