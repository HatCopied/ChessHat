/**
 * ChessBoard - Componente de tabuleiro SVG responsivo, animado e acessível
 */
export class ChessBoard {
  constructor(container, options = {}) {
    this.container = typeof container === 'string' ? document.querySelector(container) : container;
    if (!this.container) throw new Error('Container do tabuleiro não encontrado');
    this.options = { orientation: 'white', showCoords: true, draggable: false, animationMs: 200, onMove: null, ...options };
    this.position = 'start'; this.ply = 0; this.history = []; this.lastMove = null; this.checkSquare = null;
    this.legalTargets = new Set(); this.selectedSquare = null; this.isAnimating = false; this.pieceElements = new Map();
    this.plyIcons = {}; // { ply: iconUrl } - ícone de classificação por lance
    this.plyClassifications = {}; // { ply: classificationKey } - cor do destaque do último lance
    this.plyBestMoves = {}; // { ply: uci } - melhor lance para o próximo jogador
    this.plyCurrentBestMoves = {}; // { ply: uci } - melhor lance alternativo para quem fez o lance
    this._createSVG(); this._bindEvents(); this.setPosition('start');
  }
  _createSVG() {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg = document.createElementNS(ns, 'svg');
    this.svg.setAttribute('viewBox', '0 0 512 512');
    this.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    this.svg.style.width = '100%'; this.svg.style.height = '100%'; this.svg.style.display = 'block';
    this.svg.style.maxWidth = '600px'; this.svg.style.margin = '0 auto';
    this.svg.setAttribute('role', 'img'); this.svg.setAttribute('aria-label', 'Tabuleiro de xadrez');
    this.layerCoords = this._g('coords'); this.layerSquares = this._g('squares');
    this.layerHighlights = this._g('highlights'); this.layerPieces = this._g('pieces');
    this.layerMoveIcon = this._g('moveicon'); this.layerArrows = this._g('arrows');
    [this.layerCoords, this.layerSquares, this.layerHighlights, this.layerPieces, this.layerMoveIcon, this.layerArrows].forEach(g => this.svg.appendChild(g));
    this.container.innerHTML = ''; this.container.appendChild(this.svg);
    this._createDefs(); this._drawSquares(); if (this.options.showCoords) this._drawCoords();
  }
  _g(id) { const g = document.createElementNS('http://www.w3.org/2000/svg', 'g'); g.id = id; return g; }
  _createDefs() {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `<filter id="check-pulse" x="-50%" y="-50%" width="200%" height="200%"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0.3 0 0 0  0 0 0.3 0 0  0 0 0 1 0"/><animate attributeName="values" dur="1s" repeatCount="indefinite" values="1 0 0 0 0  0 0.3 0 0 0  0 0 0.3 0 0  0 0 0 1 0;1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0;1 0 0 0 0  0 0.3 0 0 0  0 0 0.3 0 0  0 0 0 1 0"/></filter><marker id="arrow-head" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 Z" fill="currentColor"/></marker><marker id="best-move-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L0,8 L8,4 Z" fill="#3b82f6"/></marker><marker id="current-best-move-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L0,8 L8,4 Z" fill="#3aaa35"/></marker>`;
    this.svg.insertBefore(defs, this.svg.firstChild);
  }
  _drawSquares() {
    const ns = 'http://www.w3.org/2000/svg';
    const boardImg = document.createElementNS(ns, 'image');
    boardImg.setAttribute('href', '/piecesnews/tabuleiro.png');
    boardImg.setAttribute('x', 0); boardImg.setAttribute('y', 0);
    boardImg.setAttribute('width', 512); boardImg.setAttribute('height', 512);
    boardImg.setAttribute('preserveAspectRatio', 'none');
    this.layerSquares.appendChild(boardImg);
    for (let rank = 7; rank >= 0; rank--) { for (let file = 0; file < 8; file++) { const isLight = (rank + file) % 2 === 0; const rect = document.createElementNS(ns, 'rect'); rect.setAttribute('class', 'sq ' + (isLight ? 'l' : 'd')); rect.setAttribute('data-file', file); rect.setAttribute('data-rank', rank); rect.setAttribute('x', file * 64); rect.setAttribute('y', (7 - rank) * 64); rect.setAttribute('width', 64); rect.setAttribute('height', 64); rect.setAttribute('fill', 'transparent'); this.layerSquares.appendChild(rect); } }
  }
  _drawCoords() {
    const ns = 'http://www.w3.org/2000/svg'; const files = 'abcdefgh'; const ranks = '12345678'; const fontSize = 14; const offset = 8;
    files.split('').forEach((f, i) => { const text = document.createElementNS(ns, 'text'); text.setAttribute('class', 'coord file'); text.setAttribute('x', i * 64 + 32); text.setAttribute('y', 512 - offset); text.setAttribute('text-anchor', 'middle'); text.setAttribute('font-size', fontSize); text.setAttribute('font-weight', '700'); text.setAttribute('fill', i % 2 === 0 ? '#739552' : '#EBECD0'); text.textContent = f; this.layerCoords.appendChild(text); });
    ranks.split('').forEach((r, i) => { const text = document.createElementNS(ns, 'text'); text.setAttribute('class', 'coord rank'); text.setAttribute('x', offset); text.setAttribute('y', (7 - i) * 64 + 32 + fontSize / 3); text.setAttribute('text-anchor', 'start'); text.setAttribute('font-size', fontSize); text.setAttribute('font-weight', '700'); text.setAttribute('fill', i % 2 === 0 ? '#739552' : '#EBECD0'); text.textContent = r; this.layerCoords.appendChild(text); });
  }
// ==================== POSITION & RENDER ====================
  setPosition(fen) { this.position = fen; this.ply = 0; this.history = [{ fen, san: null, from: null, to: null, promotion: null, flags: '' }]; this.lastMove = null; this.checkSquare = null; this._updateCheckSquare(); this._renderPieces(); }
  loadHistory(history, startPly = 0) { this.history = history; this.ply = startPly; this.position = history[this.ply].fen; this._updateLastMove(); this._updateCheckSquare(); this._renderPieces(); this._renderHighlights(); this._renderMoveIcon(); this._renderBestMoveArrow(); this._renderCurrentBestMoveArrow(); }
  async goToPly(ply) { const target = Math.max(0, Math.min(ply, this.history.length - 1)); if (target === this.ply) return; const direction = target > this.ply ? 1 : -1; for (let p = this.ply + direction; p !== target + direction; p += direction) { this.ply = p; this.position = this.history[p].fen; this._updateLastMove(); this._updateCheckSquare(); await this._animateToPosition(); } this._renderMoveIcon(); this._renderBestMoveArrow(); this._renderCurrentBestMoveArrow(); }
  next() { return this.goToPly(this.ply + 1); } prev() { return this.goToPly(this.ply - 1); } start() { return this.goToPly(0); } end() { return this.goToPly(this.history.length - 1); }
  // ==================== PIECE RENDERING ====================
  _pieceKey(piece) { return piece.color + piece.type.toUpperCase(); }
  _pieceUrl(key) { return '/piecesnews/' + key.toLowerCase() + '.png'; }
  _squareCenter(file, rank) { const orientedFile = this.options.orientation === 'white' ? file : 7 - file; const orientedRank = this.options.orientation === 'white' ? rank : 7 - rank; return { x: orientedFile * 64 + 32, y: (7 - orientedRank) * 64 + 32 }; }
  _renderPieces() {
    const ns = 'http://www.w3.org/2000/svg'; this.layerPieces.innerHTML = ''; this.pieceElements.clear();
    const fenParts = this.position.split(' '); const boardFen = fenParts[0]; let file = 0, rank = 7;
    for (const ch of boardFen) { if (ch === '/') { file = 0; rank--; continue; } if (ch >= '1' && ch <= '8') { file += parseInt(ch); continue; } const color = ch === ch.toUpperCase() ? 'w' : 'b'; const type = ch.toLowerCase(); const key = this._pieceKey({ type, color }); const center = this._squareCenter(file, rank); const img = document.createElementNS(ns, 'image'); img.setAttribute('href', this._pieceUrl(key)); img.setAttribute('class', 'piece'); img.setAttribute('data-square', String.fromCharCode(97 + file) + (rank + 1)); img.setAttribute('x', center.x - 31); img.setAttribute('y', center.y - 31); img.setAttribute('width', 62); img.setAttribute('height', 62); img.style.pointerEvents = 'none'; img.style.transition = 'transform ' + this.options.animationMs + 'ms cubic-bezier(0.2, 0.8, 0.2, 1)'; this.layerPieces.appendChild(img); this.pieceElements.set(file + ',' + rank, img); file++; }
  }
// ==================== HIGHLIGHTS ====================
  _updateLastMove() { if (this.ply === 0) { this.lastMove = null; return; } const move = this.history[this.ply]; if (move.from && move.to) { this.lastMove = { from: move.from, to: move.to }; } }
  _updateCheckSquare() { if (window.Chess) { const chess = new window.Chess(this.position); if (chess.in_check()) { const kingSquare = chess.board().flat().find(p => p && p.type === 'k' && p.color === chess.turn()); if (kingSquare) { const file = kingSquare.square.charCodeAt(0) - 97; const rank = parseInt(kingSquare.square[1]) - 1; this.checkSquare = file + ',' + rank; return; } } } this.checkSquare = null; }
  _clearHighlights() { this.layerHighlights.innerHTML = ''; }
  _classificationColor(key) {
    // Tons aproximados do chess.com por classificação (cor + opacidade do
    // filtro aplicado sobre a casa), a mesma cor para casa clara e escura —
    // o efeito de tingimento diferente vem naturalmente da casa por baixo.
    const colors = {
      // Cor predominante real do respectivo ícone de revisão (64x).
      // A mesma cor é aplicada como filtro nas casas de origem e destino.
      brilliant: { color: '#18a8a8', opacity: 0.42 },   // Brilhante
      excellent: { color: '#98b848', opacity: 0.42 },   // Excelente
      best: { color: '#98b848', opacity: 0.42 },        // Melhor Lance
      book: { color: '#a88868', opacity: 0.42 },        // Livro/Abertura
      ok: { color: '#98a888', opacity: 0.42 },          // Bom
      inaccuracy: { color: '#f8c848', opacity: 0.42 },  // Imprecisão
      mistake: { color: '#e88828', opacity: 0.42 },     // Erro
      blunder: { color: '#c83838', opacity: 0.42 },         // Gafe
      missedWin: { color: '#b86fe8', opacity: 0.42 }     // Chance perdida
    };
    return colors[key] || colors.ok;
  }

  _renderMoveIcon() {
    this.layerMoveIcon.innerHTML = '';
    const url = this.plyIcons[this.ply];
    if (!this.lastMove) return;
    const ns = 'http://www.w3.org/2000/svg';

    // Ícone de revisão (estilo chess.com): o próprio SVG já traz seu círculo
    // colorido + sombra suave, então não desenhamos nenhum círculo/contorno
    // extra por trás — isso é o que causava o contorno preto/branco feio.
    if (!url) return;
    const file = this.lastMove.to.charCodeAt(0) - 97; const rank = parseInt(this.lastMove.to[1]) - 1;
    const sqX = this._getSvgX(file), sqY = this._getSvgY(rank);
    const size = 26; // ~40% da casa (64), do tamanho do chess.com
    // Quase centralizado na quina da casa (levemente puxado pra dentro dela).
    const cx = sqX + 64 - 5, cy = sqY + 5;
    const img = document.createElementNS(ns, 'image');
    img.setAttribute('href', url);
    img.setAttribute('x', cx - size / 2);
    img.setAttribute('y', cy - (size * 19 / 18) / 2);
    img.setAttribute('width', size);
    img.setAttribute('height', size * 19 / 18);
    this.layerMoveIcon.appendChild(img);
  }
  _renderBestMoveArrow() {
    this.layerArrows.innerHTML = '';
    const uci = this.plyBestMoves[this.ply];
    if (!uci || uci.length < 4) return;
    const ns = 'http://www.w3.org/2000/svg';
    const fromFile = uci.charCodeAt(0) - 97, fromRank = parseInt(uci[1]) - 1;
    const toFile = uci.charCodeAt(2) - 97, toRank = parseInt(uci[3]) - 1;
    if (fromFile < 0 || fromFile > 7 || fromRank < 0 || fromRank > 7 || toFile < 0 || toFile > 7 || toRank < 0 || toRank > 7) return;
    const fromX = this._getSvgX(fromFile) + 32, fromY = this._getSvgY(fromRank) + 32;
    const toX = this._getSvgX(toFile) + 32, toY = this._getSvgY(toRank) + 32;
    const dx = toX - fromX, dy = toY - fromY, len = Math.hypot(dx, dy);
    if (!len) return;
    const ux = dx / len, uy = dy / len;
    const start = 12, end = 14;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', fromX + ux * start);
    line.setAttribute('y1', fromY + uy * start);
    line.setAttribute('x2', toX - ux * end);
    line.setAttribute('y2', toY - uy * end);
    line.setAttribute('stroke', '#3b82f6');
    line.setAttribute('stroke-width', '4');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#best-move-arrow)');
    this.layerArrows.appendChild(line);
  }

  _renderCurrentBestMoveArrow() {
    // Verde = melhor lance para o jogador que acabou de fazer o lance.
    // É a alternativa que o Stockfish encontrou na posição anterior ao lance.
    const uci = this.plyCurrentBestMoves[this.ply];
    if (!uci || uci.length < 4) return;
    const ns = 'http://www.w3.org/2000/svg';
    const fromFile = uci.charCodeAt(0) - 97, fromRank = parseInt(uci[1]) - 1;
    const toFile = uci.charCodeAt(2) - 97, toRank = parseInt(uci[3]) - 1;
    if (fromFile < 0 || fromFile > 7 || fromRank < 0 || fromRank > 7 || toFile < 0 || toFile > 7 || toRank < 0 || toRank > 7) return;
    const fromX = this._getSvgX(fromFile) + 32, fromY = this._getSvgY(fromRank) + 32;
    const toX = this._getSvgX(toFile) + 32, toY = this._getSvgY(toRank) + 32;
    const dx = toX - fromX, dy = toY - fromY, len = Math.hypot(dx, dy);
    if (!len) return;
    const ux = dx / len, uy = dy / len;
    const start = 12, end = 14;
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', fromX + ux * start);
    line.setAttribute('y1', fromY + uy * start);
    line.setAttribute('x2', toX - ux * end);
    line.setAttribute('y2', toY - uy * end);
    line.setAttribute('stroke', '#3aaa35');
    line.setAttribute('stroke-width', '4');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#current-best-move-arrow)');
    this.layerArrows.appendChild(line);
  }

  _renderHighlights() {
    const ns = 'http://www.w3.org/2000/svg'; this._clearHighlights();
    if (this.lastMove) {
      const classification = this.plyClassifications[this.ply] || 'ok';
      const { color, opacity } = this._classificationColor(classification);
      [this.lastMove.from, this.lastMove.to].forEach(sq => {
        const file = sq.charCodeAt(0) - 97;
        const rank = parseInt(sq[1]) - 1;
        const rect = document.createElementNS(ns, 'rect');
        rect.setAttribute('class', 'hl-lastmove');
        rect.setAttribute('x', this._getSvgX(file));
        rect.setAttribute('y', this._getSvgY(rank));
        rect.setAttribute('width', 64);
        rect.setAttribute('height', 64);
        rect.setAttribute('fill', color);
        rect.setAttribute('opacity', String(opacity));
        this.layerHighlights.appendChild(rect);
      });
    }
    if (this.checkSquare) { const coords = this.checkSquare.split(',').map(Number); const file = coords[0]; const rank = coords[1]; const rect = document.createElementNS(ns, 'rect'); rect.setAttribute('class', 'hl-check'); rect.setAttribute('x', this._getSvgX(file)); rect.setAttribute('y', this._getSvgY(rank)); rect.setAttribute('width', 64); rect.setAttribute('height', 64); rect.setAttribute('fill', 'rgba(220, 60, 60, 0.35)'); rect.setAttribute('filter', 'url(#check-pulse)'); this.layerHighlights.appendChild(rect); }
    if (this.selectedSquare) { const coords = this.selectedSquare.split(',').map(Number); const file = coords[0]; const rank = coords[1]; const rect = document.createElementNS(ns, 'rect'); rect.setAttribute('class', 'hl-selected'); rect.setAttribute('x', this._getSvgX(file)); rect.setAttribute('y', this._getSvgY(rank)); rect.setAttribute('width', 64); rect.setAttribute('height', 64); rect.setAttribute('fill', 'rgba(80, 140, 255, 0.35)'); this.layerHighlights.appendChild(rect); this.legalTargets.forEach(targetSq => { const tf = targetSq.charCodeAt(0) - 97; const tr = parseInt(targetSq[1]) - 1; const cx = this._getSvgX(tf) + 32; const cy = this._getSvgY(tr) + 32; const circle = document.createElementNS(ns, 'circle'); circle.setAttribute('class', 'hl-legal'); circle.setAttribute('cx', cx); circle.setAttribute('cy', cy); circle.setAttribute('r', 10); circle.setAttribute('fill', 'rgba(80, 140, 255, 0.5)'); this.layerHighlights.appendChild(circle); }); }
  }
  _getSvgX(file) { const orientedFile = this.options.orientation === 'white' ? file : 7 - file; return orientedFile * 64; }
  _getSvgY(rank) { const orientedRank = this.options.orientation === 'white' ? rank : 7 - rank; return (7 - orientedRank) * 64; }
// ==================== ANIMATION ====================
  async _animateToPosition() { this.isAnimating = true; this._renderPieces(); this._renderHighlights(); this._renderMoveIcon(); this._renderBestMoveArrow(); this._renderCurrentBestMoveArrow(); await new Promise(r => setTimeout(r, this.options.animationMs + 20)); this.isAnimating = false; }
  _animatePiece(element, fromCenter, toCenter) { const dx = toCenter.x - fromCenter.x; const dy = toCenter.y - fromCenter.y; element.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)'; return new Promise(r => setTimeout(r, this.options.animationMs)); }
// ==================== EVENTS ====================
  _bindEvents() { if (!this.options.draggable) return; this.svg.addEventListener('mousedown', e => this._onMouseDown(e)); this.svg.addEventListener('touchstart', e => this._onTouchStart(e), { passive: true }); }
  _onMouseDown(e) { if (this.isAnimating) return; const rect = e.target.closest('[data-square]'); if (!rect) return; const square = rect.dataset.square; this._handleSquareClick(square); }
  _onTouchStart(e) { if (this.isAnimating) return; const touch = e.touches[0]; const el = document.elementFromPoint(touch.clientX, touch.clientY); const rect = el?.closest('[data-square]'); if (!rect) return; const square = rect.dataset.square; this._handleSquareClick(square); }
  _handleSquareClick(square) { const file = square.charCodeAt(0) - 97; const rank = parseInt(square[1]) - 1; const key = file + ',' + rank; if (this.selectedSquare === key) { this.selectedSquare = null; this.legalTargets.clear(); } else if (this.selectedSquare && this.legalTargets.has(square)) { const from = this.selectedSquare; const to = square; this.selectedSquare = null; this.legalTargets.clear(); if (this.options.onMove) this.options.onMove(from, to); } else { const chess = new window.Chess(this.position); const piece = chess.get(square); if (piece && piece.color === chess.turn()) { this.selectedSquare = key; const moves = chess.moves({ square, verbose: true }); this.legalTargets = new Set(moves.map(m => m.to)); } } this._renderHighlights(); }
// ==================== PUBLIC API ====================
  setOrientation(color) { this.options.orientation = color; this._renderPieces(); this._renderHighlights(); }
  setShowCoords(show) { this.options.showCoords = show; this.layerCoords.style.display = show ? 'block' : 'none'; }
  setPlyIcons(map) { this.plyIcons = map || {}; this._renderMoveIcon(); }
  setPlyClassifications(map) { this.plyClassifications = map || {}; this._renderHighlights(); this._renderMoveIcon(); this._renderBestMoveArrow(); }
  setPlyBestMoves(map) { this.plyBestMoves = map || {}; this._renderBestMoveArrow(); }
  setPlyCurrentBestMoves(map) { this.plyCurrentBestMoves = map || {}; this._renderCurrentBestMoveArrow(); }
  destroy() { this.svg.remove(); }
  get currentPly() { return this.ply; } get maxPly() { return this.history.length - 1; } get currentFen() { return this.position; } get isAtStart() { return this.ply === 0; } get isAtEnd() { return this.ply === this.history.length - 1; }
}
// Helper para criar tabuleiro a partir de array de movimentos SAN
export function createBoardFromMoves(moves, options = {}) { const chess = new window.Chess(); const history = [{ fen: chess.fen(), san: null, from: null, to: null, promotion: null, flags: '' }]; for (const san of moves) { const move = chess.move(san, { sloppy: true }); if (!move) break; history.push({ fen: chess.fen(), san, from: move.from, to: move.to, promotion: move.promotion, flags: move.flags }); } const board = new ChessBoard(options.container, options); board.loadHistory(history); return board; }
