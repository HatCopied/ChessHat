// Wrapper do Stockfish (roda num Web Worker, então nunca trava a interface).
const STOCKFISH_PATH = '/stockfish/stockfish-19-lite-single.js';

export class ChessEngine {
  constructor() {
    this.worker = null;
    this.ready = null;
    this.current = null;
  }

  async init(multiPV = 1) {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      try { this.worker = new Worker(STOCKFISH_PATH); }
      catch (e) { reject(e); return; }
      let initialized = false;
      this.worker.onmessage = (ev) => {
        const line = typeof ev.data === 'string' ? ev.data.trim() : '';
        if (line === 'uciok' && !initialized) { initialized = true; this.worker.postMessage('isready'); }
        if (line === 'readyok') resolve();
        if (line.startsWith('bestmove')) this.finish(line);
      };
      this.worker.onerror = () => reject(new Error('Stockfish não pôde ser carregado. Rode "npm install" antes de iniciar.'));
      this.worker.postMessage('uci');
    });
    await this.ready;
    this.worker.postMessage('setoption name Threads value 1');
    this.worker.postMessage('setoption name Hash value 32');
    this.worker.postMessage(`setoption name MultiPV value ${multiPV}`);
    return this.ready;
  }

  finish(line, job) {
    if (!job) job = this.current;
    if (!job) return;
    this.current = null;
    clearTimeout(job.timer);
    const bestmove = line.split(/\s+/)[1] || null;
    const mainLine = job.lines[1] || {};
    job.resolve({
      bestmove,
      rawScore: mainLine.rawScore || job.rawScore,
      pv: mainLine.pv || [],
      secondPv: (job.lines[2] && job.lines[2].pv) || [],
      secondRawScore: (job.lines[2] && job.lines[2].rawScore) || null
    });
  }

  evaluate(fen, depth = 10, multiPV = 1) {
    return new Promise(async (resolve, reject) => {
      try {
        await this.init(multiPV);
        if (this.current) { reject(new Error('Motor ocupado.')); return; }
        const job = { resolve, reject, rawScore: null, lines: {} };
        job.timer = setTimeout(() => {
          if (this.current === job) { this.worker.postMessage('stop'); this.current = null; reject(new Error('Tempo excedido pelo Stockfish.')); }
        }, 20000);
        this.current = job;
        this.worker.onmessage = (ev) => {
          const line = typeof ev.data === 'string' ? ev.data.trim() : '';
          if (line.startsWith('info ') && line.includes(' score ')) {
            const mpvMatch = line.match(/multipv (\d+)/);
            const mpv = mpvMatch ? parseInt(mpvMatch[1]) : 1;
            const scoreMatch = line.match(/score (cp|mate) (-?\d+)/);
            const pvMatch = line.match(/pv ([\w\s]+)/);
            if (scoreMatch) {
              job.lines[mpv] = job.lines[mpv] || {};
              job.lines[mpv].rawScore = { type: scoreMatch[1], value: Number(scoreMatch[2]) };
            }
            if (pvMatch) {
              job.lines[mpv] = job.lines[mpv] || {};
              job.lines[mpv].pv = pvMatch[1].trim().split(/\s+/);
            }
          }
          if (line.startsWith('bestmove')) this.finish(line, job);
        };
        this.worker.postMessage('ucinewgame');
        this.worker.postMessage('position fen ' + fen);
        this.worker.postMessage('go depth ' + depth);
      } catch (e) { reject(e); }
    });
  }

  stop() { if (this.worker) this.worker.postMessage('stop'); }
  destroy() { if (this.worker) this.worker.terminate(); this.worker = null; this.ready = null; this.current = null; }
}

// ---------- Conversão de avaliação em "% de chance de vencer" ----------
// Mesma ideia usada por engines de precisão conhecidas: uma avaliação de
// +3.00 não é "3x melhor" que +1.00 em termos de chance real de vitória, a
// curva satura. Isso deixa a régua de erro mais parecida com a do chess.com
// (que também pensa em termos de % e não só em centipawns crus).
export function cpToWinPercent(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

export function scoreToWinPercent(rawScore) {
  if (!rawScore) return 50;
  if (rawScore.type === 'mate') return rawScore.value > 0 ? 100 : (rawScore.value < 0 ? 0 : 50);
  return cpToWinPercent(rawScore.value);
}

// Ícones reais do chess.com (copiados pra public/icon/). 32x pra listas
// compactas, svg pra qualquer coisa maior.
const ICONS = {
  brilliant: { small: '/icon/32x/brilliant_32x.png', svg: '/icon/svg/brilliant.svg' },
  excellent: { small: '/icon/32x/excellent_32x.png', svg: '/icon/svg/excellent.svg' },
  best: { small: '/icon/32x/best_32x.png', svg: '/icon/svg/best.svg' },
  ok: { small: '/icon/32x/good_32x.png', svg: '/icon/svg/good.svg' },
  inaccuracy: { small: '/icon/32x/inaccuracy_32x.png', svg: '/icon/svg/inaccuracy.svg' },
  mistake: { small: '/icon/32x/mistake_32x.png', svg: '/icon/svg/mistake.svg' },
  blunder: { small: '/icon/32x/blunder_32x.png', svg: '/icon/svg/blunder.svg' },
  missedWin: { small: '/icon/32x/missed_win_32x.png', svg: '/icon/svg/missed_win.svg' },
};

export function classifyByWinDrop(drop, meta = {}) {
  // O Chess.com atualmente usa Expected Points + regras especiais, então não
  // dá para reproduzir exatamente o classificador sem o modelo proprietário.
  // Aqui mantemos a mesma ideia, mas com uma regra explícita para "Chance perdida":
  // ela aparece quando o jogador tinha uma oportunidade realmente vencedora e
  // a desperdiçou, em vez de chamar automaticamente isso de Gafe.
  const build = (key, label) => ({ key, label, icon: ICONS[key].small, iconSvg: ICONS[key].svg });
  if (meta.brilliant && drop < 1) return build('brilliant', 'Brilhante');
  if (meta.missedWin) return build('missedWin', 'Chance perdida');
  if (drop < 0.75) return build('excellent', 'Excelente');
  if (drop < 1) return build('best', 'Melhor');
  if (drop < 5) return build('ok', 'Bom');
  if (drop < 10) return build('inaccuracy', 'Imprecisão');
  if (drop < 20) return build('mistake', 'Erro');
  return build('blunder', 'Grande erro');
}

// ---------- Detecção de sacrifício real (pra "Brilhante") ----------
// Heurística leve (não é SEE completo): depois do lance, a peça que se moveu
// precisa estar numa casa atacada por uma peça adversária mais barata (ou de
// valor igual), SEM que a gente tenha uma recaptura legal disponível ali.
// Ou seja, a peça fica de verdade pendurada/entregue — não só "deu um xeque"
// ou "capturou algo".
const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export function isRealSacrifice(ChessCtor, fenAfterMyMove, toSquare, movedPieceType) {
  try {
    const c1 = new ChessCtor(fenAfterMyMove);
    const attackers = c1.moves({ verbose: true }).filter((m) => m.to === toSquare && m.flags.includes('c'));
    if (!attackers.length) return false; // ninguém ataca a peça: não é sacrifício
    attackers.sort((a, b) => (PIECE_VALUE[a.piece] || 0) - (PIECE_VALUE[b.piece] || 0));
    const cheapest = attackers[0];
    const movedValue = PIECE_VALUE[movedPieceType] || 0;
    if (movedValue <= (PIECE_VALUE[cheapest.piece] || 0)) return false; // troca normal/favorável, não sacrifício

    const c2 = new ChessCtor(fenAfterMyMove);
    c2.move({ from: cheapest.from, to: cheapest.to, promotion: cheapest.promotion });
    const recaptures = c2.moves({ verbose: true }).filter((m) => m.to === toSquare && m.flags.includes('c'));
    return recaptures.length === 0; // se não dá pra reaver nada ali, a peça foi entregue de verdade
  } catch { return false; }
}

// Precisão de UM lance a partir da queda de % de vitória (fórmula do tipo
// usada por sites de análise de xadrez: cai suave perto de 0 e satura perto
// de 100/0).
export function moveAccuracyFromDrop(drop) {
  const acc = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

// Precisão da PARTIDA: não é média simples dos lances. Posições calmas (onde
// o % de vitória quase não muda) contam menos que posições voláteis (onde um
// erro pequeno vira uma virada grande) — por isso ponderamos cada lance pelo
// desvio-padrão do %-de-vitória numa janela ao redor dele. É o "cálculo um
// pouco mais difícil": desvio-padrão local (volatilidade) como peso de uma
// média ponderada.
export function computeGameAccuracy(drops, ownWinBefore) {
  const n = drops.length;
  if (!n) return null;
  const WINDOW = 4;
  let weightSum = 0, accSum = 0;
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - WINDOW), hi = Math.min(n, i + WINDOW + 1);
    const slice = ownWinBefore.slice(lo, hi);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length;
    const weight = Math.max(0.5, Math.sqrt(variance)); // piso pra posição "morta" não zerar o peso
    weightSum += weight;
    accSum += weight * moveAccuracyFromDrop(drops[i]);
  }
  return accSum / weightSum;
}

export function formatEval(rawScore) {
  if (!rawScore) return '—';
  if (rawScore.type === 'mate') return (rawScore.value > 0 ? '+M' : '-M') + Math.abs(rawScore.value);
  const cp = rawScore.value;
  return `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(1)}`;
}
