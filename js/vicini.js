// Dalla posizione ai ponti vicini.

export function metri(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// I ponti piu vicini, nell'ordine. La distanza e' quella dal bordo del ponte, non
// dal suo centro: un viadotto di mezzo chilometro ha il centro lontano da chi
// fotografa una pila a un'estremita'.
export function vicini(ponti, lat, lon, quanti = 15) {
  const calcolati = [];
  for (const p of ponti) {
    if (p.lat == null) continue;
    // prefiltro grossolano: un grado di latitudine sono 111 km
    if (Math.abs(p.lat - lat) > 0.6 || Math.abs(p.lon - lon) > 0.8) continue;
    const centro = metri(lat, lon, p.lat, p.lon);
    calcolati.push({ ponte: p, centro, distanza: Math.max(0, centro - (p.raggio_m || 0)) });
  }
  calcolati.sort((a, b) => a.distanza - b.distanza || a.centro - b.centro);
  return calcolati.slice(0, quanti);
}

// Quanto ci si puo fidare del ponte piu vicino, dato l'errore del GPS.
export function affidabilita(distanza, precisione) {
  const margine = Math.max(40, precisione || 0);
  if (distanza <= margine) return 'sicura';
  if (distanza <= 150) return 'probabile';
  return 'incerta';
}

export function distanzaLeggibile(m) {
  if (m < 1000) return `${Math.round(m / 5) * 5} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}
