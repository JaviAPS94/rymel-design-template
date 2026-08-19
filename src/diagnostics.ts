/**
 * Un solo tipo de diagnóstico para todo lo que puede estar mal en una
 * plantilla, lo detecte quien lo detecte.
 *
 * Unificado a propósito: el editor los agrupa por hoja y lleva al autor a la
 * celda o la región afectada, y no puede hacerlo si cada comprobación
 * devuelve su propia forma.
 */

/** Qué clase de problema es. */
export type DiagnosticCode =
  // Estructura del documento
  | "duplicate-sheet-name"
  | "invalid-cell-ref"
  | "region-out-of-sheet"
  | "overlapping-zones"
  | "invalid-catalog-offsets"
  | "missing-catalog-table"
  | "missing-condition-cell"
  | "empty-name"
  // Contenido de una celda
  | "graphic-directive"
  // Fórmulas, delegadas en el motor
  | "syntax"
  | "unknown-sheet"
  | "unknown-function"
  | "function-not-assigned"
  | "argument-count"
  | "circular";

/** Dónde está el problema. */
export interface DiagnosticLocation {
  /** Hoja afectada; ausente si el problema es del documento entero. */
  sheet?: string;
  /** Celda, en referencia local sin calificar: `A1`. */
  cell?: string;
  /** Identificador de la región afectada, cuando el problema es de una. */
  regionId?: string;
}

export interface TemplateDiagnostic extends DiagnosticLocation {
  code: DiagnosticCode;
  /** Motivo legible, escrito para quien está creando la plantilla. */
  message: string;
}
