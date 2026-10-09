/**
 * De qué se alimenta una celda y a quién alimenta.
 *
 * Lo usan el editor de plantillas del administrador y el diseñador del
 * cliente, y por eso vive aquí: las dos pantallas tienen que explicar una
 * celda de la misma manera. Cada una lee sus celdas a su modo —la plantilla
 * del administrador, las hojas del diseño en el cliente— y entrega aquí una
 * función que las lee.
 *
 * El grafo tiene que ser de todo el libro, con claves calificadas
 * (`Tablas!J14`): con uno por hoja no se ven los dependientes de otras hojas.
 */

import { analyzeExpression, type DepGraph } from "@rymel/formula-engine";
import { bookRef, splitBookRef } from "./book.js";
import { isGraphicContent } from "./graphic.js";
import type { TemplateDocument } from "./types.js";

/** Qué hay en una celda al final de una cadena de precedentes. */
export type TraceOrigin = "formula" | "literal" | "element" | "empty";

export interface TraceRef {
  sheet: string;
  /** Celda o rango, tal como se escribió: `G14`, `B3:C10`. */
  ref: string;
}

export interface TraceNode extends TraceRef {
  origin: TraceOrigin;
  /** Clave del dato del elemento, si la celda se rellena con uno. */
  elementKey?: string;
}

export interface DesignCall {
  code: string;
  /** Referencias que aparecen en sus argumentos. */
  refs: TraceRef[];
}

export interface CellTrace {
  /** Precedentes directos, agrupados como están escritos. */
  precedents: TraceRef[];
  /** Dependientes directos, celda a celda. */
  dependents: TraceRef[];
  /** Referencias calificadas a resaltar en la rejilla. */
  highlight: { precedents: Set<string>; dependents: Set<string> };
  /** Invocaciones a fórmulas de diseño: su código y sus argumentos, nunca su expresión. */
  designCalls: DesignCall[];
  /** Cadena completa por niveles; solo si se pidió. */
  chain?: TraceNode[][];
  /** Si la cadena vuelve a la celda de partida. */
  circular: boolean;
}

/** Lo que el rastreo necesita saber de una celda. */
export interface TraceCellSource {
  /** Lo escrito: una fórmula con `=` o un valor. */
  content: string;
  /** Dato del elemento que la rellena, si se sabe. */
  elementKey?: string;
}

export type TraceCellLookup = (sheet: string, ref: string) => TraceCellSource | undefined;

export interface TraceOptions {
  /** Recorrer todos los precedentes transitivos. */
  full?: boolean;
  /** Códigos de las fórmulas de diseño, para distinguir sus invocaciones. */
  designFunctionCodes?: readonly string[];
}

/** Las celdas de una plantilla, para el rastreo. */
export const templateCellLookup =
  (template: TemplateDocument): TraceCellLookup =>
  (sheet, ref) =>
    template.sheets.find((item) => item.name === sheet)?.cells[ref];

const split = (qualified: string): TraceRef => {
  // Las claves del grafo siempre van calificadas: el libro es uno solo.
  const { sheet, cell } = splitBookRef(qualified);
  return { sheet: sheet ?? "", ref: cell };
};

/** Una referencia como la devuelve el análisis, llevada a su hoja. */
const qualifyRef = (ref: string, currentSheet: string): TraceRef => {
  const separator = ref.lastIndexOf("!");
  if (separator === -1) return { sheet: currentSheet, ref };
  const sheet = ref
    .slice(0, separator)
    .replace(/^'(.*)'$/, "$1")
    .replace(/''/g, "'");
  return { sheet, ref: ref.slice(separator + 1) };
};

const isFormula = (content: string): boolean =>
  content.startsWith("=") && !isGraphicContent(content);

const originOf = (
  lookup: TraceCellLookup,
  { sheet, ref }: TraceRef,
): Pick<TraceNode, "origin" | "elementKey"> => {
  const cell = lookup(sheet, ref);
  if (cell?.elementKey) return { origin: "element", elementKey: cell.elementKey };
  const content = cell?.content.trim() ?? "";
  if (content === "") return { origin: "empty" };
  if (isFormula(content)) return { origin: "formula" };
  return { origin: "literal" };
};

/**
 * El texto de los argumentos de cada invocación a `code` dentro de la fórmula,
 * respetando paréntesis anidados y literales de texto.
 */
const argumentsOf = (formula: string, code: string): string[] => {
  const found: string[] = [];
  const pattern = new RegExp(`(?<![A-Za-z0-9_.])${code}\\s*\\(`, "gi");
  for (const match of formula.matchAll(pattern)) {
    let depth = 1;
    let inString = false;
    const start = match.index! + match[0].length;
    for (let index = start; index < formula.length; index++) {
      const character = formula[index];
      if (character === '"') inString = !inString;
      if (inString) continue;
      if (character === "(") depth++;
      if (character === ")" && --depth === 0) {
        found.push(formula.slice(start, index));
        break;
      }
    }
  }
  return found;
};

export const traceCell = (
  lookup: TraceCellLookup,
  graph: DepGraph,
  sheetName: string,
  ref: string,
  options: TraceOptions = {},
): CellTrace => {
  const start = bookRef(sheetName, ref);
  const content = lookup(sheetName, ref)?.content ?? "";
  const analyzed = isFormula(content) ? analyzeExpression(content) : { refs: [], calls: [] };

  const precedents = analyzed.refs.map((item) => qualifyRef(item, sheetName));
  const highlightPrecedents = new Set(graph.precedents.get(start) ?? []);
  const highlightDependents = new Set(graph.dependents.get(start) ?? []);
  const dependents = [...highlightDependents].sort().map(split);

  const designCodes = new Set(
    (options.designFunctionCodes ?? []).map((code) => code.toUpperCase()),
  );
  const designCalls: DesignCall[] = [...new Set(analyzed.calls.map((call) => call.name))]
    .filter((name) => designCodes.has(name))
    .map((code) => ({
      code,
      refs: argumentsOf(content, code).flatMap((args) =>
        analyzeExpression(args).refs.map((item) => qualifyRef(item, sheetName)),
      ),
    }));

  let circular = false;
  let chain: TraceNode[][] | undefined;

  if (options.full) {
    chain = [];
    const visited = new Set([start]);
    let frontier = [start];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (const current of frontier) {
        for (const precedent of graph.precedents.get(current) ?? []) {
          if (precedent === start) circular = true;
          if (visited.has(precedent)) continue;
          visited.add(precedent);
          next.push(precedent);
        }
      }
      if (next.length === 0) break;
      next.sort();
      chain.push(
        next.map((qualified) => {
          const node = split(qualified);
          return { ...node, ...originOf(lookup, node) };
        }),
      );
      frontier = next;
    }
  } else {
    // Sin la cadena completa, el ciclo se ve igual si la celda se lee a sí misma.
    circular = highlightPrecedents.has(start);
  }

  return {
    precedents,
    dependents,
    highlight: { precedents: highlightPrecedents, dependents: highlightDependents },
    designCalls,
    chain,
    circular,
  };
};
