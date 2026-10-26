// Foto fatte fuori dall'app, caricate dal computer: la data e la posizione si
// leggono dalla foto (EXIF), e le foto si rimpiccioliscono come quelle del telefono.

import { caricaFile, scrivi } from './rete.js';

// ---- EXIF: data di scatto e posizione, dai primi byte di un JPEG
export async function leggiExif(file) {
  const r = { data: null, lat: null, lon: null };
  try {
    const d = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (d.getUint16(0) !== 0xFFD8) return r;
    let o = 2;
    while (o < d.byteLength - 4) {
      const marcatore = d.getUint16(o), lun = d.getUint16(o + 2);
      if (marcatore === 0xFFE1 && d.getUint32(o + 4) === 0x45786966) {
        const t = o + 10, pic = d.getUint16(t) === 0x4949;
        const u16 = x => d.getUint16(x, pic), u32 = x => d.getUint32(x, pic);
        const cerca = (ifd, et) => {
          const n = u16(ifd);
          for (let k = 0; k < n; k++) if (u16(ifd + 2 + k * 12) === et) return ifd + 2 + k * 12;
          return null;
        };
        const testo = (x, n) => { let s = ''; for (let k = 0; k < n; k++) { const c = d.getUint8(x + k); if (!c) break; s += String.fromCharCode(c); } return s; };
        const posto = voce => (u32(voce + 4) * ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }[u16(voce + 2)] || 1) > 4) ? t + u32(voce + 8) : voce + 8;
        const ifd0 = t + u32(t + 4);
        const exif = cerca(ifd0, 0x8769);
        if (exif !== null) {
          const ifdE = t + u32(exif + 8);
          for (const et of [0x9003, 0x9004]) {
            const v = cerca(ifdE, et);
            if (v === null) continue;
            const m = testo(posto(v), u32(v + 4)).match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
            if (m) { r.data = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]); break; }
          }
        }
        const gps = cerca(ifd0, 0x8825);
        if (gps !== null) {
          const ifdG = t + u32(gps + 8);
          const razionali = voce => { const p = posto(voce); return [0, 1, 2].map(i => u32(p + i * 8) / (u32(p + i * 8 + 4) || 1)); };
          const gr = (v, rif) => { const [g, m, s] = razionali(v); const x = g + m / 60 + s / 3600; return rif === 'S' || rif === 'W' ? -x : x; };
          const vLat = cerca(ifdG, 2), vLon = cerca(ifdG, 4), rLat = cerca(ifdG, 1), rLon = cerca(ifdG, 3);
          if (vLat !== null && vLon !== null) {
            const rif = v => v === null ? '' : String.fromCharCode(d.getUint8(v + 8));
            r.lat = gr(vLat, rif(rLat));
            r.lon = gr(vLon, rif(rLon));
          }
        }
        return r;
      }
      if ((marcatore & 0xFF00) !== 0xFF00) break;
      o += 2 + lun;
    }
  } catch { /* metadati assenti o rovinati: si usa la data del file */ }
  return r;
}

function ridimensiona(img, lato, qualita) {
  return new Promise(ok => {
    const s = Math.min(1, lato / Math.max(img.width, img.height));
    const t = document.createElement('canvas');
    t.width = Math.round(img.width * s); t.height = Math.round(img.height * s);
    t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
    t.toBlob(ok, 'image/jpeg', qualita);
  });
}

function apri(file) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error(`${file.name}: non e' una foto che il browser sa aprire`));
    img.src = URL.createObjectURL(file);
  });
}

export async function preparaFoto(files) {
  const lista = [];
  for (const file of files) {
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) continue;
    const e = await leggiExif(file);
    lista.push({ file, data: e.data || new Date(file.lastModified || Date.now()), exif: !!e.data, lat: e.lat, lon: e.lon });
  }
  return lista.sort((a, b) => a.data - b.data);
}

// Carica una foto. Ripetibile: stesso codice, file e riga si sovrascrivono.
export async function caricaUna({ foto, ponte_id, categoria, nota, autore, id }) {
  id = id || crypto.randomUUID();
  const img = await apri(foto.file);
  const [grande, piccola] = await Promise.all([ridimensiona(img, 1600, 0.82), ridimensiona(img, 480, 0.72)]);
  URL.revokeObjectURL(img.src);
  await caricaFile('foto', `${id}.jpg`, grande);
  await caricaFile('foto', `thumb/${id}.jpg`, piccola);
  return await scrivi('foto', {
    id, ponte_id: ponte_id || null, categoria: categoria || null, nota: nota || null,
    lat: foto.lat ?? null, lon: foto.lon ?? null, precisione_m: null,
    scattata_il: foto.data.toISOString(), path: `${id}.jpg`, autore: autore || null, origine: 'archivio',
  }, 'id');
}
