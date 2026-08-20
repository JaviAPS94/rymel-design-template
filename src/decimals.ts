/**
 * Decimales escritos con coma.
 *
 * Las plantillas se escriben a mano, y quien las escribe teclea `3,36` porque
 * es como se escribe un decimal en español. El motor no lo entiende: para él
 * `3,36` es texto, no un número.
 *
 * Lo que hacía el evaluador anterior era peor que no entenderlo. Usaba
 * `parseFloat`, que **trunca en la coma**: `3,36` valía 3, `16,708` valía 16 y
 * `0,022` valía 0. En la única plantilla completa que existe hay **1200 celdas
 * así**, y 641 de ellas quedaron guardadas como cero. Nadie lo vio, porque un
 * número equivocado no se distingue de uno correcto mirando la pantalla.
 *
 * De ahí que esto exista: para convertirlos a la forma que el motor sí
 * entiende, de manera explícita y a la vista.
 *
 * **La conversión nunca ocurre sola.** No se aplica al leer ni al guardar: la
 * pide el editor, en el momento en que alguien escribe la celda o pulsa el
 * botón. Reescribir en silencio el contenido de una plantilla al serializarla
 * sería exactamente el tipo de cambio invisible que este contrato existe para
 * impedir.
 */

import type { TemplateDocument } from "./types.js";

/**
 * Un literal que es un número con coma decimal, y nada más.
 *
 * Deliberadamente estrecho. No encajan —y por tanto no se tocan—:
 *
 * - las fórmulas, donde la coma separa argumentos: `=SUMA(1,2)`;
 * - el texto que contiene una coma: `Aislamiento (0,25 mm)`, `M0 0,75`;
 * - las directivas de gráfico: `DRAW:FRONTAL:NUCLEO:H53,H54`;
 * - los números con más de una coma, por si algún día apareciera la notación
 *   de miles `1.234,56`, que exige una decisión distinta.
 */
const DECIMAL_COMMA = /^-?\d+,\d+$/;

/** `true` si el contenido es un número escrito con coma decimal. */
export const isDecimalComma = (content: string): boolean =>
  DECIMAL_COMMA.test(content.trim());

/**
 * El mismo número con punto decimal. Devuelve el contenido intacto si no es
 * un decimal con coma.
 */
export const normalizeDecimalComma = (content: string): string =>
  isDecimalComma(content) ? content.trim().replace(",", ".") : content;

export interface DecimalCommaCell {
  sheet: string;
  ref: string;
  before: string;
  after: string;
  /**
   * `true` cuando la coma va seguida de exactamente tres cifras y por tanto
   * podría leerse como separador de miles: `16,708` es 16.708 o 16 708.
   *
   * En los datos reales gana la lectura decimal —hay celdas como `0,012`, que
   * como millares no significan nada, ninguna cifra lleva dos comas, y el
   * mismo documento escribe `115.2` con punto—, pero la ambigüedad existe y
   * quien normalice merece verla señalada antes de aceptarla.
   */
  ambiguous: boolean;
}

/**
 * Todas las celdas del documento cuyo contenido es un decimal con coma.
 *
 * Sirve para enseñar qué cambiaría antes de cambiarlo.
 */
export const findDecimalCommaCells = (
  template: TemplateDocument,
): DecimalCommaCell[] => {
  const found: DecimalCommaCell[] = [];

  for (const sheet of template.sheets) {
    for (const [ref, cell] of Object.entries(sheet.cells)) {
      if (!isDecimalComma(cell.content)) continue;

      const after = normalizeDecimalComma(cell.content);
      found.push({
        sheet: sheet.name,
        ref,
        before: cell.content,
        after,
        ambiguous: /,\d{3}$/.test(cell.content.trim()),
      });
    }
  }

  return found;
};

/**
 * El documento con sus decimales de coma convertidos.
 *
 * Devuelve el mismo documento si no había ninguno, para que quien lo use pueda
 * comparar por identidad y no rehacer trabajo.
 */
export const normalizeDecimalCommas = (
  template: TemplateDocument,
): TemplateDocument => {
  if (findDecimalCommaCells(template).length === 0) return template;

  return {
    ...template,
    sheets: template.sheets.map((sheet) => {
      const cells = { ...sheet.cells };
      let changed = false;

      for (const [ref, cell] of Object.entries(cells)) {
        if (!isDecimalComma(cell.content)) continue;
        cells[ref] = { ...cell, content: normalizeDecimalComma(cell.content) };
        changed = true;
      }

      return changed ? { ...sheet, cells } : sheet;
    }),
  };
};
