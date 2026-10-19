/* Error con código HTTP que la capa de rutas convierte en respuesta JSON. */
export class ErrorApi extends Error {
  constructor(status, mensaje, extra = {}) {
    super(mensaje);
    this.status = status;
    this.extra = extra;
  }
}
