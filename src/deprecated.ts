/**
 * Los campos espejo, declarados.
 *
 * El serializador escribe algunos campos por duplicado para que un consumidor
 * todavía no migrado siga funcionando. Es un puente, no un estado permanente,
 * y la diferencia entre un puente y una deuda olvidada es que el puente tenga
 * escrito quién lo cruza todavía y cuándo se quita.
 *
 * De ahí que esto sea una declaración y no un comentario: la prueba de
 * `deprecated.spec.ts` comprueba que el serializador escribe **exactamente**
 * los campos declarados aquí. Quitar una entrada obliga a quitar la escritura,
 * y añadir una escritura sin declararla falla. La retirada deja de ser una
 * promesa y pasa a ser una lista que se puede vaciar.
 */

export interface DeprecatedField {
  /** Nombre del campo espejo en la forma persistida. */
  field: string;
  /** El campo canónico del que es copia. */
  canonical: string;
  /** Quién lo sigue leyendo. Cuando la lista quede vacía, se retira. */
  readBy: string[];
  /** Dónde se lee, para poder comprobarlo sin buscar a ciegas. */
  where: string;
}

/**
 * Campos que se escriben en espejo hoy.
 *
 * Retirarlos todos es un cambio de **versión mayor** del contrato: una
 * plantilla escrita sin ellos deja de leerse igual en un consumidor antiguo.
 */
export const DEPRECATED_FIELDS: readonly DeprecatedField[] = [
  {
    field: "templateHiddenRows",
    canonical: "hiddenRows",
    readBy: ["project-front"],
    where: "SpreadSheet.tsx, estado en memoria de la hoja (`Sheet`)",
  },
  {
    field: "templateHiddenColumns",
    canonical: "hiddenColumns",
    readBy: ["project-front"],
    where: "SpreadSheet.tsx, estado en memoria de la hoja (`Sheet`)",
  },
  {
    field: "value",
    canonical: "formula",
    readBy: ["project-front"],
    where: "SpreadSheetCell.tsx, detección de las celdas de gráfico",
  },
  {
    field: "catalogSheetId",
    canonical: "catalogSheetName",
    readBy: ["project-front"],
    where: "el enlace de una celda a un ítem de catálogo",
  },
] as const;

/** Los campos espejo que un consumidor concreto mantiene vivos. */
export const deprecatedFieldsReadBy = (
  consumer: string,
): DeprecatedField[] =>
  DEPRECATED_FIELDS.filter((field) => field.readBy.includes(consumer));

/**
 * `true` si ya no queda ningún consumidor que lea campos espejo, es decir, si
 * se pueden retirar.
 */
export const canRetireDeprecatedFields = (): boolean =>
  DEPRECATED_FIELDS.every((field) => field.readBy.length === 0);
