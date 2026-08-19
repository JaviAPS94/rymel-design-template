/**
 * La forma en que la plantilla está guardada hoy.
 *
 * No es un diseño: es un inventario de lo que hay en la base, con sus
 * duplicidades y sus nombres desalineados. Existe para que la traducción al
 * modelo canónico ocurra en un solo sitio y esté a la vista.
 *
 * Todo es opcional porque todo falta en alguna fila real.
 */

/** Una celda tal como está en `sheet.cells`. */
export interface PersistedCell {
  /**
   * Duplicado exacto de `formula` en las 2963 celdas que traen ambos. El
   * renderizador de project-front todavía lo lee para detectar las celdas de
   * gráfico, así que se sigue escribiendo mientras dure la compatibilidad.
   *
   * @deprecated El contenido vive en `formula`.
   */
  value?: string;
  /** El contenido de la celda: fórmula, literal o directiva de gráfico. */
  formula?: string;
  /**
   * Valor calculado en el momento en que alguien guardó.
   *
   * Se lee al migrar y **no se vuelve a escribir**: congela dentro de la
   * plantilla un número que su fórmula ya no produce.
   */
  computed?: number | string;

  bold?: boolean;
  textColor?: string;
  backgroundColor?: string;
  border?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  decimals?: number;
  conditionalFormat?: { min?: number; max?: number; color: string };
  note?: string;
  options?: string[];
  elementKey?: string;
  goTo?: { conditionCells: string[] };
  itemLink?: {
    /** En lo guardado es el identificador de hoja del runtime; al leer se traduce a nombre. */
    catalogSheetId?: string;
    catalogSheetName?: string;
    catalogTableId: string;
    itemId: string;
  };
  catalogConditionCells?: string[];
  bomToggleNodeId?: number;
  materialTag?: "MO" | "MD";
}

/** Los estilos tal como están en `sheet.cellsStyles`. */
export interface PersistedSheetStyles {
  columnWidths?: Record<string | number, number>;
  rowHeights?: Record<string | number, number>;

  /** Nombre canónico de las filas ocultas de la plantilla. */
  hiddenRows?: number[];
  hiddenColumns?: number[];
  /**
   * Lo que de verdad hay escrito hoy. `loadTemplate` en project-front lee
   * `hiddenRows`, que nadie escribe: por eso las filas ocultas de una
   * plantilla no llegan al diseñador.
   *
   * @deprecated Se escribe en espejo mientras project-front no adopte el contrato.
   */
  templateHiddenRows?: number[];
  /** @deprecated Espejo de `hiddenColumns`. */
  templateHiddenColumns?: number[];

  /**
   * Lo que el diseñador oculta en su sesión. Es estado de quien usa la
   * plantilla, no de la plantilla; se descarta al leer y no se escribe.
   */
  userHiddenRows?: number[];
  userHiddenColumns?: number[];
  hiddenCells?: string[];

  freezeRow?: number;
  freezeColumn?: number;
  mergedCells?: {
    startCell: string;
    endCell: string;
    rowSpan: number;
    colSpan: number;
  }[];
  namedRanges?: {
    id: string;
    name: string;
    tags: string[];
    startCell: string;
    endCell: string;
  }[];
  semiFinishedZones?: {
    id: string;
    semiFinishedId: number;
    semiFinishedCode: string;
    semiFinishedName: string;
    startCell: string;
    endCell: string;
  }[];
  itemCatalogTables?: {
    id: string;
    name: string;
    tags?: string[];
    startCell: string;
    endCell: string;
    headerRows: number;
    idColumnOffset: number;
    descriptionColumnOffset: number;
    umColumnOffset: number;
  }[];
}

/** Una hoja tal como viaja por la API, con sus JSON ya interpretados. */
export interface PersistedSheet {
  id?: number;
  name: string;
  /** Posición. En la base las dos hojas de la plantilla real valen 0 las dos. */
  order?: number;
  cells: Record<string, PersistedCell>;
  cellsStyles?: PersistedSheetStyles | null;
}

/** Una plantilla tal como viaja por la API. */
export interface PersistedTemplate {
  id?: number;
  name: string;
  code: string;
  description?: string;
  type?: string;
  designSubTypeId?: number;
  status?: string;
  version?: number;
  contractVersion?: string;
  sheets?: PersistedSheet[];
}
