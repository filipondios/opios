/* Fechas locales en formato AAAA-MM-DD (el mismo que usa el cliente para `vence`). */
export function hoyIso(d = new Date()) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** Suma (o resta) días a una fecha AAAA-MM-DD y devuelve otra fecha AAAA-MM-DD. */
export function sumarDias(iso, dias) {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return hoyIso(new Date(anio, mes - 1, dia + dias));
}
