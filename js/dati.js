// L'elenco dei ponti sul telefono: si tiene in memoria locale cosi funziona anche
// dove non c'e' campo, e si aggiorna quando c'e'.

import { leggiTutto } from './rete.js';

const DB = 'ponti-dati', MAGAZZINO = 'ponti';

function apri() {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(MAGAZZINO)) r.result.createObjectStore(MAGAZZINO, { keyPath: 'id' });
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}

function salva(ponti) {
  return apri().then(db => new Promise((ok, no) => {
    const t = db.transaction(MAGAZZINO, 'readwrite');
    const m = t.objectStore(MAGAZZINO);
    m.clear();
    ponti.forEach(p => m.put(p));
    t.oncomplete = ok;
    t.onerror = () => no(t.error);
  }));
}

function leggi() {
  return apri().then(db => new Promise(ok => {
    const q = db.transaction(MAGAZZINO).objectStore(MAGAZZINO).getAll();
    q.onsuccess = () => ok(q.result);
  }));
}

const COLONNE = 'id,nome,strada,km,km_m,tipologia,comune,provincia,lat,lon,raggio_m';
const scarica = () => leggiTutto(`ponti?select=${COLONNE}&order=strada,km_m,id`);

export async function ponti({ onAggiornato } = {}) {
  const locali = await leggi();
  if (locali.length) {
    scarica().then(async fresche => {
      if (fresche.length) { await salva(fresche); if (onAggiornato) onAggiornato(fresche); }
    }).catch(() => {});
    return locali;
  }
  const fresche = await scarica();
  await salva(fresche);
  return fresche;
}
