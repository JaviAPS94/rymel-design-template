/**
 * Los campos espejo: la lista que se vació.
 *
 * El serializador escribía cuatro campos por duplicado para que
 * `project-front` siguiera funcionando mientras no consumiera este contrato.
 * Era un puente, y la diferencia entre un puente y una deuda olvidada es que
 * el puente tenga escrito quién lo cruza todavía y cuándo se quita.
 *
 * **Se quitó en v2.0.0.** Antes se comprobó que ningún consumidor los leía:
 * se sirvieron las plantillas sin ellos y tanto la carga del diseñador como
 * la ida y vuelta completa siguieron pasando, incluidas la fila oculta y el
 * enlace a ítem, que eran los casos concretos.
 *
 * `DEPRECATED_FIELDS` queda vacía a propósito y no se borra: la prueba de
 * `deprecated.spec.ts` comprueba que el serializador escribe **exactamente**
 * lo declarado aquí. Con la lista vacía, escribir cualquier campo espejo
 * vuelve a fallar. El guardarraíl sigue puesto después de cruzar el puente.
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
 * Campos que se escriben en espejo hoy: ninguno.
 *
 * Añadir uno es admitir una deuda, y hay que declararlo aquí con quién lo lee
 * — si no, la prueba falla.
 */
export const DEPRECATED_FIELDS: readonly DeprecatedField[] = [] as const;

export interface RetiredField {
  field: string;
  canonical: string;
  /** Versión del contrato en la que dejó de escribirse. */
  retiredIn: string;
  wasReadBy: string[];
}

/**
 * Los que ya se retiraron.
 *
 * **Se siguen aceptando al leer.** Dejar de escribirlos no es lo mismo que
 * dejar de entenderlos: hay plantillas guardadas que todavía los traen, y una
 * copia de seguridad antigua tiene que poder restaurarse.
 */
export const RETIRED_FIELDS: readonly RetiredField[] = [
  {
    field: "templateHiddenRows",
    canonical: "hiddenRows",
    retiredIn: "2.0.0",
    wasReadBy: ["project-front"],
  },
  {
    field: "templateHiddenColumns",
    canonical: "hiddenColumns",
    retiredIn: "2.0.0",
    wasReadBy: ["project-front"],
  },
  {
    field: "value",
    canonical: "formula",
    retiredIn: "2.0.0",
    wasReadBy: ["project-front"],
  },
  {
    field: "catalogSheetId",
    canonical: "catalogSheetName",
    retiredIn: "2.0.0",
    wasReadBy: ["project-front"],
  },
] as const;

/** Los campos espejo que un consumidor concreto mantiene vivos. */
export const deprecatedFieldsReadBy = (
  consumer: string,
): DeprecatedField[] =>
  DEPRECATED_FIELDS.filter((field) => field.readBy.includes(consumer));

/**
 * `true` si ya no queda ningún consumidor que lea campos espejo, es decir, si
 * se pueden retirar. Con la lista vacía lo es, y así se queda salvo que
 * alguien vuelva a añadir un puente.
 */
export const canRetireDeprecatedFields = (): boolean =>
  DEPRECATED_FIELDS.every((field) => field.readBy.length === 0);
