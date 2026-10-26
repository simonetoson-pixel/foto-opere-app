// Le foto in coda sul telefono, e il loro invio.
//
// Una foto si salva sempre sul telefono, anche senza rete: in cantiere il campo va
// e viene. L'invio e' un secondo momento, che riparte da solo quando c'e' rete, ed
// e' ripetibile (stesso codice, stesso file, stessa riga): se si interrompe a meta'
// si rifa senza creare doppioni.
//
// Una foto gia' inviata resta modificabile (ponte, tipo, nota): la modifica rientra
// in coda come tutto il resto. Del file grande sul telefono non resta niente dopo
// l'invio: si tiene solo la miniatura, per l'elenco.

import { caricaFile, scrivi, cancella, cancellaFile } from './rete.js';

const DB = 'ponti-coda', MAGAZZINO = 'foto';

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

function transazione(modo, fn) {
  return apri().then(db => new Promise((ok, no) => {
    const t = db.transaction(MAGAZZINO, modo);
    const risultato = fn(t.objectStore(MAGAZZINO));
    t.oncomplete = () => ok(risultato && risultato.result !== undefined ? risultato.result : risultato);
    t.onerror = () => no(t.error);
  }));
}

export async function accoda(f) {
  f.id = f.id || crypto.randomUUID();
  f.creato_il = f.creato_il || new Date().toISOString();
  f.stato = 'attesa';
  f.errore = null;
  await transazione('readwrite', m => m.put(f));
  return f.id;
}

export const aggiorna = f => {
  f.modificato_il = new Date().toISOString();
  f.stato = 'attesa';
  f.errore = null;
  return transazione('readwrite', m => m.put(f));
};

export const tutte = () => transazione('readonly', m => m.getAll());
export const una = id => transazione('readonly', m => m.get(id));

const dalPercorso = id => `${id}.jpg`;

// Come la riga arriva nel database.
function riga(f) {
  return {
    id: f.id, ponte_id: f.ponte_id || null, categoria: f.categoria || null, nota: f.nota || null,
    lat: f.lat ?? null, lon: f.lon ?? null, precisione_m: f.precisione_m ?? null,
    scattata_il: f.scattata_il, path: dalPercorso(f.id), autore: f.autore || null, origine: 'app',
  };
}

export function spiega(e) {
  const t = String(e && e.message || e);
  if (/23503|foreign key/i.test(t)) return 'il ponte di questa foto non esiste più: aprila e scegli quello giusto';
  if (/401|403|JWT/i.test(t)) return 'accesso scaduto: esci e rientra';
  if (/Failed to fetch|NetworkError|Load failed/i.test(t)) return 'nessuna rete';
  return t.slice(0, 120);
}

async function invia(f) {
  if (!f.caricata) {
    if (!f.blob) throw new Error('foto non più sul telefono');
    await caricaFile('foto', dalPercorso(f.id), f.blob);
    if (f.miniatura) await caricaFile('foto', `thumb/${f.id}.jpg`, f.miniatura);
    f.caricata = true;
  }
  await scrivi('foto', riga(f), 'id');
  f.stato = 'inviata';
  f.inviata_il = new Date().toISOString();
  f.errore = null;
  delete f.blob;
  await transazione('readwrite', m => m.put(f));
}

let inCorso = false;
export async function sincronizza() {
  if (inCorso) return { inviati: 0, rimasti: -1 };
  inCorso = true;
  let inviati = 0, errore = null;
  try {
    for (const f of (await tutte()).filter(x => x.stato !== 'inviata').sort((a, b) => a.creato_il.localeCompare(b.creato_il))) {
      try { await invia(f); inviati++; }
      catch (e) {
        f.errore = spiega(e);
        await transazione('readwrite', m => m.put(f));
        errore = f.errore;
        if (/nessuna rete|accesso/.test(f.errore)) break;      // inutile insistere
      }
    }
  } finally { inCorso = false; }
  const rimasti = (await tutte()).filter(x => x.stato !== 'inviata').length;
  return { inviati, rimasti, errore };
}

export async function elimina(f) {
  if (f.stato === 'inviata' || f.caricata) {
    await cancella('foto', `id=eq.${f.id}`);
    await cancellaFile('foto', dalPercorso(f.id)).catch(() => {});
    await cancellaFile('foto', `thumb/${f.id}.jpg`).catch(() => {});
  }
  await transazione('readwrite', m => m.delete(f.id));
}
