/**
 * La plantilla vista como un libro plano, que es como la entiende el motor.
 *
 * Las celdas se indexan por referencia calificada —`Tablas!J14`— en una sola
 * estructura para toda la plantilla, no un mapa por hoja. No es una
 * comodidad: es lo que permite que el grafo de dependencias sea uno solo. Con
 * un grafo por hoja, editar `Tablas!J14` no marca como sucias las celdas de
 * `Resumen` que la consultan con `BUSCARV`, que es justo lo que hace hoy
 * project-front recalculando hoja por hoja en un bucle.
 */

import { qualify, splitRef } from "@rymel/formula-engine";
import type { TemplateDocument, TemplateSheet } from "./types.js";

/** Celdas del libro tal como las consume el motor. */
export type EngineBook = Record<string, { formula: string }>;

/** Referencia calificada de una celda dentro de una hoja. */
export const bookRef = (sheetName: string, cell: string): string =>
  qualify(sheetName, cell);

/** Separa una referencia del libro en su hoja y su celda. */
export const splitBookRef = (ref: string): { sheet?: string; cell: string } =>
  splitRef(ref);

/** Todas las celdas de una hoja, calificadas con su nombre. */
export const sheetToBook = (sheet: TemplateSheet): EngineBook => {
  const book: EngineBook = {};
  for (const [ref, cell] of Object.entries(sheet.cells)) {
    book[bookRef(sheet.name, ref)] = { formula: cell.content };
  }
  return book;
};

/**
 * Todas las celdas de la plantilla en un solo libro.
 *
 * Las hojas van siempre, incluso vacías: el motor deduce de las claves qué
 * hojas existen, y con eso puede distinguir una referencia a una hoja que no
 * existe de una celda vacía que vale cero.
 */
export const toEngineBook = (template: TemplateDocument): EngineBook => {
  const book: EngineBook = {};
  for (const sheet of template.sheets) {
    Object.assign(book, sheetToBook(sheet));
  }
  return book;
};
