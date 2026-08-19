/**
 * Modelo canónico de una plantilla de diseño.
 *
 * Hoy la misma plantilla tiene tres formas distintas y ninguna manda: los
 * tipos de `project-front/src/commons/types.ts`, los de
 * `spreadsheet-types.ts` —que son otros— y lo que de verdad hay guardado en
 * la base, que no coincide del todo con ninguno de los dos. De ahí salieron
 * las filas ocultas que se pierden al cargar una plantilla: un lado escribe
 * `templateHiddenRows` y el otro lee `hiddenRows`.
 *
 * Este módulo es el árbitro. Lo que aquí se declara es la plantilla; todo lo
 * demás es una representación de paso.
 */

/** Para qué sirve la plantilla. */
export const TemplateType = {
  DESIGN: "DESIGN",
  COST: "COST",
} as const;
export type TemplateType = (typeof TemplateType)[keyof typeof TemplateType];

/**
 * Si los diseñadores la ven.
 *
 * Es la pieza que hoy falta: sin ella, una plantilla a medio escribir aparece
 * en la biblioteca igual que una terminada, que es exactamente lo que pasa
 * con las tres plantillas sin hojas de la base.
 */
export const TemplateStatus = {
  DRAFT: "DRAFT",
  PUBLISHED: "PUBLISHED",
} as const;
export type TemplateStatus = (typeof TemplateStatus)[keyof typeof TemplateStatus];

/** Marca el origen de un segmento del código de diseño. */
export type MaterialTag = "MO" | "MD";

/**
 * Clase de contenido de una celda.
 *
 * Son tres, no dos. La directiva de gráfico (`DRAW:...`) no es una fórmula
 * —el motor no la calcula— ni un literal cualquiera —tiene sintaxis propia y
 * referencias que hay que validar—.
 */
export type CellKind = "empty" | "literal" | "formula" | "graphic";

/** Presentación de una celda. Todo opcional: una celda sin formato no lo declara. */
export interface CellFormat {
  bold?: boolean;
  textColor?: string;
  backgroundColor?: string;
  /** Atajo para los cuatro lados, p. ej. `1px solid #000`. */
  border?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
  /** Decimales a mostrar; sin declarar, se muestra el valor tal cual. */
  decimals?: number;
  conditionalFormat?: ConditionalFormat;
}

export interface ConditionalFormat {
  min?: number;
  max?: number;
  color: string;
}

/**
 * Navegación desde una celda hacia el rango con nombre que corresponda.
 *
 * El destino no se fija: se elige comparando el valor de las celdas de
 * condición con las etiquetas de los rangos con nombre.
 */
export interface GoToConfig {
  conditionCells: string[];
}

/** Enlace de una celda a una fila de una tabla de catálogo. */
export interface CellItemLink {
  catalogSheetName: string;
  catalogTableId: string;
  itemId: string;
}

/** Región con nombre, destino de la navegación `goTo`. */
export interface NamedRange {
  id: string;
  name: string;
  /** Etiquetas contra las que se comparan las celdas de condición. */
  tags: string[];
  startCell: string;
  endCell: string;
}

/** Región asociada a un semielaborado del catálogo. Una celda pertenece a una zona como mucho. */
export interface SemiFinishedZone {
  id: string;
  semiFinishedId: number;
  /** Código canónico: es la clave con la que se resuelve el color de la zona. */
  semiFinishedCode: string;
  semiFinishedName: string;
  startCell: string;
  endCell: string;
}

/**
 * Región que define un catálogo de ítems: cada fila posterior a los
 * encabezados es un ítem, y los desplazamientos dicen qué columna lleva el
 * identificador, la descripción y la unidad de medida.
 */
export interface ItemCatalogTable {
  id: string;
  name: string;
  tags?: string[];
  startCell: string;
  endCell: string;
  headerRows: number;
  /** Desplazamientos en columnas desde `startCell`, empezando en 0. */
  idColumnOffset: number;
  descriptionColumnOffset: number;
  umColumnOffset: number;
}

export interface MergedCell {
  startCell: string;
  endCell: string;
  rowSpan: number;
  colSpan: number;
}

/**
 * Estilos y estructura de una hoja.
 *
 * Deliberadamente **no** incluye lo que el diseñador oculta por su cuenta
 * (`userHiddenRows`, `hiddenCells`): eso es estado de quien usa la plantilla,
 * no de la plantilla. Hoy se persiste, siempre vacío, y no significa nada.
 */
export interface SheetStyles {
  /** Ancho por índice de columna, empezando en 0. */
  columnWidths: Record<number, number>;
  /** Alto por índice de fila, empezando en 0. */
  rowHeights: Record<number, number>;
  hiddenRows: number[];
  hiddenColumns: number[];
  /** Inmoviliza hasta esta fila sin incluirla; 0 es sin inmovilizar. */
  freezeRow: number;
  freezeColumn: number;
  mergedCells: MergedCell[];
  namedRanges: NamedRange[];
  semiFinishedZones: SemiFinishedZone[];
  itemCatalogTables: ItemCatalogTable[];
}

/**
 * Una celda.
 *
 * `content` es lo que el autor escribió: una fórmula (`=A1*2`), un literal o
 * una directiva de gráfico. **El valor calculado no está aquí**, y no es un
 * olvido: guardarlo congela dentro de la plantilla un número que su fórmula
 * ya no produce. Se recalcula al cargar.
 */
export interface TemplateCell {
  content: string;
  format?: CellFormat;
  note?: string;
  /** Opciones de la lista desplegable de la celda. */
  options?: string[];
  /** Clave del dato del elemento con el que se rellena al cargar la plantilla. */
  elementKey?: string;
  goTo?: GoToConfig;
  itemLink?: CellItemLink;
  /** Celdas cuyo valor decide a qué catálogo enrutar el selector de ítems. */
  catalogConditionCells?: string[];
  /** Nodo del BOM que esta celda expande o contrae en el resumen. */
  bomToggleNodeId?: number;
  materialTag?: MaterialTag;
}

export interface TemplateSheet {
  /** Identificador en la base; ausente en una hoja que aún no se ha guardado. */
  id?: number;
  name: string;
  /** Posición dentro de la plantilla, empezando en 0 y sin huecos. */
  position: number;
  /** Celdas indexadas por referencia local sin calificar: `A1`, `AH73`. */
  cells: Record<string, TemplateCell>;
  styles: SheetStyles;
}

export interface TemplateDocument {
  id?: number;
  name: string;
  code: string;
  description?: string;
  type: TemplateType;
  designSubTypeId?: number;
  status: TemplateStatus;
  /** Cuántas veces se ha publicado. 0 mientras no se haya publicado nunca. */
  version: number;
  /** Versión del contrato con la que se serializó por última vez. */
  contractVersion?: string;
  sheets: TemplateSheet[];
}

/** Estilos de hoja vacíos, para empezar una hoja nueva. */
export const emptySheetStyles = (): SheetStyles => ({
  columnWidths: {},
  rowHeights: {},
  hiddenRows: [],
  hiddenColumns: [],
  freezeRow: 0,
  freezeColumn: 0,
  mergedCells: [],
  namedRanges: [],
  semiFinishedZones: [],
  itemCatalogTables: [],
});
