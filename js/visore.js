// La foto a schermo intero: zoom, spostamento, scarico, e le modifiche (opera, tipo, nota).
//
// Zoom: rotellina o pizzico del trackpad (con il puntatore come centro), doppio clic,
// pulsanti, tasti + - 0. Trascinando si sposta la foto quando e' ingrandita.

import { dati, TIPI, COLORE_TIPO, ponteDi, indirizzo, cambia, togli } from './dati-archivio.js';

const ZOOM_MAX = 10;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function nomeFile(f) {
  const p = ponteDi(f.ponte_id);
  const data = (f.scattata_il || f.creato_il || '').slice(0, 10);
  const n = (f.path.match(/([0-9a-f]{6})/i) || [])[1] || '';
  return [p ? p.nome : 'senza-opera', f.categoria || 'tipo-nd', data, n].join('_').replace(/[^\w.-]+/g, '-') + '.jpg';
}

export async function scaricaFoto(f) {
  const r = await fetch(await indirizzo(f.path));
  if (!r.ok) throw new Error(r.status);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement('a');
  a.href = url; a.download = nomeFile(f);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function apriVisore({ elenco, indice, dopo }) {
  let i = Math.max(0, indice);
  let sc = 1, tx = 0, ty = 0;

  const v = document.createElement('div');
  v.className = 'visore';
  v.innerHTML = `
    <div class="tela"><img alt="" draggable="false"></div>
    <button class="v-chiudi" type="button" aria-label="Chiudi">&times;</button>
    <button class="v-prec" type="button" aria-label="Precedente">&lsaquo;</button>
    <button class="v-succ" type="button" aria-label="Successiva">&rsaquo;</button>
    <div class="v-zoom">
      <button type="button" data-z="meno">&minus;</button><span class="v-livello">adatta</span>
      <button type="button" data-z="piu">+</button><button type="button" data-z="adatta">Adatta</button>
      <button type="button" data-z="cento">100%</button>
    </div>
    <aside class="v-info">
      <div class="v-conta"></div>
      <label>Opera<input class="v-ponte" list="v-ponti" placeholder="Cerca un\'opera…" autocomplete="off"></label>
      <datalist id="v-ponti">${dati.ponti.map(p => `<option value="${esc(p.nome)} — ${esc(p.strada)} km ${esc(p.km)}" data-id="${esc(p.id)}"></option>`).join('')}</datalist>
      <div class="v-tipi">${Object.entries(TIPI).map(([k, n]) => `<button type="button" data-tipo="${k}">${n}</button>`).join('')}</div>
      <label>Nota<textarea class="v-nota" rows="3" placeholder="Nota (facoltativa)"></textarea></label>
      <p class="v-dati"></p>
      <div class="v-azioni"><button type="button" class="v-scarica">&#8681; Scarica</button><button type="button" class="v-elimina">Elimina</button></div>
      <p class="v-esito" aria-live="polite"></p>
    </aside>`;
  document.body.appendChild(v);
  const q = s => v.querySelector(s);
  const img = q('img'), liv = q('.v-livello');
  const esito = t => { q('.v-esito').textContent = t || ''; };

  const centro = () => { const r = q('.tela').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; };
  function applica() {
    const [, , vw, vh] = centro();
    const mx = Math.max(0, (img.offsetWidth * sc - vw) / 2), my = Math.max(0, (img.offsetHeight * sc - vh) / 2);
    tx = Math.min(mx, Math.max(-mx, tx)); ty = Math.min(my, Math.max(-my, ty));
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${sc})`;
    v.classList.toggle('ingrandita', sc > 1.001);
    liv.textContent = sc <= 1.001 ? 'adatta' : `${Math.round(sc * 100)}%`;
  }
  function zoomA(nuovo, cx, cy) {
    nuovo = Math.min(ZOOM_MAX, Math.max(1, nuovo));
    const [ox, oy] = centro(), px = (cx ?? ox) - ox, py = (cy ?? oy) - oy, k = nuovo / sc;
    tx = px - k * (px - tx); ty = py - k * (py - ty); sc = nuovo;
    if (sc <= 1.001) { sc = 1; tx = ty = 0; }
    applica();
  }
  const adatta = () => { sc = 1; tx = ty = 0; applica(); };

  function mostra() {
    const f = elenco[i];
    adatta();
    img.removeAttribute('src');
    indirizzo(f.path).then(u => { if (elenco[i] === f && u) img.src = u; });
    campi();
  }
  function campi() {
    const f = elenco[i];
    q('.v-conta').textContent = `${i + 1} di ${elenco.length}`;
    const p = ponteDi(f.ponte_id);
    q('.v-ponte').value = p ? `${p.nome} — ${p.strada} km ${p.km}` : '';
    q('.v-nota').value = f.nota || '';
    v.querySelectorAll('.v-tipi button').forEach(b => {
      const a = b.dataset.tipo === f.categoria;
      b.classList.toggle('attivo', a);
      b.style.background = a ? COLORE_TIPO[b.dataset.tipo] : '';
    });
    const quando = f.scattata_il ? new Date(f.scattata_il).toLocaleString('it-IT', { dateStyle: 'long', timeStyle: 'short' }) : 'data non nota';
    q('.v-dati').innerHTML = `${esc(quando)}<br>${f.lat != null ? `<a href="https://www.google.com/maps?q=${f.lat},${f.lon}" target="_blank" rel="noopener">${f.lat.toFixed(5)}, ${f.lon.toFixed(5)}</a>` : 'senza posizione GPS'}`
      + `<br>${f.origine === 'app' ? 'scattata con l’app' : 'caricata dall’archivio'}`;
    esito('');
  }
  const vai = d => { i = (i + d + elenco.length) % elenco.length; mostra(); };
  const chiudi = () => { document.removeEventListener('keydown', tasti); v.remove(); if (dopo) dopo(); };

  q('.v-prec').onclick = e => { e.stopPropagation(); vai(-1); };
  q('.v-succ').onclick = e => { e.stopPropagation(); vai(1); };
  q('.v-chiudi').onclick = chiudi;
  q('.tela').addEventListener('click', e => { if (e.target === q('.tela') && sc === 1) chiudi(); });
  q('.v-zoom').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const z = b.dataset.z;
    if (z === 'piu') zoomA(sc * 1.5); else if (z === 'meno') zoomA(sc / 1.5); else if (z === 'adatta') adatta();
    else if (z === 'cento') zoomA(Math.max(1, img.naturalWidth / (img.offsetWidth || 1)));
  });
  q('.tela').addEventListener('wheel', e => {
    e.preventDefault();
    const d = e.ctrlKey ? Math.max(-40, Math.min(40, e.deltaY)) : e.deltaY;
    zoomA(sc * Math.exp(-d * (e.ctrlKey ? 0.012 : 0.0018)), e.clientX, e.clientY);
  }, { passive: false });
  let base = 1;
  q('.tela').addEventListener('gesturestart', e => { e.preventDefault(); base = sc; });
  q('.tela').addEventListener('gesturechange', e => { e.preventDefault(); zoomA(base * e.scale, e.clientX, e.clientY); });
  img.addEventListener('dblclick', e => { e.preventDefault(); sc > 1.001 ? adatta() : zoomA(2.5, e.clientX, e.clientY); });
  let drag = null;
  img.addEventListener('pointerdown', e => { if (sc <= 1.001) return; drag = { x: e.clientX, y: e.clientY, tx, ty }; img.setPointerCapture(e.pointerId); v.classList.add('trascinando'); });
  img.addEventListener('pointermove', e => { if (!drag) return; tx = drag.tx + e.clientX - drag.x; ty = drag.ty + e.clientY - drag.y; applica(); });
  const fine = () => { drag = null; v.classList.remove('trascinando'); };
  img.addEventListener('pointerup', fine); img.addEventListener('pointercancel', fine);
  function tasti(e) {
    if (e.target.matches('input, textarea')) return;
    if (e.key === 'Escape') chiudi(); else if (e.key === 'ArrowLeft') vai(-1); else if (e.key === 'ArrowRight') vai(1);
    else if (e.key === '+' || e.key === '=') zoomA(sc * 1.5); else if (e.key === '-') zoomA(sc / 1.5); else if (e.key === '0') adatta();
  }
  document.addEventListener('keydown', tasti);

  // ---- modifiche: si salvano appena fatte
  async function salva(c, ok = 'Salvato') {
    try { await cambia(elenco[i], c); campi(); esito(ok); } catch (e) { esito('Non riesco a salvare: ' + String(e.message || e).slice(0, 80)); }
  }
  q('.v-tipi').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const nuovo = elenco[i].categoria === b.dataset.tipo ? null : b.dataset.tipo;
    salva({ categoria: nuovo });
  });
  q('.v-nota').addEventListener('change', () => salva({ nota: q('.v-nota').value.trim() || null }));
  q('.v-ponte').addEventListener('change', () => {
    const t = q('.v-ponte').value.trim();
    if (!t) return salva({ ponte_id: null }, 'Opera tolta');
    const p = dati.ponti.find(x => `${x.nome} — ${x.strada} km ${x.km}` === t);
    if (!p) return esito('Scegli un\'opera dall’elenco');
    salva({ ponte_id: p.id }, `Spostata in ${p.nome}`);
  });
  q('.v-scarica').onclick = async () => { esito('Scarico…'); try { await scaricaFoto(elenco[i]); esito('Scaricata'); } catch (e) { esito('Non riesco a scaricarla'); } };
  q('.v-elimina').onclick = async () => {
    if (!confirm('Cancello questa foto dall’archivio? Non si può annullare.')) return;
    try {
      const f = elenco[i];
      await togli(f);
      elenco.splice(i, 1);
      if (!elenco.length) return chiudi();
      i = Math.min(i, elenco.length - 1); mostra();
    } catch (e) { esito('Non riesco a cancellarla'); }
  };
  mostra();
}
