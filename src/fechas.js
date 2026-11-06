/* Fechas locales en formato AAAA-MM-DD (el mismo que usa el cliente para `vence`). */

/** Fecha de hoy en la zona indicada (por defecto, la del sistema). */
export function hoyIso(d = new Date(), zona = null) {
  if (zona) {
    try {
      // en-CA produce AAAA-MM-DD de forma estable.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(d);
    } catch {
      /* Zona no válida: se usa la del sistema. */
    }
  }
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** Suma (o resta) días a una fecha AAAA-MM-DD y devuelve otra fecha AAAA-MM-DD. */
export function sumarDias(iso, dias) {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return hoyIso(new Date(anio, mes - 1, dia + dias));
}

/** Días completos entre dos fechas AAAA-MM-DD (`hasta - desde`). */
export function diasEntre(desde, hasta) {
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}
