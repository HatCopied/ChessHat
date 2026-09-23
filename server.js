import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// O Chess.com pede pra identificar o app + um contato no User-Agent da PubAPI.
const API_UA = process.env.CHESSCOM_USER_AGENT || 'MeuXadrez/1.2 (personal chess analysis project; contact: local)';

const CACHE_DIR = path.join(__dirname, 'cache');
const MAX_MONTHS_PER_RANGE = 24;        // trava de segurança: não martelar o Chess.com de uma vez só
const CURRENT_MONTH_TTL_MS = 10 * 60 * 1000; // o mês corrente muda o tempo todo -> cache curto
const LIVE_FETCH_DELAY_MS = 150;        // pequena pausa entre chamadas ao vivo consecutivas

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

function validUser(u) { return /^[A-Za-z0-9_-]{1,30}$/.test(u); }
function validYM(y, m) { return /^\d{4}$/.test(String(y)) && /^(?:[1-9]|1[0-2])$/.test(String(Number(m))); }

function isPastMonth(y, m) {
  const now = new Date();
  const cy = now.getFullYear(), cm = now.getMonth() + 1;
  y = Number(y); m = Number(m);
  return y < cy || (y === cy && m < cm);
}

function cacheFile(user, y, m) {
  return path.join(CACHE_DIR, user.toLowerCase(), `${y}-${String(m).padStart(2, '0')}.json`);
}

async function readCache(file, maxAgeMs) {
  try {
    const stat = await fs.stat(file);
    if (maxAgeMs != null && (Date.now() - stat.mtimeMs) > maxAgeMs) return null;
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null; // não existe, corrompido ou expirou -> busca de novo
  }
}

async function writeCache(file, data) {
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data));
  } catch (e) {
    console.warn('Não consegui gravar cache:', e.message);
  }
}

async function chess(url, accept) {
  const r = await fetch(url, { headers: { 'User-Agent': API_UA, Accept: accept } });
  if (!r.ok) {
    let msg = `Chess.com respondeu ${r.status}.`;
    try { msg = (await r.json()).message || msg; } catch {}
    throw Object.assign(new Error(msg), { status: r.status });
  }
  return r;
}

// Busca um mês, usando cache em disco quando possível.
// Meses passados: cache permanente (a partida de 2019 não muda mais).
// Mês corrente: cache curto, porque novas partidas continuam entrando nele.
async function fetchMonth(user, y, m) {
  const file = cacheFile(user, y, m);
  const past = isPastMonth(y, m);
  const cached = await readCache(file, past ? null : CURRENT_MONTH_TTL_MS);
  if (cached) return { data: cached, fromCache: true };

  const data = await (await chess(
    `https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/${y}/${String(m).padStart(2, '0')}`,
    'application/json'
  )).json();
  await writeCache(file, data);
  return { data, fromCache: false };
}

app.get('/api/archives/:username', async (req, res) => {
  try {
    const u = req.params.username;
    if (!validUser(u)) return res.status(400).json({ error: 'Nome inválido.' });
    res.json(await (await chess(
      `https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`,
      'application/json'
    )).json());
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.get('/api/games/:username/:year/:month', async (req, res) => {
  try {
    const { username: u, year: y, month: m } = req.params;
    if (!validUser(u) || !validYM(y, m)) return res.status(400).json({ error: 'Parâmetros inválidos.' });
    const { data, fromCache } = await fetchMonth(u, y, m);
    res.json({ ...data, fromCache });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

// Busca um PERÍODO (vários meses) de uma vez, pra juntar bastante partida sem
// precisar clicar mês a mês. Meses já cacheados voltam na hora; só os meses
// novos/faltando batem na API de verdade, com uma pequena pausa entre chamadas
// ao vivo pra ser gentil com o Chess.com.
app.get('/api/range/:username/:fromY/:fromM/:toY/:toM', async (req, res) => {
  try {
    const { username: u, fromY, fromM, toY, toM } = req.params;
    if (!validUser(u) || !validYM(fromY, fromM) || !validYM(toY, toM)) {
      return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }
    let y = Number(fromY), m = Number(fromM);
    const endY = Number(toY), endM = Number(toM);
    if (y > endY || (y === endY && m > endM)) {
      return res.status(400).json({ error: 'O período termina antes de começar.' });
    }
    const months = [];
    while (y < endY || (y === endY && m <= endM)) {
      months.push([y, m]);
      m++; if (m > 12) { m = 1; y++; }
    }
    if (months.length > MAX_MONTHS_PER_RANGE) {
      return res.status(400).json({ error: `Período muito longo (máx. ${MAX_MONTHS_PER_RANGE} meses por consulta, pra não sobrecarregar a API do Chess.com).` });
    }

    const monthsOut = [];
    let cacheHits = 0, liveFetches = 0, notFound = 0;
    for (const [yy, mm] of months) {
      try {
        const { data, fromCache } = await fetchMonth(u, yy, mm);
        if (fromCache) cacheHits++; else { liveFetches++; await new Promise(r => setTimeout(r, LIVE_FETCH_DELAY_MS)); }
        monthsOut.push({ year: yy, month: mm, games: data.games || [] });
      } catch (e) {
        // mês sem dados (ex.: antes de o jogador entrar no Chess.com) não deve derrubar o período todo
        if (e.status === 404) { notFound++; monthsOut.push({ year: yy, month: mm, games: [] }); }
        else throw e;
      }
    }
    if (notFound === months.length) {
      return res.status(404).json({ error: 'Nenhum dado encontrado pra esse usuário nesse período (confira o nome de usuário).' });
    }

    res.json({ months: monthsOut, monthsRequested: months.length, cacheHits, liveFetches });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message });
  }
});

app.get('/stockfish/:file', (req, res) => {
  const allowed = new Set(['stockfish-19-lite-single.js', 'stockfish-19-lite-single.wasm']);
  if (!allowed.has(req.params.file)) return res.sendStatus(404);
  res.sendFile(path.join(__dirname, 'node_modules', 'stockfish', 'bin', req.params.file));
});

app.get('/{*splat}', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Meu Xadrez em http://localhost:${PORT} (cache em ${CACHE_DIR})`));
