# Meu Xadrez

Dashboard pessoal para analisar suas partidas do Chess.com: aberturas, cores, onde você mais perde,
até onde as partidas chegam, tipos de final e revisão com Stockfish (roda no seu navegador).

## Recursos
- **Período de vários meses** numa consulta só (1 a 24 meses, terminando no mês escolhido).
- **Cache em disco** (`cache/<usuario>/AAAA-MM.json`): meses passados ficam guardados pra sempre
  (não mudam mais); o mês corrente expira em 10 minutos. Só meses novos batem na API do Chess.com,
  com pausa de 150 ms entre chamadas, então dá pra puxar bastante histórico sem sobrecarregar.
- **Estatísticas:** resultado geral, por cor, por modo, aberturas mais jogadas, aberturas onde você mais
  perde (mín. 3 partidas), fase em que as partidas terminam, partida mais longa, tipos de final
  (damas, torres, peças menores, peões) e posições em que você repete escolhas.
- **Revisão com Stockfish 19 (lite, WASM, Web Worker):** prioriza suas derrotas mais recentes.
  - Avaliação convertida em **% de chance de vitória** (curva logística).
  - Classificação por queda de %: Ótimo, Bom, Imprecisão, Erro, Grande erro.
  - **Precisão da partida** = média ponderada da precisão de cada lance, com peso igual ao
    desvio-padrão do % de vitória numa janela de ±4 lances (posições voláteis pesam mais que as calmas).
  - Taxa de erros **nos finais** e tabela com os 40 piores lances.
  - Configurável: nº de partidas, lances por partida e profundidade. Botão "Parar" disponível.

## Rodar
```bash
npm install
npm start
```
Abra `http://localhost:3000`.

## Desempenho
- A busca de meses é leve e cacheada; a parte pesada é o Stockfish (fica no seu navegador, não no servidor).
- Comece com 10 partidas, profundidade "Normal" e 40 lances por partida; aumente depois.
- A PubAPI do Chess.com é somente leitura; defina `CHESSCOM_USER_AGENT` com seu contato se for publicar o app.
