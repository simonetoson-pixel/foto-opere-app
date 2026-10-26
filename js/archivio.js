// Foto opere — archivio sul computer: la mappa delle opere, le foto per opera, il resto.

import { autenticato, entra, esci, emailUtente } from './rete.js';
import {
  dati, carica, fotoDi, ponteDi, indirizzi, indirizzo, miniatura, cambia, togli, ricostruisci, TIPI, COLORE_TIPO,
} from './dati-archivio.js';
import { apriVisore, nomeFile } from './visore.js';
import { preparaFoto, caricaUna } from './foto-pc.js';
import { vicini } from './vicini.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SENZA = 'senza-opera';

const filtri = { strada: '', tipi: new Set(['giunti', 'pavimentazioni', 'strutture', 'altro', 'nessuna']), cerca: '', solo: false, foto: false };
let aperto = null;                  // id dell'opera aperta, o SENZA
const scelte = new Set();           // id delle foto selezionate
let mappa, marcatori = new Map(), gruppoFoto = null;

let timerMsg;
function msg(testo) {
  const m = $('messaggio');
  m.textContent = testo; m.classList.add('visibile');
  clearTimeout(timerMsg);
  timerMsg = setTimeout(() => m.classList.remove('visibile'), 3200);
}

const chiave = f => f.categoria || 'nessuna';
const passa = f => filtri.tipi.has(chiave(f));
const fotoDel = id => (id === SENZA ? dati.senzaPonte : fotoDi(id)).filter(passa);

function ponteVisibile(p) {
  if (filtri.strada && p.strada !== filtri.strada) return false;
  if (filtri.cerca) {
    const t = `${p.nome} ${p.strada} ${p.km} ${p.comune || ''} ${p.tipologia || ''}`.toLowerCase();
    if (!filtri.cerca.toLowerCase().split(/\s+/).every(w => t.includes(w))) return false;
  }
  if (filtri.solo && !fotoDel(p.id).length) return false;
  return true;
}

// ------------------------------------------------------------------ mappa
function preparaMappa() {
  mappa = L.map('mappa').setView([45.45, 11.2], 9);
  const esri = s => L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`,
    { maxZoom: 19, attribution: 'Tiles &copy; Esri' });
  const veneto = L.tileLayer.wms('https://idt2-geoserver.regione.veneto.it/geoserver/wms',
    { layers: 'rv:ortofoto_agea_2024', format: 'image/jpeg', version: '1.3.0', maxZoom: 21,
      attribution: 'Ortofoto AGEA 2024 &mdash; Regione del Veneto' });
  const satellite = esri('World_Imagery');
  satellite.addTo(mappa);
  L.control.layers({ 'Satellite': satellite, 'Ortofoto Veneto 2024': veneto, 'Stradale': esri('World_Street_Map') }, null,
    { position: 'topright' }).addTo(mappa);

  for (const p of dati.ponti) {
    if (p.lat == null) continue;
    const m = L.circleMarker([p.lat, p.lon], { radius: 6, weight: 2, color: '#fff', fillOpacity: .95, fillColor: '#8A9490' });
    m.bindTooltip(() => `<b>${esc(p.nome)}</b><br>${esc(p.strada)} · km ${esc(p.km)}<br>${fotoDel(p.id).length} foto`, { direction: 'top' });
    m.on('click', () => apriPonte(p.id, false));
    marcatori.set(p.id, m);
  }
  gruppoFoto = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false });
  aggiornaMappa();
}

function aggiornaMappa() {
  for (const p of dati.ponti) {
    const m = marcatori.get(p.id);
    if (!m) continue;
    const n = fotoDel(p.id).length;
    if (ponteVisibile(p)) {
      if (!mappa.hasLayer(m)) m.addTo(mappa);
      m.setStyle({
        radius: n ? 7 + Math.min(9, Math.sqrt(n)) : 5,
        fillColor: n ? '#1F5F55' : '#8A9490',
        color: p.id === aperto ? '#F5B73B' : '#fff', weight: p.id === aperto ? 4 : 2,
      });
      if (p.id === aperto) m.bringToFront();
    } else if (mappa.hasLayer(m)) mappa.removeLayer(m);
  }
  gruppoFoto.clearLayers();
  if (filtri.foto) {
    for (const f of dati.foto) {
      if (f.lat == null || !passa(f)) continue;
      const p = ponteDi(f.ponte_id);
      if (p && !ponteVisibile(p)) continue;
      const m = L.circleMarker([f.lat, f.lon], { radius: 5, weight: 1.5, color: '#fff', fillOpacity: 1, fillColor: COLORE_TIPO[chiave(f)] });
      m.bindTooltip(`${p ? esc(p.nome) : 'senza opera'}<br>${f.scattata_il ? new Date(f.scattata_il).toLocaleDateString('it-IT') : ''}`);
      m.on('click', () => apriVisore({ elenco: [f], indice: 0, dopo: ridisegna }));
      gruppoFoto.addLayer(m);
    }
    if (!mappa.hasLayer(gruppoFoto)) mappa.addLayer(gruppoFoto);
  } else if (mappa.hasLayer(gruppoFoto)) mappa.removeLayer(gruppoFoto);
}

// ------------------------------------------------------------------ elenco
function disegnaElenco() {
  const visibili = dati.ponti.filter(ponteVisibile);
  let html = '';
  if (dati.senzaPonte.length && !filtri.cerca) {
    html += `<button type="button" class="riga-ponte speciale${aperto === SENZA ? ' attivo' : ''}" data-id="${SENZA}">
      <span class="nome"><b>Foto senza opera</b><small>da assegnare a un\'opera</small></span><span class="n">${dati.senzaPonte.filter(passa).length}</span></button>`;
  }
  let strada = null;
  for (const p of visibili) {
    if (p.strada !== strada) { html += `<div class="gruppo-strada">${esc(p.strada)}</div>`; strada = p.strada; }
    const n = fotoDel(p.id).length;
    html += `<button type="button" class="riga-ponte${p.id === aperto ? ' attivo' : ''}" data-id="${esc(p.id)}">
      <span class="nome"><b>${esc(p.nome)}</b><small>km ${esc(p.km)}${p.comune ? ' · ' + esc(p.comune) : ''}</small></span>
      <span class="n${n ? '' : ' zero'}">${n}</span></button>`;
  }
  $('elenco').innerHTML = html || '<p class="p-vuoto">Nessuna opera con questi filtri.</p>';
  const con = visibili.filter(p => fotoDel(p.id).length).length;
  $('conta').textContent = `${visibili.length} opere, ${con} con foto · ${dati.foto.length} foto in tutto`;
}

// ------------------------------------------------------------------ pannello
function apriPonte(id, vola = true) {
  aperto = id;
  scelte.clear();
  const p = ponteDi(id);
  if (p && p.lat != null && vola) mappa.flyTo([p.lat, p.lon], Math.max(mappa.getZoom(), 15), { duration: .6 });
  ridisegna();
  $('pannello').scrollTop = 0;
}

function chiudiPannello() {
  aperto = null; scelte.clear();
  $('pannello').hidden = true;
  setTimeout(() => mappa.invalidateSize(), 0);
  ridisegna();
}

function ridisegna() {
  disegnaElenco();
  aggiornaMappa();
  if (aperto) disegnaPannello();
}

const giornoDi = f => (f.scattata_il || f.creato_il || '').slice(0, 10);

function disegnaPannello() {
  const pan = $('pannello');
  const p = aperto === SENZA ? null : ponteDi(aperto);
  const tutte = (aperto === SENZA ? dati.senzaPonte : fotoDi(aperto));
  const foto = tutte.filter(passa);
  const perTipo = k => tutte.filter(f => chiave(f) === k).length;
  const dettaglio = Object.entries(TIPI).filter(([k]) => perTipo(k)).map(([k, n]) => `${perTipo(k)} ${n.toLowerCase()}`)
    .concat(perTipo('nessuna') ? [`${perTipo('nessuna')} senza tipo`] : []).join(' · ');

  let html = `<div class="p-testa">
    <button class="p-chiudi" type="button" id="p-chiudi" aria-label="Chiudi">&times;</button>
    <h2>${p ? esc(p.nome) : 'Foto senza opera'}</h2>
    <div class="sotto">${p ? `${esc(p.strada)} · km ${esc(p.km)}${p.comune ? ' · ' + esc(p.comune) : ''}${p.tipologia ? ' · ' + esc(p.tipologia) : ''}` : 'foto non ancora assegnate a un\'opera'}</div>
    <div class="sotto">${tutte.length ? `${tutte.length} foto${dettaglio ? ': ' + dettaglio : ''}` : 'nessuna foto'}</div>
    <div class="p-azioni">
      <button type="button" id="p-zip"${foto.length ? '' : ' disabled'}>&#8681; Scarica tutte (ZIP)</button>
      <button type="button" id="p-aggiungi">&#43; Aggiungi foto</button>
      <button type="button" id="p-tutte"${foto.length ? '' : ' disabled'}>Seleziona tutte</button>
    </div></div>`;
  if (scelte.size) {
    html += `<div class="barra-selezione"><b>${scelte.size}</b> selezionate
      <select id="s-tipo"><option value="">Tipo…</option>${Object.entries(TIPI).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}<option value="-">Non indicato</option></select>
      <input id="s-ponte" list="elenco-datalist" placeholder="Sposta in un\'altra opera…" style="font:inherit;font-size:12.5px;padding:5px;border-radius:7px;border:1px solid #ccc;width:200px">
      <button type="button" id="s-zip">Scarica</button><button type="button" id="s-elimina">Elimina</button><button type="button" id="s-annulla">Annulla</button></div>`;
  }
  if (!foto.length) html += `<p class="p-vuoto">${tutte.length ? 'Nessuna foto con i filtri scelti.' : 'Ancora nessuna foto per quest\'opera.<br>Si aggiungono dal telefono o con «Aggiungi foto».'}</p>`;
  const perGiorno = new Map();
  for (const f of foto) { const g = giornoDi(f); if (!perGiorno.has(g)) perGiorno.set(g, []); perGiorno.get(g).push(f); }
  for (const [g, lista] of perGiorno) {
    html += `<div class="p-giorno">${g ? new Date(g + 'T12:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'senza data'} · ${lista.length}</div><div class="griglia">`;
    for (const f of lista) {
      html += `<div class="mini${scelte.has(f.id) ? ' scelta' : ''}" data-id="${f.id}" title="${esc(TIPI[f.categoria] || 'tipo non indicato')}${f.nota ? ' — ' + esc(f.nota) : ''}">
        <img data-path="${esc(miniatura(f))}" alt="">
        <input type="checkbox" class="spunta"${scelte.has(f.id) ? ' checked' : ''} aria-label="Seleziona">
        <span class="tipo-p" style="background:${COLORE_TIPO[chiave(f)]}"></span></div>`;
    }
    html += '</div>';
  }
  pan.hidden = false;
  const alto = pan.scrollTop;
  pan.innerHTML = html;
  pan.scrollTop = alto;
  setTimeout(() => mappa.invalidateSize(), 0);

  const imgs = [...pan.querySelectorAll('img[data-path]')];
  indirizzi(imgs.map(i => i.dataset.path)).then(m => imgs.forEach(i => { if (m[i.dataset.path]) i.src = m[i.dataset.path]; }));
}

function collegaPannello() {
  const pan = $('pannello');
  pan.addEventListener('click', async e => {
    const id = e.target.id;
    const foto = (aperto === SENZA ? dati.senzaPonte : fotoDi(aperto)).filter(passa);
    if (id === 'p-chiudi') return chiudiPannello();
    if (id === 'p-tutte') { foto.forEach(f => scelte.add(f.id)); return disegnaPannello(); }
    if (id === 'p-aggiungi') return dialogoAggiungi();
    if (id === 'p-zip') return scaricaZip(foto, aperto === SENZA ? 'foto-senza-opera' : ponteDi(aperto).nome);
    if (id === 's-annulla') { scelte.clear(); return disegnaPannello(); }
    if (id === 's-zip') return scaricaZip(foto.filter(f => scelte.has(f.id)), 'foto-selezionate');
    if (id === 's-elimina') {
      if (!confirm(`Cancello ${scelte.size} foto dall’archivio? Non si può annullare.`)) return;
      let fatte = 0;
      for (const f of foto.filter(x => scelte.has(x.id))) { try { await togli(f); fatte++; } catch { /* resta */ } }
      scelte.clear(); msg(`${fatte} foto cancellate`); return ridisegna();
    }
    const mini = e.target.closest('.mini');
    if (!mini) return;
    if (e.target.classList.contains('spunta')) {
      e.target.checked ? scelte.add(mini.dataset.id) : scelte.delete(mini.dataset.id);
      return disegnaPannello();
    }
    apriVisore({ elenco: foto, indice: foto.findIndex(f => f.id === mini.dataset.id), dopo: ridisegna });
  });
  pan.addEventListener('change', async e => {
    const foto = (aperto === SENZA ? dati.senzaPonte : fotoDi(aperto)).filter(x => scelte.has(x.id));
    if (e.target.id === 's-tipo' && e.target.value) {
      const categoria = e.target.value === '-' ? null : e.target.value;
      for (const f of foto) await cambia(f, { categoria });
      msg(`${foto.length} foto: tipo cambiato`); scelte.clear(); return ridisegna();
    }
    if (e.target.id === 's-ponte') {
      const p = dati.ponti.find(x => `${x.nome} — ${x.strada} km ${x.km}` === e.target.value);
      if (!p) return msg('Scegli un\'opera dall’elenco');
      for (const f of foto) await cambia(f, { ponte_id: p.id });
      ricostruisci(); msg(`${foto.length} foto spostate in ${p.nome}`); scelte.clear(); return ridisegna();
    }
  });
}

// ------------------------------------------------------------------ scarico
async function scaricaZip(foto, nome) {
  if (!foto.length) return;
  if (typeof JSZip === 'undefined') return msg('Il programma per gli ZIP non si è caricato: riprova con la rete attiva');
  const z = new JSZip();
  for (let k = 0; k < foto.length; k++) {
    msg(`Preparo lo ZIP… ${k + 1} di ${foto.length}`);
    const f = foto[k];
    try {
      const r = await fetch(await indirizzo(f.path));
      if (!r.ok) throw new Error(r.status);
      z.file(`${f.categoria ? TIPI[f.categoria] : 'Tipo non indicato'}/${nomeFile(f).replace(/\.jpg$/, '')}_${k + 1}.jpg`, await r.blob());
    } catch { msg(`Non riesco a scaricare la foto ${k + 1}`); }
  }
  const blob = await z.generateAsync({ type: 'blob', compression: 'STORE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${nome.replace(/[^\w.-]+/g, '-')}.zip`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  msg(`ZIP pronto: ${foto.length} foto`);
}

// ------------------------------------------------------------------ aggiungere foto
function dialogoAggiungi() {
  const sel = document.createElement('input');
  sel.type = 'file'; sel.multiple = true; sel.accept = 'image/*';
  sel.onchange = async () => { if (sel.files.length) dialogoCarico(await preparaFoto([...sel.files])); };
  sel.click();
}

function dialogoCarico(lista) {
  if (!lista.length) return msg('Nessuna foto riconosciuta');
  const p0 = aperto && aperto !== SENZA ? ponteDi(aperto) : null;
  const conGps = lista.filter(x => x.lat != null).length;
  const d1 = lista[0].data.toLocaleDateString('it-IT'), d2 = lista[lista.length - 1].data.toLocaleDateString('it-IT');
  const v = document.createElement('div');
  v.className = 'velo';
  v.innerHTML = `<div class="dialogo"><h3>Aggiungi ${lista.length} foto</h3>
    <div class="rias">${d1 === d2 ? d1 : `dal ${d1} al ${d2}`} · ${conGps} con posizione GPS · ${lista.filter(x => x.exif).length} con data di scatto</div>
    <label>Opera (se la lasci vuota la cerco dalla posizione della foto)</label>
    <input id="d-ponte" list="elenco-datalist" value="${p0 ? esc(`${p0.nome} — ${p0.strada} km ${p0.km}`) : ''}" placeholder="Scrivi il nome dell\'opera…">
    <label>Cosa mostrano</label>
    <select id="d-tipo"><option value="">Non indicato</option>${Object.entries(TIPI).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select>
    <label>Nota (facoltativa, uguale per tutte)</label><textarea id="d-nota" rows="2"></textarea>
    <div class="esito" id="d-esito"></div>
    <div class="az"><button type="button" id="d-annulla">Annulla</button><button type="button" class="ok" id="d-carica">Carica</button></div></div>`;
  document.body.appendChild(v);
  const q = s => v.querySelector(s);
  q('#d-annulla').onclick = () => v.remove();
  q('#d-carica').onclick = async () => {
    const testo = q('#d-ponte').value.trim();
    const scelto = testo ? dati.ponti.find(x => `${x.nome} — ${x.strada} km ${x.km}` === testo) : null;
    if (testo && !scelto) return (q('#d-esito').textContent = 'Scegli un\'opera dall’elenco, o lascia il campo vuoto.');
    q('#d-carica').disabled = true; q('#d-annulla').disabled = true;
    let ok = 0, errori = 0;
    for (const foto of lista) {
      q('#d-esito').textContent = `Carico ${ok + errori + 1} di ${lista.length}…`;
      let ponte = scelto;
      if (!ponte && foto.lat != null) { const c = vicini(dati.ponti, foto.lat, foto.lon, 1)[0]; if (c && c.distanza <= 60) ponte = c.ponte; }
      try {
        await caricaUna({ foto, ponte_id: ponte && ponte.id, categoria: q('#d-tipo').value, nota: q('#d-nota').value.trim(), autore: emailUtente() });
        ok++;
      } catch (e) { errori++; q('#d-esito').textContent = 'Errore: ' + String(e.message || e).slice(0, 100); }
    }
    await carica();
    v.remove();
    msg(errori ? `${ok} foto caricate, ${errori} no` : `${ok} foto caricate`);
    ridisegna();
  };
}

// ------------------------------------------------------------------ avvio
function collegaFiltri() {
  const strade = [...new Set(dati.ponti.map(p => p.strada))];
  $('f-strada').innerHTML += strade.map(s => `<option>${esc(s)}</option>`).join('');
  $('f-strada').onchange = e => { filtri.strada = e.target.value; ridisegna(); };
  $('f-tipi').onchange = e => { e.target.checked ? filtri.tipi.add(e.target.dataset.tipo) : filtri.tipi.delete(e.target.dataset.tipo); ridisegna(); };
  $('f-solo').onchange = e => { filtri.solo = e.target.checked; ridisegna(); };
  $('f-foto').onchange = e => { filtri.foto = e.target.checked; aggiornaMappa(); };
  $('cerca').oninput = e => { filtri.cerca = e.target.value.trim(); ridisegna(); };
  $('elenco').onclick = e => { const b = e.target.closest('.riga-ponte'); if (b) apriPonte(b.dataset.id); };
  $('b-aggiungi').onclick = dialogoAggiungi;
  collegaPannello();
}

async function apri() {
  $('s-accesso').classList.remove('attiva');
  $('s-archivio').classList.add('attiva');
  $('sottotitolo').textContent = 'carico i dati…';
  try { await carica(); } catch (e) {
    $('sottotitolo').textContent = 'errore: ' + String(e.message || e).slice(0, 80);
    return;
  }
  $('sottotitolo').textContent = emailUtente() || 'archivio';
  const lista = document.createElement('datalist');
  lista.id = 'elenco-datalist';
  lista.innerHTML = dati.ponti.map(x => `<option value="${esc(x.nome)} — ${esc(x.strada)} km ${esc(x.km)}"></option>`).join('');
  document.body.appendChild(lista);
  preparaMappa();
  collegaFiltri();
  disegnaElenco();
  const conGps = dati.ponti.filter(p => p.lat != null);
  if (conGps.length) mappa.fitBounds(L.latLngBounds(conGps.map(p => [p.lat, p.lon])), { padding: [30, 30] });
}

async function accedi(e) {
  e.preventDefault();
  const err = $('errore-accesso');
  err.hidden = true; $('b-entra').disabled = true;
  try { await entra($('email').value.trim(), $('password').value); await apri(); }
  catch (x) { err.textContent = String(x.message || x); err.hidden = false; }
  finally { $('b-entra').disabled = false; }
}

$('modulo-accesso').addEventListener('submit', accedi);
$('b-esci').addEventListener('click', () => { esci(); location.reload(); });
if (autenticato()) apri();
