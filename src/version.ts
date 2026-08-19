/**
 * Versión del contrato con la que se serializó un documento.
 *
 * Viaja dentro de la plantilla guardada para que un consumidor pueda darse
 * cuenta de que recibió algo escrito con una versión posterior a la suya. Con
 * tres repositorios fijando cada uno su propio tag, esa divergencia no es una
 * hipótesis: ya pasa con el motor de fórmulas.
 *
 * Sube de versión mayor cualquier cambio en la forma persistida que haga que
 * una plantilla válida deje de leerse igual.
 */
export const CONTRACT_VERSION = "1.0.0";
