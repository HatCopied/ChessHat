import { ChessEngine, scoreToWinPercent, classifyByWinDrop, computeGameAccuracy, formatEval, isRealSacrifice } from './engine.js';

const $ = (id) => document.getElementById(id);
const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Setup dos seletores ----------
const today = new Date();
$('year').value = today.getFullYear();
MONTHS.forEach((name, i) => $('month').add(new Option(name, i + 1)));
$('month').value = today.getMonth() + 1;

let games = [];        // partidas já filtradas (o que o dashboard usa)
let currentUser = '';
let selectedReviewGame = null;
let boardState = { game: null, ply: 0, positions: [], labels: [] };
let chessBoard = null; // Novo componente ChessBoard
let openingsSubTab = 'mostPlayed'; // 'mostPlayed' | 'worst' | 'best'
let openingsSelectedName = null;   // abertura aberta (drill-down) na aba Aberturas, ou null pra ranking

// ---------- Tabs ----------
function switchTab(tabId) {
  // hide all panels
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
  const panel = document.getElementById(tabId);
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (panel) panel.classList.remove('hidden');
  if (btn) { btn.classList.add('active'); btn.setAttribute('aria-selected','true'); }
}
// Initialize tab clicks (module runs after DOM is ready)
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ---------- Helpers de partida ----------
function colorOf(g, user) {
  const u = user.toLowerCase();
  if (g.tags.White.toLowerCase() === u) return 'white';
  if (g.tags.Black.toLowerCase() === u) return 'black';
  return 'other';
}
function result(g, user) {
  const r = g.tags.Result, c = colorOf(g, user);
  if (r === '1/2-1/2') return 'draw';
  return ((r === '1-0' && c === 'white') || (r === '0-1' && c === 'black')) ? 'win' : 'loss';
}
function openingFromEcoUrl(url) {
  if (!url) return null;
  const m = url.match(/\/openings\/([^/?#]+)/i);
  if (!m) return null;
  return decodeURIComponent(m[1]).replace(/-/g, ' ').replace(/\s+\d+\.{1,3}.*$/, '').trim();
}
const OPENING_GUESSES = [
  [/^e4 c5/i, 'Siciliana'], [/^e4 e5 Nf3 Nc6 Bb5/i, 'Ruy Lopez'], [/^e4 e5 Nf3 Nc6 Bc4/i, 'Italiana'],
  [/^e4 c6/i, 'Caro-Kann'], [/^e4 e6/i, 'Francesa'], [/^e4 d5/i, 'Escandinava'], [/^e4 d6/i, 'Pirc/Moderna'],
  [/^d4 d5 c4/i, 'Gambito da Dama'], [/^d4 Nf6 c4 g6/i, 'Indiana do Rei'], [/^d4 Nf6 Nf3/i, 'Londres/Torre'],
  [/^Nf3/i, 'Reti'], [/^c4/i, 'Inglesa'],
];
function opening(g) {
  if (g.tags.Opening) return g.tags.Opening;
  const fromEco = openingFromEcoUrl(g.tags.ECO);
  if (fromEco) return fromEco;
  const head = g.moves.slice(0, 8).join(' ');
  const hit = OPENING_GUESSES.find((x) => x[0].test(head));
  return hit ? hit[1] : 'Abertura não identificada';
}

// Percorre a partida uma vez: fase de cada lance (Abertura/Meio-jogo/Final) e,
// assim que entra num final, que TIPO de final (peças que sobraram além de rei/peão).
function analyzeStructure(g) {
  const c = new Chess();
  const phases = [];
  let endgameType = null, enteredAt = null;
  for (let i = 0; i < g.moves.length; i++) {
    try { c.move(g.moves[i], { sloppy: true }); } catch { break; }
    const board = c.board().flat().filter(Boolean);
    const label = i < 12 ? 'Abertura' : (board.length <= 8 ? 'Final' : 'Meio-jogo');
    phases.push(label);
    if (label === 'Final' && enteredAt === null) {
      enteredAt = i;
      const others = board.filter((p) => p.type !== 'k' && p.type !== 'p');
      if (others.some((p) => p.type === 'q')) endgameType = 'Damas';
      else if (others.some((p) => p.type === 'r')) endgameType = 'Torres';
      else if (others.some((p) => p.type === 'b' || p.type === 'n')) endgameType = 'Peças menores';
      else endgameType = 'Peões';
    }
  }
  return { phases, enteredAt, endgameType };
}

// Posições recorrentes: em quais posições (só nos meus lances) eu mais repito escolha.
function patterns(list, user) {
  const map = new Map();
  for (const g of list) {
    const c = new Chess();
    for (let i = 0; i < g.moves.length; i++) {
      const mine = (c.turn() === 'w' && colorOf(g, user) === 'white') || (c.turn() === 'b' && colorOf(g, user) === 'black');
      if (mine) {
        const fen = c.fen();
        const x = map.get(fen) || { n: 0, m: new Map() };
        x.n++;
        x.m.set(g.moves[i], (x.m.get(g.moves[i]) || 0) + 1);
        map.set(fen, x);
      }
      try { c.move(g.moves[i], { sloppy: true }); } catch { break; }
    }
  }
  return [...map.values()].filter((x) => x.n >= 2).sort((a, b) => b.n - a.n).slice(0, 8);
}

// ---------- Busca ----------
function monthsBackFrom(y, m, count) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    let mm = m - i, yy = y;
    while (mm < 1) { mm += 12; yy--; }
    out.push([yy, mm]);
  }
  return out;
}

function parseGame(raw) {
  const tags = {
    White: raw.white?.username || '',
    Black: raw.black?.username || '',
    Result: raw.white?.result === 'win' ? '1-0' : raw.black?.result === 'win' ? '0-1' : '1/2-1/2',
    TimeClass: raw.time_class || '',
    TimeControl: raw.time_control || '',
    ECO: raw.eco || '',
    Opening: raw.opening || '',
    Link: raw.url || '',
    Rated: !!raw.rated,
  };
  // Ordem importa: primeiro tira comentários {..} (o Chess.com põe [%clk ...] neles),
  // depois só as linhas de cabeçalho [Tag "valor"].
  const moves = (raw.pgn || '')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/^\[.*\]\s*$/gm, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .replace(/1-0|0-1|1\/2-1\/2|\*/g, ' ')
    .trim().split(/\s+/).filter(Boolean);
  return { tags, moves, endTime: raw.end_time || 0 };
}

$('load').onclick = async () => {
  currentUser = $('username').value.trim();
  if (!currentUser) return alert('Digite seu usuário do Chess.com.');
  $('load').disabled = true;
  $('status').classList.remove('hidden');
  $('status').textContent = 'Consultando o Chess.com (com cache pros meses já vistos)…';
  $('engineResults').innerHTML = '';
  $('engineStatus').textContent = '';
  try {
    const span = Number($('span').value);
    const toY = Number($('year').value), toM = Number($('month').value);
    const [fromY, fromM] = monthsBackFrom(toY, toM, span)[0];
    const url = `/api/range/${encodeURIComponent(currentUser)}/${fromY}/${fromM}/${toY}/${toM}`;
    const r = await fetch(url);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro ao consultar o Chess.com.');

    const all = [];
    for (const month of data.months) for (const raw of month.games) all.push(parseGame(raw));

    games = all.filter((g) =>
      ($('mode').value === 'all' || g.tags.TimeClass === $('mode').value) &&
      ($('color').value === 'all' || colorOf(g, currentUser) === $('color').value)
    ).sort((a, b) => a.endTime - b.endTime);

    if (!games.length) throw new Error(`Nenhuma partida corresponde aos filtros (${all.length} encontradas no período).`);

    $('status').textContent = `${all.length} partidas no período · ${games.length} após filtros · ${data.monthsRequested} meses (${data.cacheHits} do cache, ${data.liveFetches} buscados agora)`;
    $('dashboard').classList.remove('hidden');
    render();
  } catch (e) {
    $('status').textContent = e.message || 'Erro ao consultar o Chess.com.';
  } finally {
    $('load').disabled = false;
  }
};


function gameTitle(g) {
  const mine = colorOf(g, currentUser);
  const opp = mine === 'white' ? g.tags.Black : g.tags.White;
  const rr = result(g, currentUser);
  const date = g.endTime ? new Date(g.endTime).toLocaleDateString('pt-BR') : 'data desconhecida';
  return `${date} · ${mine === 'white' ? 'Brancas' : 'Pretas'} vs ${opp} · ${rr === 'win' ? 'Vitória' : rr === 'loss' ? 'Derrota' : 'Empate'}`;
}
function gameCard(g) {
  const rr = result(g, currentUser);
  const cls = rr === 'win' ? 'win' : rr === 'loss' ? 'loss' : 'draw';
  return `<div class="game-card">
    <div><b>${esc(gameTitle(g))}</b><div class="muted">${esc(opening(g))} · ${Math.ceil(g.moves.length / 2)} lances</div></div>
    <div class="game-actions">
      ${g.tags.Link ? `<a href="${esc(g.tags.Link)}" target="_blank" rel="noopener">Chess.com ↗</a>` : ''}
      <button class="secondary review-game" data-game-id="${esc(g.id || g.tags.Link || gameTitle(g))}">Revisar</button>
    </div>
  </div>`;
}

// ---------- Aba Aberturas: ranking em 3 etapas + drill-down no mesmo painel ----------
function renderOpeningsTab() {
  const byOpening = {};
  games.forEach((g) => {
    const k = opening(g);
    byOpening[k] ??= { n: 0, w: 0, d: 0 };
    byOpening[k].n++;
    const rr = result(g, currentUser);
    if (rr === 'win') byOpening[k].w++; else if (rr === 'draw') byOpening[k].d++;
  });

  document.querySelectorAll('.subtab-btn').forEach((b) => b.classList.toggle('active', b.dataset.subtab === openingsSubTab));

  // Drill-down: uma abertura específica foi clicada -> mostra as partidas dela, com botão de voltar
  if (openingsSelectedName) {
    const name = openingsSelectedName;
    const list = games.filter((g) => opening(g) === name);
    const winList = list.filter((g) => result(g, currentUser) === 'win');
    const lossList = list.filter((g) => result(g, currentUser) === 'loss');
    const drawList = list.filter((g) => result(g, currentUser) === 'draw');
    $('openingsView').innerHTML = `
      <button class="secondary back-btn" id="openingsBack">← Voltar</button>
      <h3 style="margin:12px 0 2px">${esc(name)}</h3>
      <p class="muted">${list.length} partidas – ${winList.length}V · ${drawList.length}E · ${lossList.length}D</p>
      <h4>Vitórias</h4>${winList.slice(0, 10).map(gameCard).join('') || '<p class="muted">Nenhuma.</p>'}
      <h4>Derrotas</h4>${lossList.slice(0, 10).map(gameCard).join('') || '<p class="muted">Nenhuma.</p>'}
      <h4>Empates</h4>${drawList.slice(0, 10).map(gameCard).join('') || '<p class="muted">Nenhuma.</p>'}
    `;
    $('openingsBack').onclick = () => { openingsSelectedName = null; renderOpeningsTab(); };
    bindReviewButtons();
    return;
  }

  // Ranking: qual das 3 etapas está ativa
  let entries;
  if (openingsSubTab === 'worst') {
    entries = Object.entries(byOpening).filter(([, v]) => v.n >= 3)
      .sort((a, b) => (b[1].n - b[1].w - b[1].d) / b[1].n - (a[1].n - a[1].w - a[1].d) / a[1].n).slice(0, 8);
  } else if (openingsSubTab === 'best') {
    entries = Object.entries(byOpening).filter(([, v]) => v.n >= 3)
      .sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n).slice(0, 8);
  } else {
    entries = Object.entries(byOpening).sort((a, b) => b[1].n - a[1].n).slice(0, 8);
  }

  $('openingsView').innerHTML = entries.length ? entries.map(([k, v]) => `
    <div class="row opening-row" data-opening="${esc(k)}">
      <div class="rowtop"><b>${esc(k)}</b><span class="muted">${v.n}</span></div>
      <div class="muted">${v.w}V · ${v.d}E · ${v.n - v.w - v.d}D</div>
      <div class="mini"><i style="width:${v.w / v.n * 100}%"></i></div>
    </div>`).join('') : '<p class="muted">Precisa de mais partidas nessa categoria (mín. 3 pra piores/melhores).</p>';

  $('openingsView').querySelectorAll('.opening-row').forEach((row) => {
    row.onclick = () => { openingsSelectedName = row.dataset.opening; renderOpeningsTab(); };
  });
}
document.querySelectorAll('.subtab-btn').forEach((b) => {
  b.onclick = () => { openingsSubTab = b.dataset.subtab; openingsSelectedName = null; renderOpeningsTab(); };
});
function setupBoardReview(g) {
  const c = new Chess();
  const history = [{ fen: c.fen(), san: null, from: null, to: null, promotion: null, flags: '' }];
  for (let i = 0; i < g.moves.length; i++) {
    try {
      const move = c.move(g.moves[i], { sloppy: true });
      if (move) {
        history.push({ fen: c.fen(), san: g.moves[i], from: move.from, to: move.to, promotion: move.promotion, flags: move.flags });
      }
    } catch { break; }
  }

  boardState = { game: g, ply: 0, positions: history.map(h => h.fen), labels: history.map((h, i) => i === 0 ? 'Posição inicial' : `${Math.floor((i-1)/2)+1}${((i-1)%2)?'...':'.'} ${h.san}`) };
  $('boardReview').classList.remove('hidden');
  $('boardGameLabel').textContent = gameTitle(g);
  $('boardPly').max = String(boardState.positions.length - 1);

  // Inicializa ou atualiza o novo ChessBoard
  if (!chessBoard) {
    chessBoard = new ChessBoard('#chessBoard', {
      orientation: 'white',
      showCoords: true,
      animationMs: 200
    });
  }
  chessBoard.loadHistory(history, 0);
  chessBoard.setPlyIcons({}); // limpa ícones da partida anterior até rodar a análise de novo
  chessBoard.setPlyClassifications({});
  chessBoard.setPlyBestMoves({});
  chessBoard.setPlyCurrentBestMoves({});
  updateBoardUI(0);
}

// Atualiza apenas a UI (labels, botões, slider) - o tabuleiro SVG é gerenciado pelo ChessBoard
function updateBoardUI(ply) {
  boardState.ply = ply;
  $('boardPly').value = String(ply);
  $('boardMoveLabel').textContent = `${ply}/${boardState.positions.length - 1}`;
  $('boardLastMove').textContent = boardState.labels[ply] || 'Posição inicial';
  $('boardPrev').disabled = ply === 0;
  $('boardStart').disabled = ply === 0;
  $('boardNext').disabled = ply >= boardState.positions.length - 1;
  $('boardEnd').disabled = ply >= boardState.positions.length - 1;
}

// Nova navegação usando ChessBoard
async function changeBoardPly(next) {
  const target = Math.max(0, Math.min(next, boardState.positions.length - 1));
  if (target === boardState.ply) return;
  if (chessBoard) {
    await chessBoard.goToPly(target);
  }
  updateBoardUI(target);
}

function bindReviewButtons() {
  document.querySelectorAll('.review-game').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.gameId;
      selectedReviewGame = games.find(g => String(g.id || g.tags.Link || gameTitle(g)) === id) || null;
      if (selectedReviewGame) {
        $('analysisCount').value = '1';
        $('analysisCountLabel').classList.add('hidden');
        $('engineStatus').textContent = `Partida selecionada: ${gameTitle(selectedReviewGame)}. Analisando…`;
        $('engineResults').innerHTML = '';
        // switch to Partida tab
        switchTab('tab-partida');
        setupBoardReview(selectedReviewGame);
        runEngineAnalysis(); // dispara a análise com Stockfish automaticamente
      }
    };
  });
}

// ---------- Renderização do dashboard ----------
function render() {
  const t = games.length;
  const wins = games.filter((g) => result(g, currentUser) === 'win').length;
  const draws = games.filter((g) => result(g, currentUser) === 'draw').length;
  const losses = t - wins - draws;

  $('period').textContent = `${t} partidas · modo: ${$('mode').value === 'all' ? 'todos' : $('mode').value} · cor: ${$('color').value === 'all' ? 'ambas' : $('color').value}`;
  $('total').textContent = t;
  $('wins').style.width = (wins / t * 100 || 0) + '%';
  $('draws').style.width = (draws / t * 100 || 0) + '%';
  $('losses').style.width = (losses / t * 100 || 0) + '%';
  $('resultText').textContent = `${wins} vitórias · ${draws} empates · ${losses} derrotas`;

  // Por cor
  const byColor = { white: { n: 0, w: 0, d: 0 }, black: { n: 0, w: 0, d: 0 } };
  games.forEach((g) => {
    const c = colorOf(g, currentUser);
    if (!byColor[c]) return;
    byColor[c].n++;
    const rr = result(g, currentUser);
    if (rr === 'win') byColor[c].w++; else if (rr === 'draw') byColor[c].d++;
  });
  $('colorStats').innerHTML = ['white', 'black'].map((c) => {
    const v = byColor[c], pct = v.n ? Math.round((v.w / v.n) * 100) : 0;
    return `<div><strong>${v.n}</strong><span>${c === 'white' ? 'Brancas' : 'Pretas'} · ${pct}% de vitórias</span></div>`;
  }).join('');

  // Estrutura das partidas (fase máxima + tipo de final)
  const structures = games.map((g) => ({ g, s: analyzeStructure(g) }));
  const reachedMid = structures.filter((x) => x.s.phases.includes('Meio-jogo')).length;
  const reachedEnd = structures.filter((x) => x.s.enteredAt !== null);
  const pc = { Abertura: 0, 'Meio-jogo': 0, Final: 0 };
  structures.forEach((x) => { const last = x.s.phases.at(-1) || 'Abertura'; pc[last]++; });
  const mxPhase = Math.max(1, ...Object.values(pc));
  $('phases').innerHTML = Object.entries(pc).map(([k, v]) =>
    `<div class="barrow"><span>${k}</span><div class="bar"><i style="width:${v / mxPhase * 100}%"></i></div><b>${v}</b></div>`
  ).join('');

  // Até onde cheguei mais longe
  const longest = structures.reduce((best, x) => (x.g.moves.length > (best?.g.moves.length || 0) ? x : best), null);
  const avgLen = t ? Math.round(structures.reduce((a, x) => a + x.g.moves.length, 0) / t) : 0;
  if (longest) {
    const opp = colorOf(longest.g, currentUser) === 'white' ? longest.g.tags.Black : longest.g.tags.White;
    const link = longest.g.tags.Link ? `<a href="${esc(longest.g.tags.Link)}" target="_blank" rel="noopener">ver partida</a>` : '';
    $('longest').innerHTML = `<strong>${Math.ceil(longest.g.moves.length / 2)}</strong><span>lances na sua partida mais longa, contra <b>${esc(opp)}</b> (${result(longest.g, currentUser)}) — ${link}</span><p class="muted">Duração média: ${Math.ceil(avgLen / 2)} lances · ${reachedMid} partidas chegaram ao meio-jogo · ${reachedEnd.length} chegaram a um final.</p>`;
  } else {
    $('longest').innerHTML = '<p class="muted">Sem dados suficientes ainda.</p>';
  }

  // Tipos de final mais frequentes
  const endTypes = {};
  reachedEnd.forEach((x) => { endTypes[x.s.endgameType] = (endTypes[x.s.endgameType] || 0) + 1; });
  const mxEnd = Math.max(1, ...Object.values(endTypes), 0);
  $('endgameTypes').innerHTML = Object.keys(endTypes).length
    ? Object.entries(endTypes).sort((a, b) => b[1] - a[1]).map(([k, v]) =>
        `<div class="barrow"><span>${k}</span><div class="bar"><i style="width:${v / mxEnd * 100}%"></i></div><b>${v}</b></div>`
      ).join('')
    : '<p class="muted">Nenhuma partida chegou a um final claro ainda.</p>';

  // Aberturas – ranking em 3 etapas (mais jogadas / piores / melhores), com
  // drill-down no mesmo painel (sem empilhar seções) e botão de voltar.
  renderOpeningsTab();

  // Modos (caso "todos" esteja selecionado, mostra a mistura)
  const byMode = {};
  games.forEach((g) => {
    const k = g.tags.TimeClass || 'outro';
    byMode[k] ??= { n: 0, w: 0, d: 0 };
    byMode[k].n++;
    const rr = result(g, currentUser);
    if (rr === 'win') byMode[k].w++; else if (rr === 'draw') byMode[k].d++;
  });
  $('modes').innerHTML = Object.entries(byMode).map(([k, v]) =>
    `<div class="row"><div class="rowtop"><b>${k}</b><span>${v.n}</span></div><div class="muted">${v.w}V · ${v.d}E · ${v.n - v.w - v.d}D</div></div>`
  ).join('');

  // Padrões de lance recorrentes
  const ps = patterns(games, currentUser);
  $('patterns').innerHTML = ps.length ? ps.map((x, i) => {
    const sorted = [...x.m.entries()].sort((a, b) => b[1] - a[1]);
    return `<div class="pattern"><div><b>Posição recorrente #${i + 1}</b><div class="muted">${x.n} ocorrências</div><div class="moves">${sorted.slice(0, 4).map(([mv, n]) => `${esc(mv)} × ${n}`).join(' · ')}</div></div><span class="muted">${Math.round(sorted[0][1] / x.n * 100)}%</span></div>`;
  }).join('') : '<p class="muted">Nenhuma posição repetida o bastante ainda.</p>';

  // guarda estrutura pra reaproveitar na análise do motor (evita recalcular fase)
  render._structures = structures;
}

// ---------- Revisão com Stockfish (estilo "game review") ----------
let engineInstance = null;
let engineRunning = false;
let stopRequested = false;

function allMovePositions(g, user, maxPlies) {
  const c = new Chess();
  const mine = colorOf(g, user);
  const out = [];
  for (let i = 0; i < g.moves.length && out.length < maxPlies; i++) {
    const sideToMove = c.turn();
    const isMine = (sideToMove === 'w' && mine === 'white') || (sideToMove === 'b' && mine === 'black');
    const fenBefore = c.fen();
    const san = g.moves[i];
    out.push({ ply: i, moveNumber: Math.floor(i / 2) + 1, san, fenBefore, isMine });
    try { c.move(san, { sloppy: true }); } catch { break; }
  }
  return out;
}

function negateEval(raw) { return raw ? { type: raw.type, value: -raw.value } : null; }

async function analyzeGame(g, user, depth, maxPlies, onProgress) {
  if (!engineInstance) engineInstance = new ChessEngine();
  const positions = allMovePositions(g, user, maxPlies);
  const mine = colorOf(g, user);
  const rows = [];
  const drops = [];
  const winBefores = [];
  for (let i = 0; i < positions.length; i++) {
    if (stopRequested) break;
    const p = positions[i];
    const before = await engineInstance.evaluate(p.fenBefore, depth, 2);
    const c = new Chess(); c.load(p.fenBefore);
    const played = c.move(p.san, { sloppy: true });
    const playedUci = played ? `${played.from}${played.to}${played.promotion || ''}` : null;
    // "Tático" pra fins de Brilhante agora exige um sacrifício de verdade
    // (peça entregue numa casa onde não dá pra reaver nada), não só captura/xeque.
    const movedPieceType = played ? (played.promotion || played.piece) : null;
    const isTactical = !!(played && movedPieceType && isRealSacrifice(Chess, c.fen(), played.to, movedPieceType));
    const mated = c.in_checkmate();
    const after = mated ? { rawScore: null } : await engineInstance.evaluate(c.fen(), depth);

    const evalBeforeMine = before.rawScore;                 // já é da minha perspectiva (eu ia jogar)
    const evalAfterMine = negateEval(after.rawScore);        // depois do meu lance é a vez do oponente -> inverte
    const winBefore = scoreToWinPercent(evalBeforeMine);
    const winAfter = mated ? 100 : scoreToWinPercent(evalAfterMine);
    const drop = Math.max(0, winBefore - winAfter);
    const isBestMove = !!(before.bestmove && playedUci && before.bestmove === playedUci);
    // "Chance perdida": a posição já era claramente vencedora para quem
    // estava prestes a jogar (normalmente porque o adversário acabou de errar),
    // mas o lance jogado deixa escapar essa vantagem. Isso evita transformar
    // automaticamente toda perda grande de avaliação em "Gafe".
    const missedWin = !isBestMove && winBefore >= 75 && winAfter <= 55 && !mated;
    const cls = classifyByWinDrop(drop, { brilliant: isBestMove && isTactical, missedWin });
    const evalWhite = mine === 'white' ? evalBeforeMine : negateEval(evalBeforeMine);
    const secondBestUci = (before.secondPv && before.secondPv[0]) || null;
    const secondEval = before.secondRawScore || null;

    rows.push({ ...p, evalWhite, drop, classification: cls, bestmove: before.bestmove || null, nextBestmove: after.bestmove || null, secondBestUci, secondEval, playedUci });
    // A precisão exibida continua sendo a do usuário; a revisão/classificação
    // dos lances agora inclui também todos os lances do adversário.
    if (p.isMine) {
      drops.push(drop);
      winBefores.push(winBefore);
    }
    onProgress(i + 1, positions.length);
  }
  const accuracy = computeGameAccuracy(drops, winBefores);
  return { rows, accuracy };
}

function renderEngineResults(perGame) {
  const allRows = perGame.flatMap((pg) => pg.rows.map((r) => ({ ...r, gameLabel: pg.label })));
  const accuracies = perGame.map((pg) => pg.accuracy).filter((a) => a != null);
  const avgAccuracy = accuracies.length ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null;

  const counts = { brilliant: 0, excellent: 0, best: 0, ok: 0, inaccuracy: 0, mistake: 0, blunder: 0, missedWin: 0 };
  allRows.forEach((r) => counts[r.classification.key]++);

  const finalRows = allRows.filter((r) => r.phaseLabel === 'Final');
  const finalMistakes = finalRows.filter((r) => r.classification.key === 'mistake' || r.classification.key === 'blunder').length;

  // ---------- Move list with icons (for first game or selected) ----------
  const firstGame = perGame[0];
  const moveListHtml = firstGame ? firstGame.rows.map((r) => `
    <div class="movelist-row" data-ply="${r.ply}">
      <span style="width:3ch;text-align:right;">${r.moveNumber}${r.ply % 2 ? '...' : '.'}</span>
      <span>${esc(r.san)}</span>
      <img class="cls-icon" src="${r.classification.icon}" alt="${esc(r.classification.label)}" title="${esc(r.classification.label)}">
      <span class="muted">${r.classification.label}</span>
    </div>`).join('') : '';

  $('moveList').innerHTML = moveListHtml;
  $('moveList').querySelectorAll('.movelist-row').forEach((row) => {
    row.onclick = () => changeBoardPly(Number(row.dataset.ply) + 1); // +1: boardState.positions[0] é a posição inicial
  });

  // Ícones em cima da peça no tabuleiro (igual chess.com): mapeia ply do
  // histórico (r.ply + 1, pois positions[0] é a posição inicial) -> ícone.
  if (firstGame && chessBoard) {
    const plyIcons = {};
    const plyClassifications = {};
    const plyBestMoves = {};
    const plyCurrentBestMoves = {};
    firstGame.rows.forEach((r) => {
      const ply = r.ply + 1;
      plyIcons[ply] = r.classification.icon;
      plyClassifications[ply] = r.classification.key;
      if (r.nextBestmove) plyBestMoves[ply] = r.nextBestmove;
      if (r.bestmove) plyCurrentBestMoves[ply] = r.bestmove;
    });
    chessBoard.setPlyIcons(plyIcons);
    chessBoard.setPlyClassifications(plyClassifications);
    chessBoard.setPlyBestMoves(plyBestMoves);
    chessBoard.setPlyCurrentBestMoves(plyCurrentBestMoves);
  }

  // ---------- Full game review table (all moves) ----------
  const fullTableHtml = firstGame ? `
    <h3>Revisão completa – ${esc(firstGame.label)}</h3>
    <table class="engine-table"><thead>
      <tr><th>#</th><th>Lance jogado</th><th>Melhor lance</th><th>2ª melhor</th><th>Classificação</th><th>Eval</th><th>Queda %</th></tr>
    </thead><tbody>
    ${firstGame.rows.map((r) => `
      <tr>
        <td class="muted">${r.moveNumber}${r.ply % 2 ? '...' : '.'}</td>
        <td><b>${esc(r.san)}</b></td>
        <td><code style="color:#2ecc40;">${esc(r.bestmove || '—')}</code></td>
        <td><code style="color:#7fdbff;">${esc(r.secondBestUci || '—')}</code></td>
        <td><img class="cls-icon" src="${r.classification.icon}" alt=""> ${r.classification.label}</td>
        <td>${formatEval(r.evalWhite)}</td>
        <td><b>${r.drop.toFixed(1)}%</b></td>
      </tr>`).join('')}
    </tbody></table>` : '';

  // ---------- Worst 40 table (existing) ----------
  const worstRows = allRows.filter((r) => !['brilliant', 'excellent', 'best', 'ok'].includes(r.classification.key))
                           .sort((a, b) => b.drop - a.drop).slice(0, 40);
  const worstHtml = worstRows.length ? `
    <h3>Piores lances (top 40)</h3>
    <table class="engine-table"><thead><tr><th>Partida</th><th>Lance</th><th>Fase</th><th>Classificação</th><th>Melhor lance</th><th>Eval antes</th><th>Queda</th></tr></thead><tbody>
    ${worstRows.map((r) => `
      <tr>
        <td class="muted">${esc(r.gameLabel)}</td>
        <td><b>${r.moveNumber}${r.ply % 2 ? '...' : '.'} ${esc(r.san)}</b></td>
        <td class="muted">${r.phaseLabel}</td>
        <td><img class="cls-icon" src="${r.classification.icon}" alt=""> ${r.classification.label}</td>
        <td><code>${esc(r.bestmove || '—')}</code></td>
        <td>${formatEval(r.evalWhite)}</td>
        <td><b>${r.drop.toFixed(1)}%</b></td>
      </tr>`).join('')}
    </tbody></table>` : '';

  $('engineResults').innerHTML = `
    <div class="engine-summary">
      <div class="engine-stat accuracy"><b>${avgAccuracy != null ? avgAccuracy.toFixed(1) + '%' : '—'}</b><span>precisão média</span></div>
      <div class="engine-stat"><img class="cls-icon" src="/icon/svg/brilliant.svg" alt=""><b>${counts.brilliant}</b><span>brilhantes*</span></div>
      <div class="engine-stat"><img class="cls-icon" src="/icon/svg/excellent.svg" alt=""><b>${counts.excellent}</b><span>excelentes</span></div>
      <div class="engine-stat"><img class="cls-icon" src="/icon/svg/best.svg" alt=""><b>${counts.best}</b><span>melhores</span></div>
      <div class="engine-stat"><img class="cls-icon" src="/icon/svg/blunder.svg" alt=""><b>${counts.blunder}</b><span>grandes erros</span></div>
      <div class="engine-stat"><img class="cls-icon" src="/icon/svg/mistake.svg" alt=""><b>${counts.mistake}</b><span>erros</span></div>
      <div class="engine-stat"><img class="cls-icon" src="/icon/svg/inaccuracy.svg" alt=""><b>${counts.inaccuracy}</b><span>imprecisões</span></div>
    </div>
    ${finalRows.length ? `<p class="callout">Em finais: <b>${finalMistakes}</b> de ${finalRows.length} lances avaliados foram erro ou grande erro (${Math.round(finalMistakes / finalRows.length * 100)}%).</p>` : ''}
    ${counts.brilliant ? '<p class="muted">* Brilhantes é uma indicação conservadora: melhor lance encontrado pelo motor + sinal tático simples. Não substitui uma revisão humana.</p>' : ''}
    ${fullTableHtml}
    ${worstHtml}
    ${allRows.length ? '' : '<p class="muted">Nenhum lance seu foi avaliado.</p>'}
  `;
}

$('boardStart').onclick = () => changeBoardPly(0);
$('boardPrev').onclick = () => changeBoardPly(boardState.ply - 1);
$('boardNext').onclick = () => changeBoardPly(boardState.ply + 1);
$('boardEnd').onclick = () => changeBoardPly(boardState.positions.length - 1);
$('boardPly').oninput = () => changeBoardPly(Number($('boardPly').value));

async function runEngineAnalysis() {
  if (engineRunning || !games.length) return;
  engineRunning = true; stopRequested = false;
  $('engineBtn').disabled = true;
  $('stopBtn').classList.remove('hidden');
  $('engineStatus').innerHTML = 'Inicializando Stockfish (roda local no seu navegador)…<div class="engine-progress"><i id="engineProgress"></i></div>';
  $('engineResults').innerHTML = '';
  try {
    const depth = Number($('analysisDepth').value);
    const howMany = Math.min(Number($('analysisCount').value), games.length);
    const maxPlies = Number($('analysisMaxPlies').value);
    // prioriza as derrotas mais recentes (é onde normalmente tem mais a aprender), completando com o resto
    const ordered = [...games].sort((a, b) => {
      const ra = result(a, currentUser) === 'loss' ? 0 : 1, rb = result(b, currentUser) === 'loss' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return b.endTime - a.endTime;
    });
    const selected = selectedReviewGame ? [selectedReviewGame] : ordered.slice(0, howMany);
    const structMap = new Map((render._structures || []).map((x) => [x.g, x.s]));
    const perGame = [];

    for (let gi = 0; gi < selected.length && !stopRequested; gi++) {
      const g = selected[gi];
      const opp = colorOf(g, currentUser) === 'white' ? g.tags.Black : g.tags.White;
      const label = `vs ${opp} (${result(g, currentUser)})`;
      $('engineStatus').firstChild.textContent = `Analisando ${gi + 1}/${selected.length}: ${label}… `;
      const { rows, accuracy } = await analyzeGame(g, currentUser, depth, maxPlies, (done, total) => {
        const el = $('engineProgress');
        if (el) el.style.width = (((gi + done / Math.max(total, 1)) / selected.length) * 100).toFixed(1) + '%';
      });
      const phases = structMap.get(g)?.phases || [];
      rows.forEach((r) => { r.phaseLabel = phases[r.ply] || '—'; });
      perGame.push({ label, accuracy, rows });
    }

    renderEngineResults(perGame);
    $('engineStatus').innerHTML = stopRequested
      ? `Interrompido pelo usuário. ${perGame.length} partida(s) concluída(s).`
      : `Concluído: ${perGame.length} partidas · ${perGame.reduce((a, p) => a + p.rows.length, 0)} lances avaliados, tudo local no navegador.`;
  } catch (e) {
    $('engineStatus').textContent = e.message || 'Falha ao rodar o Stockfish.';
  } finally {
    engineRunning = false;
    $('engineBtn').disabled = false;
    $('stopBtn').classList.add('hidden');
  }
}

$('engineBtn').onclick = () => runEngineAnalysis();
$('stopBtn').onclick = () => { stopRequested = true; };
