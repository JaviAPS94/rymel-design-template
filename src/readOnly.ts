/**
 * Si una celda está protegida contra la edición del diseñador.
 *
 * Es la única regla, y vive aquí para que el editor la señale, el diseñador
 * la cumpla y el servidor la compruebe exactamente igual. Tres
 * implementaciones de «¿está dentro de la zona?» acabarían discrepando en el
 * borde de una celda combinada, y la discrepancia sería una celda que el
 * diseñador ve protegida y el servidor no, o al revés.
 */

import { parseCellRef } from "@rymel/formula-engine";

interface Region {
  startCell: string;
  endCell: string;
}

/**
 * Lo mínimo que hace falta para decidir: las zonas y las combinaciones.
 *
 * Es estructural a propósito. Lo cumplen los estilos canónicos de una hoja,
 * la hoja runtime del diseñador y los estilos guardados que lee el servidor,
 * sin convertir entre ellos.
 */
export interface ReadOnlyLookup {
  readOnlyZones?: readonly Region[];
  mergedCells?: readonly Region[];
}

interface Rect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

const rectOf = (region: Region): Rect | null => {
  const start = parseCellRef(region.startCell.trim().toUpperCase());
  const end = parseCellRef(region.endCell.trim().toUpperCase());
  if (start === null || end === null) return null;
  return {
    top: Math.min(start.row, end.row),
    left: Math.min(start.col, end.col),
    bottom: Math.max(start.row, end.row),
    right: Math.max(start.col, end.col),
  };
};

const contains = (rect: Rect, row: number, col: number): boolean =>
  row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;

const inAnyZone = (zones: readonly Region[], row: number, col: number): boolean =>
  zones.some((zone) => {
    const rect = rectOf(zone);
    return rect !== null && contains(rect, row, col);
  });

/**
 * Verdadero si el diseñador no puede modificar `ref`.
 *
 * Una celda combinada es una sola celda para quien la ve, así que se protege
 * entera cuando lo está su celda de origen —la de arriba a la izquierda, que
 * es la que guarda el contenido—.
 */
export const isReadOnly = (sheet: ReadOnlyLookup, ref: string): boolean => {
  const zones = sheet.readOnlyZones ?? [];
  if (zones.length === 0) return false;

  const position = parseCellRef(ref.trim().toUpperCase());
  if (position === null) return false;
  if (inAnyZone(zones, position.row, position.col)) return true;

  for (const merged of sheet.mergedCells ?? []) {
    const rect = rectOf(merged);
    if (rect === null || !contains(rect, position.row, position.col)) continue;
    return inAnyZone(zones, rect.top, rect.left);
  }

  return false;
};
