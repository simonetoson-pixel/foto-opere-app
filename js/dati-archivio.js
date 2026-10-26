// I dati dell'archivio sul computer: ponti, foto, e gli indirizzi firmati per vederle.

import { leggiTutto, modifica, cancella, cancellaFile, urlFirmatiMolti, urlFirmato } from './rete.js';

export const dati = { ponti: [], foto: [], perPonte: new Map(), senzaPonte: [] };

export const TIPI = { giunti: 'Giunti', pavimentazioni: 'Pavimentazioni', strutture: 'Strutture' };
export const COLORE_TIPO = { giunti: '#B45309', pavimentazioni: '#475569', strutture: '#6D28D9', nessuna: '#8A9490' };

const COLONNE = 'id,ponte_id,categoria,nota,lat,lon,precisione_m,scattata_il,creato_il,path,autore,origine';

export async function carica() {
  const [ponti, foto] = await Promise.all([
    leggiTutto('ponti?select=id,nome,strada,km,km_m,tipologia,comune,provincia,lat,lon,raggio_m&order=strada,km_m,id'),
    leggiTutto(`foto?select=${COLONNE}&order=scattata_il.desc.nullslast,id`),
  ]);
  dati.ponti = ponti;
  dati.foto = foto;
  ricostruisci();
  return dati;
}

export function ricostruisci() {
  dati.perPonte = new Map();
  dati.senzaPonte = [];
  const note = new Set(dati.ponti.map(p => p.id));
  for (const f of dati.foto) {
    if (f.ponte_id && note.has(f.ponte_id)) {
      if (!dati.perPonte.has(f.ponte_id)) dati.perPonte.set(f.ponte_id, []);
      dati.perPonte.get(f.ponte_id).push(f);
    } else dati.senzaPonte.push(f);
  }
}

export const fotoDi = id => dati.perPonte.get(id) || [];
export const ponteDi = id => dati.ponti.find(p => p.id === id);
export const miniatura = f => `thumb/${f.id}.jpg`;

// ---- indirizzi firmati: si chiedono a gruppi e si tengono finche' sono validi
const cache = new Map();            // percorso -> {url, scade}
const VALIDITA = 3600;

export async function indirizzi(percorsi) {
  const adesso = Date.now();
  const mancano = [...new Set(percorsi)].filter(p => !cache.has(p) || cache.get(p).scade < adesso + 60000);
  for (let i = 0; i < mancano.length; i += 100) {
    const pezzo = mancano.slice(i, i + 100);
    try {
      const m = await urlFirmatiMolti('foto', pezzo, VALIDITA);
      for (const [p, url] of Object.entries(m)) cache.set(p, { url, scade: adesso + VALIDITA * 1000 });
    } catch { /* quelle foto restano senza anteprima */ }
  }
  return Object.fromEntries(percorsi.map(p => [p, cache.get(p) && cache.get(p).url]));
}

export async function indirizzo(percorso) {
  return (await indirizzi([percorso]))[percorso] || await urlFirmato('foto', percorso);
}

// ---- modifiche
export async function cambia(f, campi) {
  await modifica('foto', `id=eq.${f.id}`, campi);
  Object.assign(f, campi);
  if ('ponte_id' in campi) ricostruisci();           // la foto cambia galleria
}

export async function togli(f) {
  await cancella('foto', `id=eq.${f.id}`);
  await cancellaFile('foto', f.path).catch(() => {});
  await cancellaFile('foto', miniatura(f)).catch(() => {});
  dati.foto = dati.foto.filter(x => x.id !== f.id);
  ricostruisci();
}
