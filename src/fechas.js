/* Fechas locales en formato AAAA-MM-DD (el mismo que usa el cliente para `vence`). */
export function hoyIso(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
