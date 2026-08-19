/**
 * Directivas de gráfico.
 *
 * Una celda puede pedir un dibujo en vez de un número:
 * `DRAW:FRONTAL:NUCLEO:H53,H54` pinta el núcleo tomando el alto de `H53` y el
 * ancho de `H54`. Lo interpreta `SpreadSheetCell` en project-front.
 *
 * Hace falta validarlo aquí porque **el renderizador falla en silencio**: si
 * la vista no se reconoce, no dibuja nada y deja la celda en blanco; si un
 * componente está mal escrito, lo ignora y dibuja de menos. Quien escribe la
 * plantilla no se entera hasta que alguien abre el diseño y ve un hueco.
 *
 * La gramática está tomada del propio renderizador, no de la documentación:
 *
 *   DRAW:BOBINADO:diámetro:anchosSup:anchosInf:salidasSup:salidasInf
 *                :diámetroExt:anchoRect:espesorRect:separaciónRect
 *   DRAW:FRONTAL|SUPERIOR:componentes:nucleoAlto,nucleoAncho
 *                :bobinaProfundidad:tanqueAlto,tanqueDiámetro
 *
 * Los segmentos vacíos son válidos y significan "este dato no se indica":
 * `DRAW:FRONTAL:TANQUE,NUCLEO,BOBINA:H53,H54::AD53,AD55` deja la bobina sin
 * profundidad a propósito.
 */

import { isCellRef } from "@rymel/formula-engine";

const PREFIX = "DRAW:";

export const GRAPHIC_VIEWS = ["FRONTAL", "SUPERIOR", "BOBINADO"] as const;
export type GraphicView = (typeof GRAPHIC_VIEWS)[number];

export const GRAPHIC_COMPONENTS = ["NUCLEO", "BOBINA", "TANQUE"] as const;
export type GraphicComponent = (typeof GRAPHIC_COMPONENTS)[number];

export interface GraphicDirective {
  view: GraphicView;
  /** Vacío en la vista `BOBINADO`, que no declara componentes. */
  components: GraphicComponent[];
  /** Celdas que la directiva usa como argumentos, en orden de aparición. */
  referencedCells: string[];
}

export interface GraphicDirectiveProblem {
  message: string;
}

export type GraphicParseResult =
  | { ok: true; directive: GraphicDirective }
  | { ok: false; problems: GraphicDirectiveProblem[] };

/** `true` si el contenido de la celda es una directiva de gráfico, con `=` o sin él. */
export const isGraphicContent = (content: string | undefined | null): boolean => {
  if (content === undefined || content === null) return false;
  const trimmed = String(content).trim();
  const bare = trimmed.startsWith("=") ? trimmed.slice(1).trimStart() : trimmed;
  return bare.toUpperCase().startsWith(PREFIX);
};

/** La directiva sin el `=` inicial, que es la forma que el renderizador espera. */
export const normalizeGraphicContent = (content: string): string => {
  const trimmed = content.trim();
  return trimmed.startsWith("=") ? trimmed.slice(1).trimStart() : trimmed;
};

/** Segmentos separados por coma, sin los vacíos: `"D59, D60"` → `["D59","D60"]`. */
const cellList = (segment: string | undefined): string[] =>
  (segment ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

/**
 * Analiza una directiva y devuelve o bien su contenido, o bien todo lo que
 * está mal en ella. No se detiene en el primer problema: quien la escribe
 * agradece verlos todos de una vez.
 */
export const parseGraphicDirective = (content: string): GraphicParseResult => {
  const problems: GraphicDirectiveProblem[] = [];
  const directive = normalizeGraphicContent(content);
  const segments = directive.split(":");

  if (segments.length < 3) {
    return {
      ok: false,
      problems: [
        {
          message:
            "La directiva necesita al menos vista y argumentos: `DRAW:VISTA:...`",
        },
      ],
    };
  }

  const rawView = (segments[1] ?? "").trim().toUpperCase();
  const view = GRAPHIC_VIEWS.find((candidate) => candidate === rawView);

  if (view === undefined) {
    return {
      ok: false,
      problems: [
        {
          message: `La vista "${segments[1]}" no existe; las vistas son ${GRAPHIC_VIEWS.join(", ")}`,
        },
      ],
    };
  }

  const components: GraphicComponent[] = [];
  let cellSegments: string[];

  if (view === "BOBINADO") {
    // Los diez argumentos de la vista de bobinado son todos celdas.
    cellSegments = segments.slice(2, 11);
  } else {
    for (const raw of cellList(segments[2])) {
      const component = GRAPHIC_COMPONENTS.find(
        (candidate) => candidate === raw.toUpperCase(),
      );
      if (component === undefined) {
        problems.push({
          message: `El componente "${raw}" no existe; los componentes son ${GRAPHIC_COMPONENTS.join(", ")}`,
        });
        continue;
      }
      components.push(component);
    }

    if (components.length === 0 && problems.length === 0) {
      problems.push({
        message: "La vista no declara ningún componente que dibujar",
      });
    }

    cellSegments = segments.slice(3, 6);
  }

  const referencedCells: string[] = [];
  for (const segment of cellSegments) {
    for (const candidate of cellList(segment)) {
      if (!isCellRef(candidate)) {
        problems.push({
          message: `"${candidate}" no es una referencia de celda válida`,
        });
        continue;
      }
      referencedCells.push(candidate.replace(/\$/g, "").toUpperCase());
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  return { ok: true, directive: { view, components, referencedCells } };
};
