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

## Decimales escritos con coma

Las plantillas se escriben a mano y quien las escribe teclea `3,36`. El motor
no lo entiende: para él es texto.

Lo que hacía el evaluador anterior era peor que no entenderlo — usaba
`parseFloat`, que **trunca en la coma**:

| Escrito | Evaluador anterior | Motor actual | Normalizado |
|---|---|---|---|
| `3,36` | `3` | `"3,36"` (texto) | `3.36` |
| `16,708` | `16` | `"16,708"` | `16.708` |
| `0,022` | `0` | `"0,022"` | `0.022` |

En la única plantilla completa que existe hay **1200 celdas así**, y 641
quedaron guardadas como cero.

```ts
findDecimalCommaCells(plantilla);   // qué cambiaría, y cuáles son ambiguas
normalizeDecimalCommas(plantilla);  // el documento convertido
normalizeDecimalComma("3,36");      // "3.36"
```

**La conversión nunca ocurre sola.** No se aplica al leer ni al guardar: la
pide el editor. Reescribir en silencio el contenido de una plantilla al
serializarla sería el tipo de cambio invisible que este contrato existe para
impedir.

La regla es estrecha a propósito: solo un literal que es un número con coma y
nada más. No toca fórmulas (`=SUMA(1,2)`), ni texto con coma
(`Aislamiento (0,25 mm)`, `M0 0,75`), ni directivas de gráfico, ni notación de
miles (`1.234,56`), que exigiría otra decisión.

Un caso queda señalado como **ambiguo**: la coma seguida de exactamente tres
cifras, `16,708`, que podría leerse como separador de miles. En los datos
reales gana la lectura decimal —hay celdas como `0,012`, ninguna cifra lleva
dos comas y el mismo documento escribe `115.2` con punto—, pero quien
normalice merece verlo señalado antes de aceptarlo.

## Qué normaliza al guardar

- **Descarta las celdas sin contenido.** El formato cuenta como contenido: los
  bordes de una tabla vacía son el dibujo de la tabla.
- **No persiste ningún valor calculado.** Se recalcula al cargar.
- **Consolida el contenido en un solo campo.** `formula` manda sobre `value`.
- **Reasigna las posiciones de las hojas**, consecutivas y sin huecos. En la
  base, las dos hojas de la plantilla real valen ambas 0.

## Compatibilidad con project-front

El serializador escribe algunos campos **en espejo** para que un consumidor
todavía no migrado siga funcionando sin coordinar despliegues entre
repositorios. No son un comentario en un documento: están **declarados en el
código**, en `DEPRECATED_FIELDS`.

```ts
import { DEPRECATED_FIELDS, deprecatedFieldsReadBy, canRetireDeprecatedFields }
  from "@rymel/design-template";

deprecatedFieldsReadBy("project-front"); // los que mantiene vivos
canRetireDeprecatedFields();             // false mientras quede alguno
```

| Canónico | Espejo obsoleto | Quién lo lee |
|---|---|---|
| `hiddenRows` / `hiddenColumns` | `templateHiddenRows` / `templateHiddenColumns` | `project-front`, estado en memoria de la hoja |
| `formula` | `value` | `project-front`, detección de las celdas de gráfico |
| `catalogSheetName` | `catalogSheetId` | `project-front`, enlace de celda a ítem |

**La declaración y el serializador no pueden divergir.** `deprecated.spec.ts`
comprueba que se escribe exactamente lo declarado: quitar una entrada obliga a
quitar la escritura, y escribir un campo sin declararlo falla. Así la retirada
deja de ser una promesa y pasa a ser una lista que se puede vaciar.

Retirarlos todos es un cambio de **versión mayor**: una plantilla escrita sin
ellos deja de leerse igual en un consumidor antiguo.

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

## Versionado

**La forma persistida es el contrato.** Sube de versión **mayor** cualquier
cambio que haga que una plantilla válida deje de leerse igual:

- retirar un campo, espejo o no;
- renombrar un campo, o cambiar su tipo;
- cambiar qué se descarta al normalizar, o qué se considera contenido;
- cambiar la forma en que se resuelve una ambigüedad entre dos campos.

Sube de versión **menor** lo que solo añade: un campo opcional, una regla de
validación nueva, una función exportada.

El criterio no es si el código compila en el consumidor, sino si una plantilla
guardada sigue significando lo mismo. Un cambio que compila en los tres
repositorios y hace que una celda deje de leerse es mayor.

## Desarrollo

```bash
npm install
npm run verify     # portabilidad + tipos + pruebas + build
```

Las pruebas corren contra `test/fixtures/legacy-templates.json`, que es el
volcado literal de la tabla `template` de la base `project`, sin tocar. Es la
única forma de saber si el contrato entiende lo que hay guardado, en vez de lo
que los tipos dicen que debería haber.
