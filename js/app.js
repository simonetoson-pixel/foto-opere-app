// Foto opere: la schermata del telefono.

import { vicini, affidabilita, distanzaLeggibile, metri } from './vicini.js';
import { accoda, aggiorna, elimina, sincronizza, tutte, una } from './coda.js';
import { autenticato, entra, esci } from './rete.js';
import { ponti as caricaPonti } from './dati.js';

const $ = id => document.getElementById(id);
const NOMI_TIPO = { giunti: 'Giunti', pavimentazioni: 'Pavimentazioni', strutture: 'Strutture' };

// Cambiarla insieme a CACHE in sw.js: e' il numero che l'app mostra in fondo.
const VERSIONE = 1;

let ponti = [];
let posizione = null;               // {lat, lon, precisione}
let proposta = null;                // l'opera piu vicina: {ponte, distanza, centro}
let scelto = null;                  // l'opera scelta a mano: {ponte, lat, lon}
let tipo = lettura('opere-tipo');   // giunti | pavimentazioni | strutture
let aggiornamentoPronto = false;
let apertaFoto = null;              // la foto che si sta rivedendo
let urlMiniature = [];

function lettura(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function scrittura(k, v) { try { localStorage.setItem(k, v); } catch { /* pazienza */ } }

const schermate = ['s-accesso', 's-scatto', 's-scelta', 's-foto'];
function mostra(id) {
  schermate.forEach(s => $(s).classList.toggle('attiva', s === id));
  if (id === 's-scatto') {
    $('s-scatto').scrollTop = 0;
    if (aggiornamentoPronto) location.reload();
  }
}

let timerAvviso;
function avvisa(testo, tipoAvviso = '') {
  const a = $('avviso');
  a.textContent = testo;
  a.className = `avviso visibile ${tipoAvviso}`;
  clearTimeout(timerAvviso);
  timerAvviso = setTimeout(() => a.classList.remove('visibile'), tipoAvviso === 'male' ? 6500 : 2600);
}

const dove = p => `${p.strada} · km ${p.km || '?'}${p.comune ? ' · ' + p.comune : ''}`;

// ---------------------------------------------------------------- GPS
function seguiPosizione() {
  if (!navigator.geolocation) { $('dove').textContent = 'GPS non disponibile'; return; }
  navigator.geolocation.watchPosition(
    p => {
      posizione = { lat: p.coords.latitude, lon: p.coords.longitude, precisione: p.coords.accuracy };
      aggiornaPosizione();
    },
    e => {
      $('posizione').className = 'posizione lontano';
      $('dove').textContent = 'Posizione non disponibile';
      $('opera-vicina').textContent = '';
      $('segnale').textContent = e.code === e.PERMISSION_DENIED
        ? 'permesso negato: l\'opera la scegli tu' : 'GPS assente: l\'opera la scegli tu';
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
}

function posizioneAdesso() {
  return new Promise(ok => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(
      p => ok({ lat: p.coords.latitude, lon: p.coords.longitude, precisione: p.coords.accuracy }),
      () => ok(null), { enableHighAccuracy: true, timeout: 6000, maximumAge: 10000 });
  });
}

// La scelta a mano vale finche' non ci si allontana: poi l'opera e' un'altra.
const RILASCIO_M = 250;

function aggiornaPosizione() {
  if (!posizione || !ponti.length) return;
  const v = vicini(ponti, posizione.lat, posizione.lon, 1);
  proposta = v[0] || null;
  if (scelto && metri(posizione.lat, posizione.lon, scelto.lat, scelto.lon) > RILASCIO_M) scelto = null;

  const fascia = $('posizione');
  const gps = `GPS ±${Math.round(posizione.precisione)} m`;
  $('b-torna-auto').hidden = !scelto;

  if (scelto) {
    fascia.className = 'posizione scelto';
    $('dove').textContent = scelto.ponte.nome;
    $('opera-vicina').textContent = dove(scelto.ponte);
    $('segnale').textContent = `scelto da te · ${gps}`;
    return;
  }
  if (!proposta) {
    fascia.className = 'posizione lontano';
    $('dove').textContent = 'Nessuna opera in zona';
    $('opera-vicina').textContent = '';
    $('segnale').textContent = `${gps} · l\'opera la scegli tu`;
    return;
  }
  if (affidabilita(proposta.distanza, posizione.precisione) === 'incerta') {
    fascia.className = 'posizione lontano';
    $('dove').textContent = 'Nessuna opera qui vicino';
    $('opera-vicina').textContent = `il più vicino a ${distanzaLeggibile(proposta.distanza)}: ${proposta.ponte.nome}`;
    $('segnale').textContent = `${gps} · puoi scattare, l\'opera la scegli dopo`;
    return;
  }
  fascia.className = 'posizione';
  $('dove').textContent = proposta.ponte.nome;
  $('opera-vicina').textContent = dove(proposta.ponte);
  $('segnale').textContent = `${proposta.distanza < 5 ? 'sull\'opera' : distanzaLeggibile(proposta.distanza)} · ${gps}`;
}

// L'opera a cui va la prossima foto: quello scelto, o il piu vicino se e' vicino davvero.
function ponteCorrente() {
  if (scelto) return scelto.ponte;
  if (proposta && posizione && affidabilita(proposta.distanza, posizione.precisione) !== 'incerta') return proposta.ponte;
  return null;
}

// ---------------------------------------------------------- scelta dell'opera
let alla = null;     // cosa fare con l'opera scelta
let centro = null;   // da dove si contano le distanze
let tornaA = 's-scatto';

function apriScelta(centroDistanze, perScelta, correnteId, ritorno = 's-scatto') {
  centro = centroDistanze;
  alla = perScelta;
  tornaA = ritorno;
  $('cerca-ponte').value = '';
  disegnaElenco(correnteId);
  mostra('s-scelta');
  setTimeout(() => $('cerca-ponte').focus(), 50);
}

function disegnaElenco(correnteId) {
  const q = $('cerca-ponte').value.trim().toLowerCase();
  let lista = ponti.map(p => ({ p, d: centro && p.lat != null ? Math.max(0, metri(centro.lat, centro.lon, p.lat, p.lon) - (p.raggio_m || 0)) : null }));
  if (q) {
    const parole = q.split(/\s+/);
    lista = lista.filter(({ p }) => {
      const t = `${p.nome} ${p.strada} ${p.km} ${p.comune || ''} ${p.tipologia || ''}`.toLowerCase();
      return parole.every(w => t.includes(w));
    });
  }
  lista.sort((a, b) => centro ? (a.d ?? 1e12) - (b.d ?? 1e12) : a.p.strada.localeCompare(b.p.strada) || (a.p.km_m || 0) - (b.p.km_m || 0));
  $('elenco-ponti').innerHTML = lista.slice(0, 80).map(({ p, d }) => `
    <button type="button" class="voce${p.id === correnteId ? ' corrente' : ''}" data-id="${p.id}">
      <b>${esc(p.nome)}</b>
      <small>${esc(dove(p))}${d != null ? ' · ' + distanzaLeggibile(d) : ''}</small>
    </button>`).join('') || '<p class="dettaglio">Nessuna opera con queste parole.</p>';
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- foto
function carica(file) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => no(new Error('foto non leggibile'));
    img.src = URL.createObjectURL(file);
  });
}

function ridimensiona(img, latoMax, qualita) {
  return new Promise(ok => {
    const scala = Math.min(1, latoMax / Math.max(img.width, img.height));
    const tela = document.createElement('canvas');
    tela.width = Math.round(img.width * scala);
    tela.height = Math.round(img.height * scala);
    tela.getContext('2d').drawImage(img, 0, 0, tela.width, tela.height);
    tela.toBlob(ok, 'image/jpeg', qualita);
  });
}

async function fotoScattata(file) {
  let img;
  try { img = await carica(file); } catch (e) { return avvisa('Non riesco a leggere la foto', 'male'); }
  const [grande, miniatura] = await Promise.all([ridimensiona(img, 1600, 0.82), ridimensiona(img, 480, 0.72)]);
  URL.revokeObjectURL(img.src);
  const pos = posizione || await posizioneAdesso();
  const p = ponteCorrente();
  await accoda({
    ponte_id: p ? p.id : null, categoria: tipo, nota: null,
    lat: pos ? pos.lat : null, lon: pos ? pos.lon : null, precisione_m: pos ? pos.precisione : null,
    scattata_il: new Date().toISOString(), blob: grande, miniatura,
  });
  avvisa(p ? `Salvata · ${p.nome}` : 'Salvata · opera da scegliere', p ? 'buono' : '');
  aggiornaCoda();
  provaSincronizzare();
}

// ------------------------------------------------------------- l'elenco
const nomeGiorno = d => {
  const k = x => x.toLocaleDateString('sv-SE');
  if (k(d) === k(new Date())) return 'Oggi';
  if (k(d) === k(new Date(Date.now() - 86400000))) return 'Ieri';
  return d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
};

const statoDi = f => f.stato === 'inviata' ? { t: '✓', c: '' }
  : f.errore ? { t: '⚠ bloccata', c: 'bloccata' } : { t: 'da inviare', c: 'attesa' };

async function aggiornaCoda() {
  const elenco = await tutte();
  const attesa = elenco.filter(f => f.stato !== 'inviata');
  const motivi = [...new Set(attesa.map(f => f.errore).filter(Boolean))];
  $('coda-testo').innerHTML = attesa.length
    ? `<b>${attesa.length}</b> ${attesa.length === 1 ? 'foto' : 'foto'} da inviare${motivi.map(m => `<small>${esc(m)}</small>`).join('')}`
    : 'Tutto sincronizzato';
  $('b-sincronizza').hidden = attesa.length === 0;

  urlMiniature.forEach(u => URL.revokeObjectURL(u));
  urlMiniature = [];
  const ordinate = elenco.sort((a, b) => (b.modificato_il || b.creato_il).localeCompare(a.modificato_il || a.creato_il)).slice(0, 150);
  let giorno = null, html = '';
  for (const f of ordinate) {
    const g = nomeGiorno(new Date(f.scattata_il));
    if (g !== giorno) { html += `<div class="giorno">${esc(g)}</div>`; giorno = g; }
    const p = ponti.find(x => x.id === f.ponte_id);
    const url = f.miniatura ? URL.createObjectURL(f.miniatura) : '';
    if (url) urlMiniature.push(url);
    const s = statoDi(f);
    html += `<button type="button" class="recente" data-id="${f.id}">
      <img src="${url}" alt="">
      <span class="testo"><b>${esc(p ? p.nome : 'Opera da scegliere')}</b>
        <small><span class="pallino ${f.categoria || ''}"></span>${esc(NOMI_TIPO[f.categoria] || 'Tipo non indicato')} · ${new Date(f.scattata_il).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</small></span>
      <span class="stato ${s.c}">${s.t}</span></button>`;
  }
  $('recenti').innerHTML = html;
}

async function provaSincronizzare() {
  if (!navigator.onLine || !autenticato()) return;
  const r = await sincronizza();
  await aggiornaCoda();
  if (r.inviati) avvisa(r.rimasti ? `Inviate ${r.inviati}, ne restano ${r.rimasti}` : `Inviate ${r.inviati}: tutto a posto`, 'buono');
}

// ---------------------------------------------------------- una foto, dopo
let modifica = null;

async function apriFoto(id) {
  const f = await una(id);
  if (!f) return;
  modifica = { ...f };
  apertaFoto = f;
  $('foto-img').src = f.blob ? URL.createObjectURL(f.blob) : (f.miniatura ? URL.createObjectURL(f.miniatura) : '');
  $('foto-nota').value = f.nota || '';
  $('foto-titolo').textContent = new Date(f.scattata_il).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  $('foto-dettaglio').textContent = (f.lat != null ? `Posizione ${f.lat.toFixed(5)}, ${f.lon.toFixed(5)} (±${Math.round(f.precisione_m || 0)} m)` : 'Senza posizione GPS')
    + (f.stato === 'inviata' ? ' · inviata' : ' · da inviare');
  disegnaFoto();
  mostra('s-foto');
  $('foto-corpo').scrollTop = 0;
}

function disegnaFoto() {
  const p = ponti.find(x => x.id === modifica.ponte_id);
  const b = $('b-foto-ponte');
  b.classList.toggle('manca', !p);
  b.innerHTML = p ? `<b>${esc(p.nome)}</b><small>${esc(dove(p))} · tocca per cambiare</small>`
    : '<b>Opera da scegliere</b><small>tocca per sceglierla</small>';
  document.querySelectorAll('#foto-tipi .tipo').forEach(t => t.classList.toggle('attivo', t.dataset.tipo === modifica.categoria));
}

async function salvaFoto() {
  modifica.nota = $('foto-nota').value.trim() || null;
  await aggiorna(modifica);
  mostra('s-scatto');
  avvisa('Modifiche salvate', 'buono');
  aggiornaCoda();
  provaSincronizzare();
}

async function eliminaFoto() {
  if (!confirm(modifica.stato === 'inviata'
    ? 'La foto è già stata inviata: cancellandola sparisce dall’archivio, per tutti. Procedo?'
    : 'Cancello la foto? Non è ancora partita, quindi va persa.')) return;
  try {
    await elimina(modifica);
    mostra('s-scatto');
    avvisa('Foto cancellata', 'buono');
    aggiornaCoda();
  } catch (e) { avvisa('Non riesco a cancellarla: ' + String(e.message || e).slice(0, 80), 'male'); }
}

// ---------------------------------------------------------------- avvio
function segnaTipo() {
  document.querySelectorAll('#tipi .tipo').forEach(t => {
    const a = t.dataset.tipo === tipo;
    t.classList.toggle('attivo', a);
    t.setAttribute('aria-checked', String(a));
  });
  $('suggerimento').innerHTML = tipo
    ? `Foto di <b>${NOMI_TIPO[tipo].toLowerCase()}</b>: un tocco per ogni foto.`
    : 'Scegli cosa stai fotografando,<br>poi un tocco per ogni foto.';
}

function collega() {
  $('tipi').addEventListener('click', e => {
    const b = e.target.closest('.tipo');
    if (!b) return;
    tipo = b.dataset.tipo;
    scrittura('opere-tipo', tipo);
    segnaTipo();
  });

  $('b-scatta').addEventListener('click', () => {
    if (!tipo) {
      $('tipi').classList.remove('da-scegliere'); void $('tipi').offsetWidth; $('tipi').classList.add('da-scegliere');
      setTimeout(() => $('tipi').classList.remove('da-scegliere'), 1500);
      return avvisa('Scegli prima: giunti, pavimentazioni o strutture');
    }
    $('file-foto').click();
  });
  $('file-foto').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) fotoScattata(file);
  });

  $('b-cambia-ponte').addEventListener('click', () => apriScelta(
    posizione, p => { scelto = posizione ? { ponte: p, lat: posizione.lat, lon: posizione.lon } : { ponte: p, lat: p.lat, lon: p.lon }; aggiornaPosizione(); },
    ponteCorrente() && ponteCorrente().id));
  $('b-torna-auto').addEventListener('click', () => { scelto = null; aggiornaPosizione(); });
  $('b-scelta-chiudi').addEventListener('click', () => mostra(tornaA));
  $('cerca-ponte').addEventListener('input', () => disegnaElenco());
  $('elenco-ponti').addEventListener('click', e => {
    const b = e.target.closest('.voce');
    if (!b) return;
    const p = ponti.find(x => x.id === b.dataset.id);
    const fn = alla;
    mostra(tornaA);
    if (fn) fn(p);
  });

  $('recenti').addEventListener('click', e => {
    const b = e.target.closest('.recente');
    if (b) apriFoto(b.dataset.id);
  });
  $('b-foto-chiudi').addEventListener('click', () => mostra('s-scatto'));
  $('foto-tipi').addEventListener('click', e => {
    const b = e.target.closest('.tipo');
    if (b) { modifica.categoria = b.dataset.tipo; disegnaFoto(); }
  });
  $('b-foto-ponte').addEventListener('click', () => {
    apriScelta(modifica.lat != null ? { lat: modifica.lat, lon: modifica.lon } : posizione,
      p => { modifica.ponte_id = p.id; disegnaFoto(); }, modifica.ponte_id, 's-foto');
  });
  $('b-foto-salva').addEventListener('click', salvaFoto);
  $('b-foto-elimina').addEventListener('click', eliminaFoto);

  $('b-sincronizza').addEventListener('click', provaSincronizzare);
  window.addEventListener('online', provaSincronizzare);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) provaSincronizzare(); });
  setInterval(provaSincronizzare, 60000);
  segnaTipo();
}

async function apriApp() {
  mostra('s-scatto');
  aggiornaCoda();
  try {
    ponti = await caricaPonti({ onAggiornato: fresche => { ponti = fresche; aggiornaPosizione(); aggiornaCoda(); } });
  } catch (e) {
    avvisa('Non riesco a leggere le opere: ' + String(e.message || e).slice(0, 80), 'male');
    return;
  }
  aggiornaCoda();
  seguiPosizione();
  provaSincronizzare();
}

async function accedi(e) {
  e.preventDefault();
  const err = $('errore-accesso');
  err.hidden = true;
  $('b-entra').disabled = true;
  try {
    await entra($('email').value.trim(), $('password').value);
    await apriApp();
  } catch (x) {
    err.textContent = String(x.message || x);
    err.hidden = false;
  } finally { $('b-entra').disabled = false; }
}

async function avvia() {
  $('modulo-accesso').addEventListener('submit', accedi);
  collega();
  $('b-esci').addEventListener('click', async () => {
    const rimasti = (await tutte()).filter(f => f.stato !== 'inviata').length;
    if (rimasti && !confirm(`Ci sono ${rimasti} foto non ancora inviate. Uscendo restano sul telefono ma non partiranno finché non rientri. Esci lo stesso?`)) return;
    esci();
    mostra('s-accesso');
  });
  if (autenticato()) await apriApp(); else mostra('s-accesso');
  $('versione').textContent = `versione ${VERSIONE}`;

  if ('serviceWorker' in navigator) {
    const avevaControllo = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!avevaControllo) return;
      aggiornamentoPronto = true;
      if ($('s-scatto').classList.contains('attiva') || $('s-accesso').classList.contains('attiva')) location.reload();
    });
    navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {});
  }
}

avvia();
