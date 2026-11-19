// ==UserScript==
// @name         Chess.com Cheat Assist v9.5 (Modes)
// @name:ru      Chess.com Cheat Assist v9.5 (Режимы)
// @namespace    http://tampermonkey.net/
// @version      9.5
// @description  Stockfish WASM Assist with J/K modes and Play Styles.
// @description:ru Помощник для Chess.com с режимами J/K и стилями игры.
// @author       urs_ditch (patched by LO & ENI)
// @license      CC BY-NC-ND 4.0
// @match        https://www.chess.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STOCKFISH_WASM_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';

    let engine = null;
    let isCalculating = false;
    let isEngineReady = false;
    let currentFen = '';
    let multipvMoves = [];
    let currentMode = 'j'; // 'j' или 'k'
    
    // Стиль игры: 'classic', 'aggressive', 'defense'
    let playStyle = localStorage.getItem('chess_playstyle') || 'classic';

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
        @keyframes glow-pulse-std {
            0% { box-shadow: inset 0 0 12px rgba(255, 50, 50, 0.4), 0 0 8px rgba(255, 0, 0, 0.3); }
            50% { box-shadow: inset 0 0 22px rgba(255, 50, 50, 0.7), 0 0 16px rgba(255, 0, 0, 0.6); }
            100% { box-shadow: inset 0 0 12px rgba(255, 50, 50, 0.4), 0 0 8px rgba(255, 0, 0, 0.3); }
        }

        @keyframes glow-pulse-brilliant {
            0% { box-shadow: inset 0 0 12px rgba(0, 212, 255, 0.5), 0 0 10px rgba(0, 180, 255, 0.4); }
            50% { box-shadow: inset 0 0 25px rgba(0, 212, 255, 0.85), 0 0 20px rgba(0, 180, 255, 0.75); }
            100% { box-shadow: inset 0 0 12px rgba(0, 212, 255, 0.5), 0 0 10px rgba(0, 180, 255, 0.4); }
        }

        .status-box {
            position: fixed; bottom: 20px; right: 20px; padding: 8px 16px;
            background: rgba(12, 14, 20, 0.88); color: #e0e0e0;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 13px; font-weight: 600; letter-spacing: 0.3px;
            border-radius: 8px; z-index: 999999; pointer-events: none;
            border: 1px solid rgba(255, 255, 255, 0.12);
            backdrop-filter: blur(6px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            transition: all 0.2s ease;
        }

        .highlight-layer {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none; z-index: 9999;
        }

        .hl-sq {
            position: absolute; width: 12.5%; height: 12.5%;
            box-sizing: border-box; border-radius: 6px;
            transition: all 0.2s ease;
        }

        .hl-std-from {
            border: 1.5px solid rgba(255, 80, 80, 0.8);
            background: radial-gradient(circle at center, rgba(255, 60, 60, 0.12) 0%, rgba(220, 30, 30, 0.45) 80%, rgba(180, 10, 10, 0.6) 100%);
            animation: glow-pulse-std 2s infinite ease-in-out;
        }
        .hl-std-to {
            border: 2px solid rgba(200, 0, 0, 0.95);
            background: radial-gradient(circle at center, rgba(160, 0, 0, 0.18) 0%, rgba(120, 0, 0, 0.65) 75%, rgba(80, 0, 0, 0.85) 100%);
            animation: glow-pulse-std 1.6s infinite ease-in-out;
        }

        .hl-brilliant-from {
            border: 1.5px solid rgba(0, 220, 255, 0.85);
            background: radial-gradient(circle at center, rgba(0, 220, 255, 0.15) 0%, rgba(0, 150, 220, 0.45) 80%, rgba(0, 100, 180, 0.65) 100%);
            animation: glow-pulse-brilliant 2s infinite ease-in-out;
        }
        .hl-brilliant-to {
            border: 2px solid rgba(0, 120, 255, 0.95);
            background: radial-gradient(circle at center, rgba(0, 100, 230, 0.2) 0%, rgba(0, 60, 170, 0.68) 75%, rgba(0, 30, 110, 0.88) 100%);
            animation: glow-pulse-brilliant 1.5s infinite ease-in-out;
        }

        .hl-trap-from {
            border: 1.5px solid rgba(255, 170, 0, 0.8);
            background: radial-gradient(circle at center, rgba(255, 170, 0, 0.12) 0%, rgba(220, 130, 0, 0.4) 80%, rgba(180, 90, 0, 0.6) 100%);
        }
        .hl-trap-to {
            border: 2px solid rgba(220, 140, 0, 0.95);
            background: radial-gradient(circle at center, rgba(200, 120, 0, 0.18) 0%, rgba(160, 90, 0, 0.65) 75%, rgba(110, 50, 0, 0.85) 100%);
        }

        /* МОБИЛЬНАЯ ПАНЕЛЬ */
        .mobile-ui {
            position: fixed; bottom: 70px; right: 20px;
            display: flex; flex-direction: column; align-items: flex-end; gap: 10px;
            z-index: 999999; user-select: none; -webkit-user-select: none;
        }

        .mobile-btn {
            width: 64px; height: 64px;
            background: rgba(12, 14, 20, 0.95);
            border: 2px solid rgba(0, 212, 255, 0.6);
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 32px; color: #fff;
            box-shadow: 0 0 15px rgba(0, 212, 255, 0.4);
            cursor: pointer;
            transition: transform 0.1s ease, background 0.1s ease;
        }
        .mobile-btn:active { transform: scale(0.85); background: rgba(0, 212, 255, 0.2); }

        .gear-btn {
            width: 32px; height: 32px;
            background: rgba(12, 14, 20, 0.9);
            border: 1px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 16px; color: #ccc; cursor: pointer;
            margin-right: 16px;
        }
        .gear-btn:active { background: rgba(255, 255, 255, 0.2); color: #fff; }

        .mode-menu {
            position: absolute; bottom: 110px; right: 20px;
            background: rgba(16, 18, 24, 0.95);
            border: 1px solid rgba(255, 255, 255, 0.15);
            border-radius: 12px; padding: 8px;
            display: none; flex-direction: column; gap: 4px;
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
        }
        .mode-menu.active { display: flex; }

        .mode-opt {
            padding: 8px 12px; border-radius: 6px;
            font-family: sans-serif; font-size: 13px; font-weight: 600;
            color: #fff; cursor: pointer; text-align: center;
            transition: background 0.1s;
        }
        .mode-opt:hover { background: rgba(255, 255, 255, 0.1); }
        .mode-opt.active { background: rgba(0, 212, 255, 0.2); color: #00d4ff; border: 1px solid rgba(0, 212, 255, 0.4); }
    `;
    shadow.appendChild(styleEl);

    const statusBox = document.createElement('div');
    statusBox.className = 'status-box';
    statusBox.innerText = 'Init engine...';
    shadow.appendChild(statusBox);

    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'highlight-layer';
    shadow.appendChild(highlightLayer);

    const mobileUI = document.createElement('div');
    mobileUI.className = 'mobile-ui';
    mobileUI.innerHTML = `
        <div class="gear-btn" id="gear-btn">⚙️</div>
        <div class="mobile-btn" id="pawn-btn">♟️</div>
    `;
    shadow.appendChild(mobileUI);

    const modeMenu = document.createElement('div');
    modeMenu.className = 'mode-menu';
    modeMenu.innerHTML = `
        <div class="mode-opt" data-mode="classic">Classic</div>
        <div class="mode-opt" data-mode="aggressive">Aggressive</div>
        <div class="mode-opt" data-mode="defense">Defense</div>
    `;
    shadow.appendChild(modeMenu);

    // Обновляем UI под текущий стиль
    function updateStyleUI() {
        shadow.querySelectorAll('.mode-opt').forEach(el => {
            if (el.dataset.mode === playStyle) el.classList.add('active');
            else el.classList.remove('active');
        });
    }
    updateStyleUI();

    // Обработка меню стилей
    document.getElementById('gear-btn').addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        modeMenu.classList.toggle('active');
    });

    shadow.querySelectorAll('.mode-opt').forEach(el => {
        el.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            playStyle = e.target.dataset.mode;
            localStorage.setItem('chess_playstyle', playStyle);
            updateStyleUI();
            modeMenu.classList.remove('active');
            setStatus(`Style: ${playStyle}`, '#00ff88');
        });
    });

    let pressTimer = null;
    const pawnBtn = document.getElementById('pawn-btn');

    pawnBtn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pawnBtn.style.transform = 'scale(0.85)';
        
        // 0.4 секунды для K
        pressTimer = setTimeout(() => {
            pressTimer = null;
            pawnBtn.style.transform = 'scale(1)';
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', keyCode: 75 }));
        }, 400);
    });

    pawnBtn.addEventListener('pointerup', (e) => {
        e.preventDefault();
        e.stopPropagation();
        pawnBtn.style.transform = 'scale(1)';
        
        if (pressTimer !== null) {
            clearTimeout(pressTimer);
            pressTimer = null;
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', keyCode: 74 }));
        }
    });

    pawnBtn.addEventListener('pointerleave', () => {
        if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
        pawnBtn.style.transform = 'scale(1)';
    });


    function setStatus(text, color = '#e0e0e0') {
        statusBox.innerText = text;
        statusBox.style.color = color;
    }

    function formatMoveText(prefix, move) {
        if (!move) return prefix;
        return `${prefix}: ${move.charAt(0).toUpperCase() + move.slice(1).toLowerCase()}`;
    }

    async function initEngine() {
        try {
            const response = await fetch(STOCKFISH_WASM_WORKER);
            const content = await response.text();
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
                    setStatus('Ready [J/K]', '#00ff88');
                } else if (line.includes('multipv')) {
                    parseMultiPVLine(line);
                } else if (line.startsWith('bestmove')) {
                    processBestMove();
                    isCalculating = false;
                }
            };

            engine.postMessage('uci');
        } catch (err) {
            setStatus('Engine error', '#ff5555');
        }
    }

    function parseMultiPVLine(line) {
        const moveMatch = line.match(/pv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
        const cpMatch = line.match(/score\s+cp\s+(-?\d+)/);
        const mateMatch = line.match(/score\s+mate\s+(-?\d+)/);

        if (moveMatch) {
            const move = moveMatch[1];
            let score = 0, mate = 0;
            if (mateMatch) {
                mate = parseInt(mateMatch[1]);
                score = mate > 0 ? (100000 - mate) : (-100000 - mate);
            } else if (cpMatch) {
                score = parseInt(cpMatch[1]);
            }

            const idx = multipvMoves.findIndex(m => m.move === move);
            if (idx !== -1) multipvMoves[idx] = { move, score, mate };
            else multipvMoves.push({ move, score, mate });
        }
    }

    // ФИЛЬТР СТИЛЕЙ ИГРЫ
    function applyPlayStyle(moves) {
        if (playStyle === 'classic' || moves.length < 2) return moves;
        
        const boardMap = parseFenToBoard(currentFen);
        
        return moves.map(item => {
            let adjustedScore = item.score;
            const fromSq = item.move.slice(0, 2);
            const toSq = item.move.slice(2, 4);
            const piece = boardMap[fromSq];
            
            if (!piece) return item;

            // Агрессия: награждаем ходы вперед и атаки
            if (playStyle === 'aggressive') {
                const fromRank = parseInt(fromSq[1]);
                const toRank = parseInt(toSq[1]);
                const isWhite = piece === piece.toUpperCase();
                
                // Если идем вперед
                if ((isWhite && toRank > fromRank) || (!isWhite && toRank < fromRank)) adjustedScore += 15;
                // Если атакуем фигуру (взятие)
                if (boardMap[toSq]) adjustedScore += 25;
                // Штраф за отход назад
                if ((isWhite && toRank < fromRank) || (!isWhite && toRank > fromRank)) adjustedScore -= 30;
            }
            
            // Защита: награждаем отходы и защиту фигур
            if (playStyle === 'defense') {
                const fromRank = parseInt(fromSq[1]);
                const toRank = parseInt(toSq[1]);
                const isWhite = piece === piece.toUpperCase();
                
                // Отход назад
                if ((isWhite && toRank < fromRank) || (!isWhite && toRank > fromRank)) adjustedScore += 20;
                // Штраф за агрессию
                if ((isWhite && toRank > fromRank + 1) || (!isWhite && toRank < fromRank - 1)) adjustedScore -= 15;
            }

            return { ...item, score: adjustedScore };
        });
    }

    function processBestMove() {
        if (!multipvMoves.length) { setStatus('No move found', '#ff5555'); return; }

        // Сортируем по сырой оценке движка (чтобы знать базовый топ)
        multipvMoves.sort((a, b) => b.score - a.score);

        // Применяем фильтр стиля к оценкам
        let styledMoves = applyPlayStyle(multipvMoves);
        
        // Сортируем по скорректированной оценке
        styledMoves.sort((a, b) => b.score - a.score);

        let selectedMove = styledMoves[0].move;
        let isBrilliant = false;
        const bestScore = styledMoves[0].score;

        // Ищем жертву (бриллиант) среди топ-ходов
        for (let i = 0; i < styledMoves.length; i++) {
            const item = styledMoves[i];
            const tolerance = currentMode === 'k' ? 40 : 25;
            if (bestScore - item.score <= tolerance) {
                if (isStrictSacrifice(item.move, currentFen)) {
                    selectedMove = item.move;
                    isBrilliant = true;
                    break;
                }
            }
        }

        if (isBrilliant) {
            highlightMove(selectedMove, 'hl-brilliant-from', 'hl-brilliant-to');
            setStatus(formatMoveText('Brilliant', selectedMove), '#00d4ff');
        } else {
            highlightMove(selectedMove, 'hl-std-from', 'hl-std-to');
            const styleText = playStyle.charAt(0).toUpperCase() + playStyle.slice(1);
            setStatus(`${styleText} | ${selectedMove}`, '#ff6b6b');
        }
    }

    function isSquareAttackedByEnemy(targetSq, enemyIsWhite, boardMap) {
        return getMinimumAttackerValue(targetSq, enemyIsWhite, boardMap) < 999;
    }

    function getMinimumAttackerValue(targetSq, enemyIsWhite, boardMap) {
        let minVal = 999;
        const file = targetSq.charCodeAt(0) - 97;
        const rank = parseInt(targetSq[1]);

        const enemyKingPiece = enemyIsWhite ? 'K' : 'k';
        let enemyKingSq = null;
        for (let sq in boardMap) {
            if (boardMap[sq] === enemyKingPiece) { enemyKingSq = sq; break; }
        }

        function isPiecePinned(fromSq) {
            if (!enemyKingSq || fromSq === enemyKingSq) return false;
            const tempMap = { ...boardMap };
            delete tempMap[fromSq];
            return isRayAttacked(enemyKingSq, !enemyIsWhite, tempMap);
        }

        const pawnPushes = enemyIsWhite ? [[-1, -1], [1, -1]] : [[-1, 1], [1, 1]];
        const enemyPawn = enemyIsWhite ? 'P' : 'p';
        for (let [df, dr] of pawnPushes) {
            const sq = String.fromCharCode(97 + file + df) + (rank + dr);
            if (boardMap[sq] === enemyPawn && !isPiecePinned(sq)) {
                minVal = Math.min(minVal, PIECE_VALUES['p']);
            }
        }

        const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        const enemyKnight = enemyIsWhite ? 'N' : 'n';
        for (let [df, dr] of knightMoves) {
            const sq = String.fromCharCode(97 + file + df) + (rank + dr);
            if (boardMap[sq] === enemyKnight && !isPiecePinned(sq)) {
                minVal = Math.min(minVal, PIECE_VALUES['n']);
            }
        }

        const bishopDirections = [[1,1], [1,-1], [-1,1], [-1,-1]];
        const enemyBishop = enemyIsWhite ? 'B' : 'b';
        const enemyQueen = enemyIsWhite ? 'Q' : 'q';
        for (let [df, dr] of bishopDirections) {
            let f = file + df, r = rank + dr;
            while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
                const sq = String.fromCharCode(97 + f) + r;
                const piece = boardMap[sq];
                if (piece) {
                    if ((piece === enemyBishop || piece === enemyQueen) && !isPiecePinned(sq)) {
                        minVal = Math.min(minVal, PIECE_VALUES[piece.toLowerCase()]);
                    }
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
                const sq = String.fromCharCode(97 + f) + r;
                const piece = boardMap[sq];
                if (piece) {
                    if ((piece === enemyRook || piece === enemyQueen) && !isPiecePinned(sq)) {
                        minVal = Math.min(minVal, PIECE_VALUES[piece.toLowerCase()]);
                    }
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
        const file = targetSq.charCodeAt(0) - 97;
        const rank = parseInt(targetSq[1]);

        const bishopDirections = [[1,1], [1,-1], [-1,1], [-1,-1]];
        const enemyBishop = enemyIsWhite ? 'B' : 'b';
        const enemyQueen = enemyIsWhite ? 'Q' : 'q';
        for (let [df, dr] of bishopDirections) {
            let f = file + df, r = rank + dr;
            while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
                const sq = String.fromCharCode(97 + f) + r;
                const piece = boardMap[sq];
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
                const sq = String.fromCharCode(97 + f) + r;
                const piece = boardMap[sq];
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
        const fromSq = move.slice(0, 2);
        const toSq = move.slice(2, 4);

        const boardMap = parseFenToBoard(fen);
        const movingPiece = boardMap[fromSq];
        const targetPiece = boardMap[toSq];

        if (!movingPiece) return false;

        const isWhite = movingPiece === movingPiece.toUpperCase();
        const movingVal = PIECE_VALUES[movingPiece.toLowerCase()];
        const targetVal = targetPiece ? PIECE_VALUES[targetPiece.toLowerCase()] : 0;

        const nextBoardMap = { ...boardMap };
        delete nextBoardMap[fromSq];
        nextBoardMap[toSq] = movingPiece;

        if (targetPiece && (movingVal - targetVal >= 1.8)) {
            const canEnemyRecapture = isSquareAttackedByEnemy(toSq, !isWhite, nextBoardMap);
            if (canEnemyRecapture) return true;
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
        const map = {};
        if (!fen) return map;
        const fenBoard = fen.split(' ')[0];
        const rows = fenBoard.split('/');

        for (let r = 0; r < 8; r++) {
            let c = 0;
            for (let char of rows[r]) {
                if (!isNaN(char)) {
                    c += parseInt(char);
                } else {
                    const file = String.fromCharCode(97 + c);
                    const rank = 8 - r;
                    map[`${file}${rank}`] = char;
                    c++;
                }
            }
        }
        return map;
    }

    function getFEN() {
        try {
            const board = document.querySelector('chess-board, wc-chess-board');
            if (board && board.game && typeof board.game.getFEN === 'function') return board.game.getFEN();
            if (board && board.controller && typeof board.controller.getFEN === 'function') return board.controller.getFEN();
            if (window.chesscom && window.chesscom.game && typeof window.chesscom.game.getFEN === 'function') return window.chesscom.game.getFEN();
        } catch (e) {}
        return null;
    }

    function highlightMove(uciMove, classFrom, classTo) {
        removeHighlights();
        const boardNode = document.querySelector('chess-board, wc-chess-board');
        if (!boardNode) return;

        const rect = boardNode.getBoundingClientRect();

        highlightLayer.style.left = `${rect.left + window.scrollX}px`;
        highlightLayer.style.top = `${rect.top + window.scrollY}px`;
        highlightLayer.style.width = `${rect.width}px`;
        highlightLayer.style.height = `${rect.height}px`;

        const fromSq = getSquareCoords(uciMove.slice(0, 2), boardNode);
        const toSq = getSquareCoords(uciMove.slice(2, 4), boardNode);

        if (fromSq && toSq) {
            createSquare(fromSq, classFrom);
            createSquare(toSq, classTo);
        }
    }

    function getSquareCoords(squareStr, boardNode) {
        const file = squareStr.charCodeAt(0) - 97;
        const rank = parseInt(squareStr[1]) - 1;
        const isFlipped = boardNode.classList.contains('flipped');

        return {
            col: isFlipped ? 7 - file : file,
            row: isFlipped ? rank : 7 - rank
        };
    }

    function createSquare(coords, className) {
        const hl = document.createElement('div');
        hl.className = `hl-sq ${className}`;
        hl.style.left = `${coords.col * 12.5}%`;
        hl.style.top = `${coords.row * 12.5}%`;
        highlightLayer.appendChild(hl);
    }

    function removeHighlights() {
        highlightLayer.innerHTML = '';
    }

    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if ((key === 'j' || e.code === 'KeyJ') || (key === 'k' || e.code === 'KeyK')) {
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
            if (isCalculating || !isEngineReady || !engine) return;

            currentMode = key;
            removeHighlights();
            multipvMoves = [];
            currentFen = getFEN();

            if (!currentFen) { setStatus('FEN unavailable', '#ff5555'); return; }

            const fenShort = currentFen.split(' ').slice(0, 3).join(' ');
            if (FAST_TRAP_DATABASE[fenShort]) {
                const trapMove = FAST_TRAP_DATABASE[fenShort];
                highlightMove(trapMove, 'hl-trap-from', 'hl-trap-to');
                setStatus(formatMoveText('Trap', trapMove), '#ffaa00');
                return;
            }

            isCalculating = true;
            setStatus(currentMode === 'k' ? 'Search 3 moves...' : 'Calculating...', '#00e5ff');

            const movetime = currentMode === 'k' ? 2500 : 300;

            engine.postMessage(`position fen ${currentFen}`);
            engine.postMessage(`go movetime ${movetime}`);
        }
    });

    window.addEventListener('mousedown', removeHighlights);

    initEngine();
})();