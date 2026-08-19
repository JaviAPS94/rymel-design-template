# @rymel/design-template

Contrato de la plantilla de diseño de Rymel: los tipos canónicos, la
traducción entre lo que está guardado y ese modelo, y la validación.

Lo consumen `project-admin` (el editor de plantillas), `project-back` (que
valida lo que recibe antes de escribirlo) y, a futuro, `project-front` (el
diseñador que las carga).

## Por qué existe

Una plantilla es el punto de partida de todo cálculo: cuando un diseñador
elige una, lo que carga es la hoja completa —celdas, fórmulas, tablas de
consulta, zonas de semielaborado— y sobre esa base calcula el transformador.

Hasta ahora esa plantilla tenía tres formas distintas y ninguna mandaba: los
tipos de `project-front/src/commons/types.ts`, los de `spreadsheet-types.ts`
—que son otros— y lo que de verdad hay en la base, que no coincide del todo
con ninguno. De ahí salen defectos que nadie ve venir:

- **Las filas ocultas de una plantilla se pierden al cargarla.** Lo guardado
  se llama `templateHiddenRows`; `loadTemplate` lee `hiddenRows`.
- **Un tercio del documento es basura.** De las 3013 celdas de la única
  plantilla completa, 975 no tienen nada dentro.
- **El valor calculado viaja dentro de la plantilla**, congelando un número
  que su fórmula ya no produce.
- **Nada valida.** En producción hay tres plantillas sin una sola hoja,
  ofreciéndose a los diseñadores como si sirvieran.

Este paquete es el árbitro. Lo que aquí se declara es la plantilla.

## Uso

```ts
import { readTemplate, writeTemplate, validateTemplate } from "@rymel/design-template";

const plantilla = readTemplate(filaDeLaBase);

const problemas = validateTemplate(plantilla, {
  designFunctions: funcionesDelSubtipo,       // con sus variables, en orden
  catalogFunctionCodes: todosLosCodigos,      // para distinguir "no existe" de "no asignada"
});

if (problemas.length === 0) {
  await api.put(`/design/templates/${plantilla.id}`, writeTemplate(plantilla));
}
```

## Las tres clases de celda

`content` es lo que el autor escribió, y puede ser una de tres cosas:

| Clase | Ejemplo | Qué hace el motor |
|---|---|---|
| literal | `115.2` | lo toma como valor |
| fórmula | `=G14*BUSCARV(...)` | la calcula |
| gráfico | `DRAW:BOBINADO:D56:...` | la deja pasar; la dibuja el consumidor |

La celda de gráfico es una clase propia y no un literal cualquiera: tiene
sintaxis, y el renderizador **falla en silencio** si está mal —deja la celda en
blanco sin decir nada—. Aquí se valida la vista, los componentes y las celdas
que referencia, para que el error salga mientras se escribe la plantilla y no
cuando alguien abra el diseño.

Al guardar se le retira el `=` inicial que las plantillas antiguas le
anteponen, que es la forma que el renderizador espera de primera mano.

## Qué normaliza al guardar

- **Descarta las celdas sin contenido.** El formato cuenta como contenido: los
  bordes de una tabla vacía son el dibujo de la tabla.
- **No persiste ningún valor calculado.** Se recalcula al cargar.
- **Consolida el contenido en un solo campo.** `formula` manda sobre `value`.
- **Reasigna las posiciones de las hojas**, consecutivas y sin huecos. En la
  base, las dos hojas de la plantilla real valen ambas 0.

## Compatibilidad con project-front

Mientras `project-front` no adopte este contrato, el serializador escribe dos
campos obsoletos **en espejo**, para que su lector actual siga funcionando sin
coordinar despliegues entre repositorios:

| Canónico | Espejo obsoleto | Quién lo lee |
|---|---|---|
| `hiddenRows` / `hiddenColumns` | `templateHiddenRows` / `templateHiddenColumns` | `loadTemplate` |
| `formula` | `value` | la detección de celdas de gráfico en `SpreadSheetCell` |

Se retiran cuando `project-front` consuma el paquete.

## Validación

`validateTemplate` no evalúa nada: todas las comprobaciones son estáticas, así
que validar no depende de que el motor cifrado esté arriba ni gasta una
petición de red por cada función de diseño que la plantilla invoque.

Comprueba nombres de hoja únicos, referencias bien formadas, regiones dentro
de la hoja, zonas de semielaborado sin solapes, desplazamientos de las tablas
de catálogo, enlaces a ítems que existen, directivas de gráfico, y —apoyándose
en `analyzeSheet` del motor— sintaxis, hojas inexistentes, funciones
desconocidas, aridad y ciclos.

Cada problema es un `TemplateDiagnostic` con su hoja, su celda o región, y un
motivo escrito para quien está creando la plantilla.

## Un libro, un grafo

`toEngineBook` aplana la plantilla a un solo libro indexado por referencia
calificada (`Tablas!J14`). No es una comodidad: es lo que permite que el grafo
de dependencias sea uno solo para toda la plantilla. Con un grafo por hoja,
editar `Tablas!J14` no marca como sucias las celdas de `Resumen` que la
consultan, que es justo lo que hace hoy `project-front` recalculando hoja por
hoja en un bucle.

## Restricciones

1. **Una sola dependencia de runtime, `@rymel/formula-engine`.** Sin React,
   sin módulos de Node, sin APIs de navegador. Se verifica en cada build con
   `npm run check:deps`. Es la condición para que `project-back` valide con el
   mismo código que el navegador: si el veredicto dependiera del entorno,
   validar en el servidor no significaría nada.
2. **`CONTRACT_VERSION` viaja dentro del documento.** Con tres repositorios
   fijando cada uno su propio tag, que un consumidor reciba una plantilla
   escrita con una versión posterior a la suya no es una hipótesis.

Sube de versión mayor cualquier cambio en la forma persistida que haga que una
plantilla válida deje de leerse igual.

## Desarrollo

```bash
npm install
npm run verify     # portabilidad + tipos + pruebas + build
```

Las pruebas corren contra `test/fixtures/legacy-templates.json`, que es el
volcado literal de la tabla `template` de la base `project`, sin tocar. Es la
única forma de saber si el contrato entiende lo que hay guardado, en vez de lo
que los tipos dicen que debería haber.
