/**
 * La lista de materiales de un diseño.
 *
 * Se arma con dos fuentes: lo que define la plantilla —ítems vinculados dentro
 * de las zonas de semielaborado, con la descripción y la unidad de su tabla de
 * catálogo— y lo que define la norma del elemento —sus accesorios, cada uno
 * con su semielaborado—, sobre el árbol de la estructura BOM que corresponde a
 * la referencia ERP del elemento.
 *
 * Vive aquí para que el diseñador y el administrador la armen con la misma
 * regla. La forma de salida son celdas de hoja de cálculo, que es como la
 * pinta el diseñador. La fijan `bom.spec.ts` y sus casos (`bom-cases.json`).
 */

import { sha256 } from "./sha256.js";

/** Lo que la lista lee de una celda de una hoja del diseño. */
export interface BomSourceCell {
  value?: string;
  formula?: string;
  computed?: string | number | null;
  itemLink?: { catalogTableId: string; itemId: string };
}

export interface BomItemCatalogTable {
  id: string;
  startCell: string;
  endCell: string;
  headerRows: number;
  idColumnOffset: number;
  descriptionColumnOffset: number;
  umColumnOffset: number;
}

export interface BomSemiFinishedZone {
  semiFinishedId: number;
  startCell?: string;
  endCell?: string;
}

/** Una hoja del diseño, en su forma de ejecución (`sub_design.data`). */
export interface BomSourceSheet {
  id: string;
  name: string;
  cells: { [ref: string]: BomSourceCell | undefined };
  semiFinishedZones?: BomSemiFinishedZone[];
  itemCatalogTables?: BomItemCatalogTable[];
}

export interface BomStructureNode {
  id: number;
  semiFinished: { id: number; name: string; code: string };
  children: BomStructureNode[];
}

/** La estructura BOM del ERP: solo su árbol. */
export interface BomStructure {
  nodes: BomStructureNode[];
}

/** Un accesorio del elemento, dentro de `values` con la clave `accesories`. */
export interface BomAccessory {
  id: number;
  reference?: string;
  description: string;
  unitMeasurement?: string;
  unitOfMeasurement?: string;
  averageCost?: number;
  lastCost?: number;
  value?: number;
  semiFinished?: { id: number };
}

/** El elemento del diseño: solo sus valores (texto JSON o arreglo). */
export interface BomElement {
  values: unknown;
}

/** Una celda de la lista armada. */
export interface BomSummaryCell {
  value: string;
  formula: string;
  computed: string;
  bold?: boolean;
  textColor?: string;
  backgroundColor?: string;
  /** Pulsarla despliega o pliega ese semielaborado hijo. */
  bomToggleNodeId?: number;
}

type Cell = BomSummaryCell;
type Sheet = BomSourceSheet;
type BomResponse = BomStructure;
type BomNode = BomStructureNode;
type ElementResponse = BomElement;
type Accessory = BomAccessory;
type ItemCatalogTable = BomItemCatalogTable;

/** `values` llega como arreglo desde el catálogo de elementos y como texto JSON desde un diseño. */
export const parseElementValues = (values: unknown): Record<string, unknown>[] => {
  if (Array.isArray(values)) return values as Record<string, unknown>[];
  if (typeof values === "string") {
    try {
      const parsed: unknown = JSON.parse(values);
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }
  return [];
};

// Helper function to convert column index (0-based) to Excel-style column name
const getColumnLabel = (col: number): string => {
  let label = "";
  let num = col + 1; // Convert to 1-based
  while (num > 0) {
    const remainder = (num - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    num = Math.floor((num - 1) / 26);
  }
  return label;
};

// Helper function to convert Excel-style column name to column index (0-based)
const getColumnIndex = (label: string): number => {
  let index = 0;
  for (let i = 0; i < label.length; i++) {
    index = index * 26 + (label.charCodeAt(i) - 64);
  }
  return index - 1;
};

const parseCellRef = (ref: string): { row: number; col: number } | null => {
  const match = ref.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  const col = getColumnIndex(match[1]);
  const row = Number.parseInt(match[2]) - 1;
  return { row, col };
};

// Cells built here must set `formula` to the same text as `value` — SpreadSheet's
// formula-recalculation pass (which runs shortly after mount / on every edit)
// re-evaluates every cell from `formula` and overwrites `computed` with the
// result; a blank `formula` evaluates to "" and would wipe the cell.
const cell = (value: string, extra: Partial<Cell> = {}): Cell => ({
  value,
  formula: value,
  computed: value,
  ...extra,
});

const readCellDisplayValue = (c: BomSourceCell | undefined): string => {
  if (!c) return "";
  const computed =
    c.computed !== undefined && c.computed !== null && c.computed !== ""
      ? c.computed
      : null;
  if (computed !== null) return String(computed).trim();
  return (c.value || "").trim();
};

// Workbook-wide resolver: catalogTableId -> { sheetId, table, itemsById }.
// Each catalog table is indexed by item ID so itemLink lookups are O(1) and
// edits to the catalog row's description / U.M. propagate automatically.
const buildCatalogResolver = (sheets: Sheet[]) => {
  const tables = new Map<
    string,
    {
      sheetId: string;
      sheetName: string;
      table: ItemCatalogTable;
      itemsById: Map<string, { description: string; um: string }>;
    }
  >();
  sheets.forEach((sheet) => {
    (sheet.itemCatalogTables || []).forEach((table) => {
      const start = parseCellRef(table.startCell);
      const end = parseCellRef(table.endCell);
      if (!start || !end) return;
      const maxRow = Math.max(start.row, end.row);
      const minCol = Math.min(start.col, end.col);
      const itemsById = new Map<string, { description: string; um: string }>();
      const dataStart = Math.min(start.row, end.row) + table.headerRows;
      for (let r = dataStart; r <= maxRow; r++) {
        const idRef = `${getColumnLabel(minCol + table.idColumnOffset)}${r + 1}`;
        const descRef = `${getColumnLabel(minCol + table.descriptionColumnOffset)}${r + 1}`;
        const umRef = `${getColumnLabel(minCol + table.umColumnOffset)}${r + 1}`;
        const itemId = readCellDisplayValue(sheet.cells[idRef]);
        if (!itemId) continue;
        itemsById.set(itemId, {
          description: readCellDisplayValue(sheet.cells[descRef]),
          um: readCellDisplayValue(sheet.cells[umRef]),
        });
      }
      tables.set(table.id, {
        sheetId: sheet.id,
        sheetName: sheet.name,
        table,
        itemsById,
      });
    });
  });
  return tables;
};

// Una fila de material. Referencia, costos y observación solo los tienen los
// accesorios de la norma.
type BomRow = {
  itemId: string;
  description: string;
  cantidad: string;
  um: string;
  reference: string;
  averageCost: string;
  lastCost: string;
  note: string;
};

const NO_ERP_FIELDS = { reference: "", averageCost: "", lastCost: "", note: "" };

/** El valor como texto; vacío si falta. Un 0 es un valor. */
const present = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

// Build BOM summary cells from the tree returned by the BOM API.
// Children are rendered before their parent (post-order DFS) so leaf SFs
// appear first, and each parent section shows its direct children as
// collapsible orange reference rows before the regular item rows.
// expandedChildNodes controls which child SF nodes show their items inline.
export const buildBomSummaryCells = (
  bom: BomResponse,
  expandedChildNodes: Set<number>,
  sheets: Sheet[],
  element: ElementResponse,
): { [key: string]: Cell } => {
  const catalogResolver = buildCatalogResolver(sheets);
  const cells: { [key: string]: Cell } = {};
  let row = 0;

  // F–I solo llevan algo en los accesorios; un ítem de la plantilla no tiene
  // esos datos y no deja celdas vacías
  const writeErpFields = (r: BomRow, extra: Partial<Cell> = {}) => {
    const values = [r.reference, r.averageCost, r.lastCost, r.note];
    ["F", "G", "H", "I"].forEach((column, index) => {
      if (values[index]) cells[`${column}${row + 1}`] = cell(values[index], extra);
    });
  };

  // Collect item rows for a given SF id (logic unchanged from original)
  const collectItemRows = (sfId: number) => {
    const itemRows: BomRow[] = [];
    sheets.forEach((sheet) => {
      (sheet.semiFinishedZones || []).forEach((zone) => {
        if (zone.semiFinishedId !== sfId) return;
        if (!zone.startCell || !zone.endCell) return;
        const start = parseCellRef(zone.startCell);
        const end = parseCellRef(zone.endCell);
        if (!start || !end) return;
        const minRow = Math.min(start.row, end.row);
        const maxRow = Math.max(start.row, end.row);
        const minCol = Math.min(start.col, end.col);
        const maxCol = Math.max(start.col, end.col);
        for (let r = minRow; r <= maxRow; r++) {
          for (let c = minCol; c <= maxCol; c++) {
            const ref = `${getColumnLabel(c)}${r + 1}`;
            const cell = sheet.cells[ref];
            const link = cell?.itemLink;
            if (!link) continue;
            const cantidad = readCellDisplayValue(cell);
            const table = catalogResolver.get(link.catalogTableId);
            let description = "(catálogo borrado)";
            let um = "";
            if (table) {
              const item = table.itemsById.get(link.itemId);
              if (item) {
                description = item.description;
                um = item.um;
              } else {
                description = "(item no encontrado)";
              }
            }
            itemRows.push({ itemId: link.itemId, description, cantidad, um, ...NO_ERP_FIELDS });
          }
        }
      });
    });
    return itemRows;
  };

  // Collect accessory rows for a given SF id from element.values["accesories"]
  const collectAccessoryRows = (sfId: number) => {
    // `values` llega como arreglo desde el catálogo de elementos y como texto
    // JSON desde la respuesta de un diseño. Aquí no se sabe de cuál vino.
    const accEntry = parseElementValues(element.values).find(
      (v: Record<string, unknown>) => v["key"] === "accesories",
    );
    if (!accEntry || !accEntry["value"]) return [];
    let accessories: Accessory[] = [];
    try {
      const raw = accEntry["value"];
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      accessories = Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
    return accessories
      .filter((acc) => acc.semiFinished?.id === sfId)
      .map((acc): BomRow => {
        // Todos los campos del accesorio: los que trae del ERP al asignarlo
        // en la norma y la cantidad que le pone la norma. Lo que falta se
        // dice en Observación; no se rellena.
        const cantidad = present(acc.value);
        const um = present(acc.unitOfMeasurement) || present(acc.unitMeasurement);
        const averageCost = present(acc.averageCost);
        const lastCost = present(acc.lastCost);
        const missing = [
          !cantidad && "sin cantidad en la norma",
          !um && "sin unidad en la norma",
          (!averageCost || !lastCost) && "sin costos en la norma",
        ].filter(Boolean);
        return {
          itemId: String(acc.id),
          description: acc.description,
          cantidad,
          um,
          reference: present(acc.reference),
          averageCost,
          lastCost,
          note: missing.join("; "),
        };
      });
  };

  // Post-order DFS: collect nodes leaf-first so child sections precede parents
  const collectNodes = (nodes: BomNode[]): BomNode[] => {
    const result: BomNode[] = [];
    for (const node of nodes) {
      result.push(...collectNodes(node.children));
      result.push(node);
    }
    return result;
  };

  const orderedNodes = collectNodes(bom.nodes);

  orderedNodes.forEach((node) => {
    const sf = node.semiFinished;
    const itemRows = collectItemRows(sf.id);
    const accessoryRows = collectAccessoryRows(sf.id);

    // Section title row
    cells[`A${row + 1}`] = cell(String(sf.id), { bold: true });
    cells[`B${row + 1}`] = cell(`Semielaborado : ${sf.name}`, {
      bold: true,
      textColor: "#7c3aed",
    });
    row++;

    // Sub-header row
    const subHeaderStyle = {
      bold: true,
      backgroundColor: "#dbeafe",
    };
    cells[`B${row + 1}`] = cell("Item", subHeaderStyle);
    cells[`C${row + 1}`] = cell("Descripción", subHeaderStyle);
    cells[`D${row + 1}`] = cell("Cantidad", subHeaderStyle);
    cells[`E${row + 1}`] = cell("U.M.", subHeaderStyle);
    cells[`F${row + 1}`] = cell("Referencia", subHeaderStyle);
    cells[`G${row + 1}`] = cell("Costo promedio", subHeaderStyle);
    cells[`H${row + 1}`] = cell("Último costo", subHeaderStyle);
    cells[`I${row + 1}`] = cell("Observación", subHeaderStyle);
    row++;

    // Child SF reference rows with toggle indicator in column A.
    // When expanded, the child's items are shown inline below the toggle row.
    const childSfStyle = { backgroundColor: "#fed7aa" };
    const childExpandedItemStyle = { backgroundColor: "#fff7ed" };
    node.children.forEach((child) => {
      const childSf = child.semiFinished;
      const isExpanded = expandedChildNodes.has(child.id);

      cells[`A${row + 1}`] = cell(isExpanded ? "▼" : "▶", {
        bomToggleNodeId: child.id,
        ...childSfStyle,
      });
      cells[`B${row + 1}`] = cell(childSf.code, childSfStyle);
      cells[`C${row + 1}`] = cell(`Semielaborado : ${childSf.name}`, childSfStyle);
      cells[`D${row + 1}`] = cell("1", childSfStyle);
      cells[`E${row + 1}`] = cell("UND", childSfStyle);
      row++;

      if (isExpanded) {
        [...collectItemRows(childSf.id), ...collectAccessoryRows(childSf.id)].forEach((r) => {
          cells[`B${row + 1}`] = cell(r.itemId, childExpandedItemStyle);
          cells[`C${row + 1}`] = cell(r.description, childExpandedItemStyle);
          cells[`D${row + 1}`] = cell(r.cantidad, childExpandedItemStyle);
          cells[`E${row + 1}`] = cell(r.um, childExpandedItemStyle);
          writeErpFields(r, childExpandedItemStyle);
          row++;
        });
      }
    });

    // Regular item rows of this node (from spreadsheet zones + element accessories)
    [...itemRows, ...accessoryRows].forEach((r) => {
      cells[`B${row + 1}`] = cell(r.itemId);
      cells[`C${row + 1}`] = cell(r.description);
      cells[`D${row + 1}`] = cell(r.cantidad);
      cells[`E${row + 1}`] = cell(r.um);
      writeErpFields(r);
      row++;
    });

    // Empty separator row between sections
    row++;
  });

  return cells;
};

// A=ID, B=item, C=descripción (wide), D=cantidad, E=U.M., F=referencia,
// G=costo promedio, H=último costo, I=observación
export const BOM_SUMMARY_COLUMN_WIDTHS: { [key: number]: number } = {
  0: 80,
  1: 90,
  2: 280,
  3: 90,
  4: 70,
  5: 100,
  6: 110,
  7: 110,
  8: 260,
};

/** JSON con las claves de los objetos ordenadas, para que el orden no cuente. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * Huella de una lista generada, sin editar: SHA-256 en hexadecimal.
 *
 * El diseñador la guarda con sus ajustes. Al volver a abrirlos se genera la
 * lista otra vez y, si la huella es otra, algo de lo que la alimenta
 * —estructura BOM, hojas del diseño, accesorios o catálogo— cambió desde que
 * se ajustó.
 */
export const bomFingerprint = (cells: { [ref: string]: BomSummaryCell | undefined }): string =>
  sha256(canonical(cells));
