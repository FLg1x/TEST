// ==UserScript==
// @name         Chess.com Cheat Assist v57 (Mobile Tap Fix)
// @name:ru      Chess.com Cheat Assist v57 (Фикс тапа)
// @namespace    http://tampermonkey.net/
// @version      57.0
// @description  Stockfish CDN Assist with Mobile Tap Fix.
// @description:ru Помощник для Chess.com с фиксом тапа по пешке.
// @author       urs_ditch (patched by LO & ENI)
// @license      CC BY-NC-ND 4.0
// @match        https://www.chess.com/*
// @grant        GM_xmlhttpRequest
// @connect      cdnjs.cloudflare.com
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const STOCKFISH_WASM_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
    const CHESS_JS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js';

    const script = document.createElement('script');
    script.src = CHESS_JS_CDN;
    document.head.appendChild(script);

    let engine = null;
    let isCalculating = false;
    let isEngineReady = false;
    let currentFen = '';
    let multipvMoves = [];
    let currentMode = 'j';
    
    let activeLine = [];       
    let lineBaseFen = '';      
    
    let isFastChaining = false;
    let chainStep = 0;
    let chainFen = '';
    let chainMoves = [];
    
    let isChoosingFuture = false;
    let futureMovesCount = 10;
    
    let myColor = 'w'; 
    let manualColor = localStorage.getItem('chess_assist_color');
    if (manualColor !== 'w' && manualColor !== 'b') manualColor = null;

    let forceFlipped = localStorage.getItem('chess_assist_flip') === 'true';

    const PIECE_VALUES = { p: 1, n: 3.05, b: 3.33, r: 5.63, q: 9.5, k: 0 };

    const FAST_TRAP_DATABASE = {
        'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -': 'c6d4',
        'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -': 'c4g8',
        'r1bqkb1r/ppp2ppp/2np1n2/4p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq -': 'f3e5',
        'r1bqk2r/pppp1ppp/2n2n2/4p3/1b2P3/2NP1N2/PPP2PPP/R1BQKB1R w KQkq -': 'f3e5',
        'rnbqk2r/ppp1bppp/4pn2/3p4/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq -': 'e4e5',
        'r1bqkb1r/pppp1ppp/2n5/4P3/1b6/2N2N2/PPP1PPPP/R1BQKB1R b KQkq -': 'g4e5'
    };

    const hideDefaultHighlightStyle = document.createElement('style');
    hideDefaultHighlightStyle.textContent = `
        chess-board .highlight, wc-chess-board .highlight {
            display: none !important;
            opacity: 0 !important;
        }
    `;
    (document.head || document.documentElement).appendChild(hideDefaultHighlightStyle);

    const overlayHost = document.createElement('div');
    overlayHost.id = 'app-root-' + Math.random().toString(36).substring(2, 9);
    document.documentElement.appendChild(overlayHost);

    const shadow = overlayHost.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = `
        .status-box {
            position: fixed; bottom: 15px; right: 15px; 
            padding: 10px;
            background: rgba(16, 18, 24, 0.95);
            color: #e2e8f0;
            font-family: 'Segoe UI', Roboto, sans-serif;
            font-size: 13px; font-weight: 600;
            border-radius: 12px; z-index: 2147483647;
            border: 1px solid rgba(255, 255, 255, 0.15);
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
            transition: all 0.2s ease;
            display: flex; flex-direction: column; gap: 6px;
            max-width: 95vw;
        }

        .status-top { display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; padding: 4px; pointer-events: auto; }
        .piece-icon { font-size: 24px; line-height: 1; }
        .mode-text { text-align: center; display: none; }
        .move-text { font-size: 12px; color: #94a3b8; text-align: center; word-break: break-all; padding: 0 4px; display: none; }

        .btn-row { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap; pointer-events: auto; }
        
        .ctrl-btn {
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: #fff; font-weight: 700; font-size: 12px;
            border-radius: 6px; padding: 6px 10px;
            cursor: pointer; flex: 1;
            display: flex; align-items: center; justify-content: center;
            transition: all 0.1s ease;
            -webkit-tap-highlight-color: transparent;
            white-space: nowrap;
        }
        .ctrl-btn:active { background: rgba(255, 255, 255, 0.3); transform: scale(0.95); }
        
        .btn-k { background: rgba(0, 212, 255, 0.2); border-color: rgba(0, 212, 255, 0.5); }
        .btn-u { background: rgba(34, 197, 94, 0.2); border-color: rgba(34, 197, 94, 0.5); }
        .btn-f1 { background: rgba(251, 191, 36, 0.2); border-color: rgba(251, 191, 36, 0.5); }
        .small-btn { flex: 0.5; padding: 6px 0; }

        .status-box.collapsed {
            padding: 0;
            border-radius: 50%;
            width: 56px; height: 56px;
            bottom: 20px; right: 20px;
            display: flex; align-items: center; justify-content: center;
            background: rgba(16, 18, 24, 0.95);
            border: 2px solid rgba(0, 255, 136, 0.4);
            box-shadow: 0 0 15px rgba(0, 255, 136, 0.2);
        }
        .status-box.collapsed .btn-row,
        .status-box.collapsed .mode-text,
        .status-box.collapsed .move-text {
            display: none;
        }
        .status-box.collapsed .status-top { padding: 0; gap: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
        .status-box.collapsed .piece-icon { font-size: 32px; }

        .highlight-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 9998; }

        .hl-sq { position: absolute; width: 12.5%; height: 12.5%; box-sizing: border-box; border-radius: 6px; transition: all 0.2s ease; }

        .hl-std-from { border: 2px solid rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.1); }
        .hl-std-to { border: 3px solid rgba(255, 255, 255, 0.9); background: rgba(255, 255, 255, 0.2); box-shadow: 0 0 12px rgba(255, 255, 255, 0.3); }

        .hl-brilliant-from { border: 2px solid rgba(0, 220, 255, 0.7); background: rgba(0, 220, 255, 0.1); }
        .hl-brilliant-to { border: 3px solid rgba(0, 220, 255, 1); background: rgba(0, 220, 255, 0.2); box-shadow: 0 0 12px rgba(0, 220, 255, 0.4); }

        .hl-trap-from { border: 2px solid rgba(255, 170, 0, 0.7); background: rgba(255, 170, 0, 0.1); }
        .hl-trap-to { border: 3px solid rgba(255, 170, 0, 1); background: rgba(255, 170, 0, 0.2); box-shadow: 0 0 12px rgba(255, 170, 0, 0.4); }
    `;
    shadow.appendChild(styleEl);

    const statusBox = document.createElement('div');
    statusBox.className = 'status-box collapsed';
    statusBox.innerHTML = `
        <div class="status-top" id="status-toggle">
            <span class="piece-icon" id="pawn-btn">♟️</span>
            <span class="mode-text" style="color:#00ff88;">Ready</span>
        </div>
        <div class="move-text" id="moves-text"></div>
        <div class="btn-row" style="display:none;">
            <button class="ctrl-btn btn-k" id="btn-k">K</button>
            <button class="ctrl-btn btn-u" id="btn-u">U</button>
            <button class="ctrl-btn btn-f1" id="btn-f1">F1</button>
        </div>
        <div class="btn-row" style="display:none;">
            <button class="ctrl-btn small-btn" id="btn-f2">🔄</button>
            <button class="ctrl-btn small-btn" id="btn-f3">🔃</button>
            <button class="ctrl-btn small-btn" id="btn-l">🧹</button>
        </div>
    `;
    shadow.appendChild(statusBox);

    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'highlight-layer';
    shadow.appendChild(highlightLayer);

    // ФИКС ТАПА
    const toggleBtn = document.getElementById('status-toggle');
    toggleBtn.style.pointerEvents = 'auto';
    toggleBtn.style.cursor = 'pointer';

    const handleTap = (e) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (statusBox.classList.contains('collapsed')) {
            handleAction('j');
            const pb = document.getElementById('pawn-btn');
            if (pb) {
                pb.style.transform = 'scale(0.8)';
                setTimeout(() => pb.style.transform = 'scale(1)', 100);
            }
        } else {
            statusBox.classList.add('collapsed');
        }
    };

    toggleBtn.addEventListener('click', handleTap);
    toggleBtn.addEventListener('touchstart', handleTap, {passive: false});

    let pressTimer;
    toggleBtn.addEventListener('touchstart', () => {
        pressTimer = setTimeout(() => {
            statusBox.classList.remove('collapsed');
            shadow.querySelectorAll('.btn-row').forEach(el => el.style.display = 'flex');
        }, 500);
    });
    toggleBtn.addEventListener('touchend', () => clearTimeout(pressTimer));
    toggleBtn.addEventListener('touchmove', () => clearTimeout(pressTimer));

    document.getElementById('btn-k').addEventListener('click', (e) => { e.stopPropagation(); handleAction('k'); });
    document.getElementById('btn-u').addEventListener('click', (e) => { e.stopPropagation(); handleAction('u'); });
    document.getElementById('btn-f1').addEventListener('click', (e) => { e.stopPropagation(); handleAction('f1'); });
    document.getElementById('btn-f2').addEventListener('click', (e) => { e.stopPropagation(); handleAction('f2'); });
    document.getElementById('btn-f3').addEventListener('click', (e) => { e.stopPropagation(); handleAction('f3'); });
    document.getElementById('btn-l').addEventListener('click', (e) => { e.stopPropagation(); handleAction('l'); });

    function setStatus(icon, prefix, movesArray = [], color = '#e2e8f0') {
        document.getElementById('pawn-btn').textContent = icon;
        statusBox.querySelector('.mode-text').textContent = prefix;
        statusBox.querySelector('.mode-text').style.color = color;
        
        let movesHtml = '';
        if (movesArray.length > 0) {
            movesHtml = movesArray.map(m => `<span style="opacity:0.9">${m}</span>`).join(' → ');
        }
        document.getElementById('moves-text').innerHTML = movesHtml;
    }

    async function initEngine() {
        try {
            const loadScript = new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: "GET",
                    url: STOCKFISH_WASM_WORKER,
                    onload: function(response) {
                        if (response.status === 200 || response.status === 0) resolve(response.responseText);
                        else reject(new Error("Status " + response.status));
                    },
                    onerror: function(err) { reject(err); }
                });
            });

            const content = await loadScript;
            const blob = new Blob([content], { type: 'application/javascript' });
            engine = new Worker(URL.createObjectURL(blob));

            engine.onmessage = function (e) {
                const line = e.data;
                if (line === 'uciok') {
                    engine.postMessage('setoption name Hash value 64');
                    engine.postMessage('setoption name Threads value 2');
                    engine.postMessage('setoption name MultiPV value 10');
                    engine.postMessage('isready');
                } else if (line === 'readyok') {
                    isEngineReady = true;
                    setStatus('♟️', 'Tap for J', [], '#00ff88');
                } else if (line.includes('multipv')) {
                    parseMultiPVLine(line);
                } else if (line.startsWith('bestmove')) {
                    processBestMove();
                    isCalculating = false;
                }
            };
            engine.postMessage('uci');
        } catch (err) {
            setStatus('⚠️', 'Error', [], '#ff5555');
        }
    }

    function parseMultiPVLine(line) {
        const pvMatch = line.match(/pv\s+([a-h][1-8][a-h][1-8][qrbn]?.*)/);
        const cpMatch = line.match(/score\s+cp\s+(-?\d+)/);
        const mateMatch = line.match(/score\s+mate\s+(-?\d+)/);

        if (pvMatch) {
            const fullPv = pvMatch[1].trim();
            const move = fullPv.split(' ')[0];
            let score = 0, isMate = false, mateIn = 0;

            if (mateMatch) {
                isMate = true; mateIn = parseInt(mateMatch[1]);
                score = mateIn > 0 ? (100000 - mateIn) : (-100000 - mateIn);
            } else if (cpMatch) {
                score = parseInt(cpMatch[1]);
            }

            const idx = multipvMoves.findIndex(m => m.move === move);
            if (idx !== -1) multipvMoves[idx] = { ...multipvMoves[idx], score, isMate, mateIn, pv: fullPv };
            else multipvMoves.push({ move, score, isMate, mateIn, pv: fullPv });
        }
    }

    function processBestMove() {
        if (!multipvMoves.length) { setStatus('⚠️', 'No move', [], '#ff5555'); return; }

        multipvMoves.sort((a, b) => b.score - a.score);
        let selectedMove = multipvMoves[0].move;

        if (isFastChaining) {
            const game = new Chess(chainFen);
            const turn = game.turn();
            if (turn === myColor) chainMoves.push(selectedMove);

            const moveObj = game.move({ from: selectedMove.slice(0, 2), to: selectedMove.slice(2, 4), promotion: selectedMove.length > 4 ? selectedMove[4] : 'q' });
            if (!moveObj) {
                isFastChaining = false; activeLine = [...chainMoves]; lineBaseFen = currentFen;
                if (activeLine.length > 0) highlightMove(activeLine, false, false);
                setStatus('♟', 'Fast-3', activeLine, '#00d4ff');
                return;
            }

            chainFen = game.fen(); chainStep++;
            if (chainMoves.length >= 3 || chainStep >= 5) {
                isFastChaining = false; activeLine = [...chainMoves]; lineBaseFen = currentFen;
                highlightMove(activeLine, false, false);
                setStatus('♟', 'Fast-3', activeLine, '#00d4ff');
                return;
            }

            multipvMoves = []; isCalculating = true;
            setStatus('⏳', `Fast-3: ${chainMoves.length + 1}/3...`, [], '#00e5ff');
            engine.postMessage(`position fen ${chainFen}`); engine.postMessage(`go movetime 1000`);
            return;
        }

        let selectedPv = multipvMoves[0].pv || selectedMove;
        let isBrilliant = false, isMate = false, mateDistance = 0;
        const turnIsWhite = currentFen.split(' ')[1] === 'w';
        const isMyTurn = (turnIsWhite && myColor === 'w') || (!turnIsWhite && myColor === 'b');

        if (currentMode === 'k') {
            const mateLine = multipvMoves.find(m => m.isMate && m.mateIn > 0 && m.mateIn <= 6);
            if (mateLine) {
                selectedMove = mateLine.move; selectedPv = mateLine.pv; isMate = true; mateDistance = mateLine.mateIn;
            } else {
                const bestScore = multipvMoves[0].score;
                for (let i = 0; i < multipvMoves.length; i++) {
                    const item = multipvMoves[i];
                    if (bestScore - item.score <= 40 && isStrictSacrifice(item.move, currentFen)) {
                        selectedMove = item.move; selectedPv = item.pv; isBrilliant = true; break;
                    }
                }
            }
        } else if (currentMode === 'j') {
            const bestScore = multipvMoves[0].score;
            for (let i = 0; i < multipvMoves.length; i++) {
                const item = multipvMoves[i];
                if (bestScore - item.score <= 25 && isStrictSacrifice(item.move, currentFen)) {
                    selectedMove = item.move; selectedPv = item.pv; isBrilliant = true; break;
                }
            }
        } else if (currentMode === 'f1') {
            selectedMove = multipvMoves[0].move; selectedPv = multipvMoves[0].pv;
            isMate = multipvMoves[0].isMate; mateDistance = multipvMoves[0].mateIn;
        }

        const pvMoves = selectedPv.split(' ').filter(m => m.length >= 4);
        let ourMoves = [];
        if (currentMode === 'k' || currentMode === 'f1') {
            for (let i = 0; i < pvMoves.length; i++) {
                const isMyMoveInPv = (i % 2 === 0 && isMyTurn) || (i % 2 === 1 && !isMyTurn);
                if (isMyMoveInPv) {
                    ourMoves.push(pvMoves[i]);
                    if (ourMoves.length === (currentMode === 'k' ? 3 : futureMovesCount)) break;
                }
            }
        } else ourMoves = [selectedMove];

        activeLine = [...ourMoves]; lineBaseFen = currentFen;
        if (ourMoves.length > 0) highlightMove(ourMoves, isBrilliant, isMate);

        let pieceIcon = '♟';
        if (currentFen) {
            const boardMap = parseFenToBoard(currentFen);
            const firstMove = ourMoves[0];
            if (firstMove) {
                const piece = boardMap[firstMove.slice(0, 2)];
                if (piece) {
                    const icons = { 'P': '♙', 'N': '♘', 'B': '♗', 'R': '♖', 'Q': '♕', 'K': '♔', 'p': '♟', 'n': '♞', 'b': '♝', 'r': '♜', 'q': '♛', 'k': '♚' };
                    pieceIcon = icons[piece] || '♟';
                }
            }
        }

        const modeText = currentMode === 'f1' ? `${futureMovesCount}-Move` : (isMate ? `MATE IN ${mateDistance}` : (isBrilliant ? `Brilliant` : `Move`));
        const color = (isMate || isBrilliant || currentMode === 'f1') ? '#00d4ff' : '#ff6b6b';
        setStatus(pieceIcon, modeText, ourMoves, color);
    }

    function isSquareAttackedByEnemy(targetSq, enemyIsWhite, boardMap) { return getMinimumAttackerValue(targetSq, enemyIsWhite, boardMap) < 999; }

    function getMinimumAttackerValue(targetSq, enemyIsWhite, boardMap) {
        let minVal = 999;
        const file = targetSq.charCodeAt(0) - 97, rank = parseInt(targetSq[1]);
        const enemyKingPiece = enemyIsWhite ? 'K' : 'k';
        let enemyKingSq = null;
        for (let sq in boardMap) if (boardMap[sq] === enemyKingPiece) { enemyKingSq = sq; break; }
        
        function isPiecePinned(fromSq) {
            if (!enemyKingSq || fromSq === enemyKingSq) return false;
            const tempMap = { ...boardMap }; delete tempMap[fromSq];
            return isRayAttacked(enemyKingSq, !enemyIsWhite, tempMap);
        }
        
        const pawnPushes = enemyIsWhite ? [[-1, -1], [1, -1]] : [[-1, 1], [1, 1]];
        const enemyPawn = enemyIsWhite ? 'P' : 'p';
        for (let [df, dr] of pawnPushes) {
            const sq = String.fromCharCode(97 + file + df) + (rank + dr);
            if (boardMap[sq] === enemyPawn && !isPiecePinned(sq)) minVal = Math.min(minVal, PIECE_VALUES['p']);
        }
        
        const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        const enemyKnight = enemyIsWhite ? 'N' : 'n';
        for (let [df, dr] of knightMoves) {
            const sq = String.fromCharCode(97 + file + df) + (rank + dr);
            if (boardMap[sq] === enemyKnight && !isPiecePinned(sq)) minVal = Math.min(minVal, PIECE_VALUES['n']);
        }
        
        const bishopDirections = [[1,1], [1,-1], [-1,1], [-1,-1]];
        const enemyBishop = enemyIsWhite ? 'B' : 'b', enemyQueen = enemyIsWhite ? 'Q' : 'q';
        for (let [df, dr] of bishopDirections) {
            let f = file + df, r = rank + dr;
            while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
                const sq = String.fromCharCode(97 + f) + r, piece = boardMap[sq];
                if (piece) {
                    if ((piece === enemyBishop || piece === enemyQueen) && !isPiecePinned(sq)) minVal = Math.min(minVal, PIECE_VALUES[piece.toLowerCase()]);
                    break;
                }
                f += df; r += dr;
            }
        }
        
        const rookDirections = [[1,0], [-1,0], [0,1], [0,-1]];
        const enemyRook = enemyIsWhite ? 'R' : 'r';
        for (let [df, dr] of rookDirections) {
            let f = file + df, r = rank + dr;
            while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
                const sq = String.fromCharCode(97 + f) + r, piece = boardMap[sq];
                if (piece) {
                    if ((piece === enemyRook || piece === enemyQueen) && !isPiecePinned(sq)) minVal = Math.min(minVal, PIECE_VALUES[piece.toLowerCase()]);
                    break;
                }
                f += df; r += dr;
            }
        }
        
        const kingMoves = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
        for (let [df, dr] of kingMoves) {
            const sq = String.fromCharCode(97 + file + df) + (rank + dr);
            if (boardMap[sq] === enemyKingPiece) minVal = Math.min(minVal, 0);
        }
        return minVal;
    }

    function isRayAttacked(targetSq, enemyIsWhite, boardMap) {
        const file = targetSq.charCodeAt(0) - 97, rank = parseInt(targetSq[1]);
        const bishopDirections = [[1,1], [1,-1], [-1,1], [-1,-1]];
        const enemyBishop = enemyIsWhite ? 'B' : 'b', enemyQueen = enemyIsWhite ? 'Q' : 'q';
        for (let [df, dr] of bishopDirections) {
            let f = file + df, r = rank + dr;
            while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
                const sq = String.fromCharCode(97 + f) + r, piece = boardMap[sq];
                if (piece) {
                    if (piece === enemyBishop || piece === enemyQueen) return true;
                    break;
                }
                f += df; r += dr;
            }
        }
        const rookDirections = [[1,0], [-1,0], [0,1], [0,-1]];
        const enemyRook = enemyIsWhite ? 'R' : 'r';
        for (let [df, dr] of rookDirections) {
            let f = file + df, r = rank + dr;
            while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
                const sq = String.fromCharCode(97 + f) + r, piece = boardMap[sq];
                if (piece) {
                    if (piece === enemyRook || piece === enemyQueen) return true;
                    break;
                }
                f += df; r += dr;
            }
        }
        return false;
    }

    function isStrictSacrifice(move, fen) {
        const fromSq = move.slice(0, 2), toSq = move.slice(2, 4);
        const boardMap = parseFenToBoard(fen), movingPiece = boardMap[fromSq], targetPiece = boardMap[toSq];
        if (!movingPiece) return false;
        const isWhite = movingPiece === movingPiece.toUpperCase();
        const movingVal = PIECE_VALUES[movingPiece.toLowerCase()], targetVal = targetPiece ? PIECE_VALUES[targetPiece.toLowerCase()] : 0;
        const nextBoardMap = { ...boardMap }; delete nextBoardMap[fromSq]; nextBoardMap[toSq] = movingPiece;
        if (targetPiece && (movingVal - targetVal >= 1.8)) {
            if (isSquareAttackedByEnemy(toSq, !isWhite, nextBoardMap)) return true;
        }
        if (movingVal > 1.0 && !targetPiece) {
            const isAttackedOnTarget = isSquareAttackedByEnemy(toSq, !isWhite, nextBoardMap);
            const isDefendedOnTarget = isSquareAttackedByEnemy(toSq, isWhite, nextBoardMap);
            if (isAttackedOnTarget && (!isDefendedOnTarget || getMinimumAttackerValue(toSq, !isWhite, nextBoardMap) < movingVal)) {
                if (!isSquareAttackedByEnemy(fromSq, !isWhite, boardMap)) return true;
            }
        }
        return false;
    }

    function parseFenToBoard(fen) {
        const map = {}; if (!fen) return map;
        const fenBoard = fen.split(' ')[0], rows = fenBoard.split('/');
        for (let r = 0; r < 8; r++) {
            let c = 0;
            for (let char of rows[r]) {
                if (!isNaN(char)) c += parseInt(char);
                else { map[`${String.fromCharCode(97 + c)}${8 - r}`] = char; c++; }
            }
        }
        return map;
    }

    function detectMyColor() {
        if (manualColor) return manualColor;
        const board = document.querySelector('chess-board, wc-chess-board');
        if (!board) return 'w';
        if (board.classList.contains('flipped')) return 'b';
        const coords = document.querySelectorAll('.coordinate-light, .coordinate-dark');
        if (coords.length > 0) {
            const firstCoord = coords[0].textContent.trim();
            if (firstCoord === 'h' || firstCoord === '1') return 'b';
        }
        const fen = board.game ? board.game.getFEN() : null;
        if (fen) {
            const turn = fen.split(' ')[1], boardStr = fen.split(' ')[0];
            const kingChar = turn === 'w' ? 'K' : 'k'; 
            let kingRow = -1; const rows = boardStr.split('/');
            for (let i = 0; i < 8; i++) if (rows[i].includes(kingChar)) { kingRow = i; break; }
            if (kingRow >= 0 && kingRow <= 2) return 'b';
            if (kingRow >= 5 && kingRow <= 7) return 'w';
        }
        return 'w'; 
    }

    setInterval(() => {
        const board = document.querySelector('chess-board, wc-chess-board');
        if (board) myColor = detectMyColor();
    }, 500);

    function getFEN() {
        try {
            const board = document.querySelector('chess-board, wc-chess-board');
            if (board && board.game && typeof board.game.getFEN === 'function') { myColor = detectMyColor(); return board.game.getFEN(); }
            if (board && board.controller && typeof board.controller.getFEN === 'function') { myColor = detectMyColor(); return board.controller.getFEN(); }
        } catch (e) {}
        return null;
    }

    function highlightMove(uciMoves, isBrilliant = false, isMate = false) {
        removeHighlights();
        const boardNode = document.querySelector('chess-board, wc-chess-board');
        if (!boardNode) return;
        const rect = boardNode.getBoundingClientRect();
        highlightLayer.style.left = `${rect.left + window.scrollX}px`; highlightLayer.style.top = `${rect.top + window.scrollY}px`;
        highlightLayer.style.width = `${rect.width}px`; highlightLayer.style.height = `${rect.height}px`;

        const classFrom = isBrilliant || isMate ? 'hl-brilliant-from' : 'hl-std-from';
        const classTo = isBrilliant || isMate ? 'hl-brilliant-to' : 'hl-std-to';
        const arrowColor = isBrilliant || isMate ? 'rgba(0, 220, 255, 0.8)' : 'rgba(255, 255, 255, 0.6)';
        const cellCounts = {};
        uciMoves.forEach(move => { const toSq = move.slice(2, 4); if (!cellCounts[toSq]) cellCounts[toSq] = 0; });

        uciMoves.forEach((move, index) => {
            const fromSq = getSquareCoords(move.slice(0, 2), boardNode);
            const toSqStr = move.slice(2, 4);
            const toSq = getSquareCoords(toSqStr, boardNode);
            
            if (fromSq && toSq) {
                createSquare(fromSq, classFrom, index, index + 1, false, 0);
                const cornerIndex = cellCounts[toSqStr] || 0;
                cellCounts[toSqStr]++; 
                createSquare(toSq, classTo, index, index + 1, true, cornerIndex);

                const fromCenterX = (fromSq.col * 12.5 + 6.25) * rect.width / 100;
                const fromCenterY = (fromSq.row * 12.5 + 6.25) * rect.height / 100;
                const toCenterX = (toSq.col * 12.5 + 6.25) * rect.width / 100;
                const toCenterY = (toSq.row * 12.5 + 6.25) * rect.height / 100;
                const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                svg.style.position = "absolute"; svg.style.top = "0"; svg.style.left = "0";
                svg.style.width = "100%"; svg.style.height = "100%"; svg.style.pointerEvents = "none"; svg.style.zIndex = "9998";
                
                let opacity, strokeWidth, strokeDash;
                if (index < 3) { opacity = 0.9 - index * 0.2; strokeWidth = 6 - index * 1.5; strokeDash = "none"; }
                else { opacity = Math.max(0.05, 0.3 - (index - 3) * 0.02); strokeWidth = 1.5; strokeDash = "4,4"; }

                svg.innerHTML = `<line x1="${fromCenterX}" y1="${fromCenterY}" x2="${toCenterX}" y2="${toCenterY}" stroke="${arrowColor}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-dasharray="${strokeDash}" opacity="${opacity}" />`;
                highlightLayer.appendChild(svg);
            }
        });
    }

    function getSquareCoords(squareStr, boardNode) {
        const file = squareStr.charCodeAt(0) - 97;
        const rank = parseInt(squareStr[1]) - 1;
        const isFlipped = forceFlipped;
        return { col: isFlipped ? 7 - file : file, row: isFlipped ? rank : 7 - rank };
    }

    function createSquare(coords, className, stepIndex = 0, moveIndex = 1, showBadge = false, cornerIndex = 0) {
        const hl = document.createElement('div');
        hl.className = `hl-sq ${className}`;
        const padding = 1.5;
        hl.style.left = `calc(${coords.col * 12.5}% + ${padding}px)`; hl.style.top = `calc(${coords.row * 12.5}% + ${padding}px)`;
        hl.style.width = `calc(12.5% - ${padding * 2}px)`; hl.style.height = `calc(12.5% - ${padding * 2}px)`;
        
        if (stepIndex >= 3) { hl.style.opacity = Math.max(0.1, 0.3 - (stepIndex - 3) * 0.02); hl.style.borderWidth = '1px'; hl.style.borderStyle = 'dotted'; }
        else {
            if (stepIndex === 1) { hl.style.opacity = '0.7'; hl.style.borderWidth = '1.5px'; }
            if (stepIndex === 2) { hl.style.opacity = '0.4'; hl.style.borderWidth = '1px'; hl.style.borderStyle = 'dashed'; }
        }

        if (showBadge && (currentMode === 'k' || currentMode === 'u' || currentMode === 'f1')) {
            const badge = document.createElement('div');
            badge.textContent = moveIndex;
            badge.style.position = 'absolute'; badge.style.width = '24px'; badge.style.height = '24px'; badge.style.borderRadius = '50%';
            badge.style.display = 'flex'; badge.style.alignItems = 'center'; badge.style.justifyContent = 'center';
            badge.style.fontSize = '14px'; badge.style.fontWeight = '900'; badge.style.fontFamily = 'Arial, sans-serif';
            badge.style.color = '#000'; badge.style.zIndex = '10000'; badge.style.boxShadow = '0 4px 8px rgba(0,0,0,0.5)'; 
            
            if (cornerIndex === 0) { badge.style.top = '50%'; badge.style.left = '50%'; badge.style.transform = 'translate(-50%, -50%)'; }
            else if (cornerIndex === 1) { badge.style.top = '2px'; badge.style.left = '2px'; }
            else if (cornerIndex === 2) { badge.style.top = '2px'; badge.style.right = '2px'; }
            else { badge.style.bottom = '2px'; badge.style.right = '2px'; }

            if (moveIndex === 1) badge.style.backgroundColor = isBrilliantOrTrap(className) ? '#00d4ff' : '#ffffff';
            else if (moveIndex === 2) badge.style.backgroundColor = '#fbbf24'; 
            else { badge.style.backgroundColor = '#a855f7'; badge.style.color = '#fff'; }
            if (stepIndex >= 3) badge.style.opacity = Math.max(0.3, 0.7 - (stepIndex - 3) * 0.05);
            hl.appendChild(badge);
        }
        highlightLayer.appendChild(hl);
    }

    function isBrilliantOrTrap(cls) { return cls.includes('brilliant') || cls.includes('trap'); }
    function removeHighlights() { highlightLayer.innerHTML = ''; }

    setInterval(() => {
        if (activeLine.length === 0) return;
        const fen = getFEN();
        if (!fen || fen === lineBaseFen) return;
        const oldTurn = lineBaseFen.split(' ')[1], newTurn = fen.split(' ')[1];
        if (oldTurn !== newTurn) {
            activeLine.shift();
            if (activeLine.length > 0) {
                const isBrilliant = currentMode === 'k' || currentMode === 'u';
                highlightMove(activeLine, isBrilliant, false);
                setStatus('♟', 'Remaining', activeLine, '#00d4ff');
            } else {
                removeHighlights(); setStatus('♟️', 'Tap for J', [], '#00ff88'); currentMode = 'none';
            }
            lineBaseFen = fen;
        }
    }, 500);

    function handleAction(mode) {
        if (mode === 'f2') {
            myColor = myColor === 'w' ? 'b' : 'w'; manualColor = myColor; localStorage.setItem('chess_assist_color', myColor);
            setStatus('🔄', `Color: ${myColor === 'w' ? 'White' : 'Black'}`, [], '#fbbf24');
            removeHighlights(); activeLine = []; multipvMoves = []; return;
        }
        if (mode === 'f3') {
            forceFlipped = !forceFlipped; localStorage.setItem('chess_assist_flip', forceFlipped);
            setStatus('🔄', `Flip: ${forceFlipped ? 'ON' : 'OFF'}`, [], '#fbbf24');
            if (activeLine.length > 0) { const isBrilliant = currentMode === 'k' || currentMode === 'u'; highlightMove(activeLine, isBrilliant, false); }
            return;
        }
        if (mode === 'l') {
            removeHighlights(); activeLine = []; isChoosingFuture = false; manualColor = null;
            localStorage.removeItem('chess_assist_color'); myColor = detectMyColor(); setStatus('♟️', 'Cleared', [], '#00ff88'); return;
        }
        if (mode === 'f1') { isChoosingFuture = true; setStatus('❓', 'Choose 1-9', [], '#fbbf24'); return; }
        if (isCalculating || !isEngineReady || !engine) return;
        
        removeHighlights(); activeLine = []; multipvMoves = []; currentFen = getFEN(); currentMode = mode; isFastChaining = false;
        if (!currentFen) { setStatus('⚠️', 'No FEN', [], '#ff5555'); return; }
        
        if (mode === 'j') {
            const fenShort = currentFen.split(' ').slice(0, 3).join(' ');
            if (FAST_TRAP_DATABASE[fenShort]) {
                const trapMove = FAST_TRAP_DATABASE[fenShort]; activeLine = [trapMove]; lineBaseFen = currentFen;
                highlightMove([trapMove], false, false); setStatus('♟', 'Trap', [trapMove], '#ffaa00'); return;
            }
            isCalculating = true; setStatus('⏳', 'Calculating...', [], '#00e5ff');
            engine.postMessage(`position fen ${currentFen}`); engine.postMessage(`go movetime 300`);
        } 
        else if (mode === 'k') {
            isCalculating = true; setStatus('⏳', 'Search 3 moves...', [], '#00e5ff');
            engine.postMessage(`position fen ${currentFen}`); engine.postMessage(`go movetime 2500`);
        }
        else if (mode === 'u') {
            if (typeof Chess === 'undefined') { setStatus('⚠️', 'chess.js...', [], '#ff5555'); return; }
            isCalculating = true; isFastChaining = true; chainStep = 0; chainMoves = []; chainFen = currentFen;
            setStatus('⏳', 'Fast-3...', [], '#00e5ff');
            engine.postMessage(`position fen ${chainFen}`); engine.postMessage(`go movetime 1000`);
        }
    }

    window.addEventListener('keydown', (e) => {
        if (isChoosingFuture && /^[0-9]$/.test(e.key)) {
            const digit = parseInt(e.key);
            if (digit >= 1 && digit <= 9) {
                futureMovesCount = digit; isChoosingFuture = false; if (isCalculating || !isEngineReady || !engine) return;
                removeHighlights(); activeLine = []; multipvMoves = []; currentFen = getFEN(); currentMode = 'f1'; isFastChaining = false;
                if (!currentFen) { setStatus('⚠️', 'No FEN', [], '#ff5555'); return; }
                isCalculating = true; setStatus('⏳', `Looking ${futureMovesCount} ahead...`, [], '#00e5ff');
                engine.postMessage(`position fen ${currentFen}`); engine.postMessage(`go movetime 5000`);
            }
        }
    });

    initEngine();
})();