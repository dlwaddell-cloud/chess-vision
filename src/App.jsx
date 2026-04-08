import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Chess } from 'chess.js';
import { Upload, Cpu, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Play, SquareSquare, RefreshCw, Plus, Wand2, ToggleLeft, ToggleRight, Download } from 'lucide-react';

// --- API & Constants ---
const GEMINI_MODEL = "gemini-3.1-flash-lite-preview"; // Latest as of June 2024, optimized for vision tasks

// We define URLs for both the modern WASM engine and the stable fallback
const STOCKFISH_WASM_SCRIPT_URL = "https://unpkg.com/stockfish@18.0.7/bin/stockfish-18-lite-single.js"; // Unpkg Stockfish 18 JS wrapper
const STOCKFISH_WASM_BINARY_URL = "https://unpkg.com/stockfish@18.0.7/bin/stockfish-18-lite-single.wasm"; // Unpkg Stockfish 18 WASM binary
const STOCKFISH_FALLBACK_URL = "https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.0/stockfish.js";

// --- Helper Functions ---
const fileToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.readAsDataURL(file);
  reader.onload = () => resolve(reader.result.split(',')[1]);
  reader.onerror = error => reject(error);
});

const callGeminiWithBackoff = async (imagesData) => {
  const prompt = `You are an expert chess arbiter. Enclosed are image(s) of a handwritten or printed chess score sheet, which may span multiple pages. 
  Your task is to transcribe these moves into a perfectly formatted, single standard PGN (Portable Game Notation) string. 
  Do not include any conversational text, explanations, or markdown blocks. Output ONLY the raw PGN text. 
  Use standard algebraic notation. If a character is ambiguous, use your knowledge of standard chess openings and logic to infer the correct valid move. 
  If a move is completely illegible, use a '?' in place of the move.`;

  const parts = [
    { text: prompt },
    ...imagesData.map(img => ({ inlineData: { mimeType: img.mimeType, data: img.data } }))
  ];

  const payload = {
    contents: [{
      role: "user",
      parts: parts
    }]
  };

  const url = `/api/gemini`;
  const delays = [1000, 2000, 4000, 8000, 16000];
  
  const extractText = (data) => {
    if (!data) return "";
    const candidates = data.candidates || [];
    const outputs = data.output || [];
    const paths = [
      candidates?.[0]?.content?.[0]?.text,
      candidates?.[0]?.content?.parts?.[0]?.text,
      candidates?.[0]?.output?.[0]?.content?.[0]?.text,
      candidates?.[0]?.output?.[0]?.content?.parts?.[0]?.text,
      outputs?.[0]?.content?.[0]?.text,
      outputs?.[0]?.content?.parts?.[0]?.text,
      data?.content?.[0]?.text,
      data?.content?.parts?.[0]?.text
    ];
    return paths.find(p => typeof p === 'string' && p.trim() !== '') || "";
  };

  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      const data = await response.json();
      
      // Check for HTTP errors OR an error object passed in a 200 OK response
      if (!response.ok || data.error) {
        // Safely extract the message string whether it's an object or a plain string
        const errMsg = data?.error?.message || data?.error || `API Error: ${response.status}`;
        throw new Error(errMsg);
      }
      
      const rawText = extractText(data);
      const text = rawText.replace(/```pgn/gi, '').replace(/```/g, '').trim();
      if (!text) {
        console.error('Unexpected Gemini response:', data);
        throw new Error('No PGN was returned from the Gemini API. Check the API response format and model output.');
      }
      return text;
    } catch (error) {
      if (attempt === 5) throw error;
      await new Promise(r => setTimeout(r, delays[attempt]));
    }
  }
};

const SimpleBoard = ({ fen }) => {
  const [board, setBoard] = useState([]);

  useEffect(() => {
    try {
      const game = new Chess(fen === 'start' ? undefined : fen);
      setBoard(game.board());
    } catch (e) {
      const game = new Chess();
      setBoard(game.board());
    }
  }, [fen]);

  if (!board || board.length === 0) return null;

  return (
    <div className="w-full aspect-square max-w-[360px] mx-auto grid grid-cols-8 grid-rows-8 border-4 border-slate-700 rounded-sm shadow-md overflow-hidden">
      {board.map((row, i) =>
        row.map((piece, j) => {
          const isDark = (i + j) % 2 === 1;
          return (
            <div 
              key={`${i}-${j}`} 
              className={`w-full h-full flex items-center justify-center select-none ${isDark ? 'bg-[#b58863]' : 'bg-[#f0d9b5]'}`}
            >
              {piece && (
                <img 
                  src={`https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/cburnett/${piece.color}${piece.type.toUpperCase()}.svg`} 
                  alt={`${piece.color} ${piece.type}`} 
                  className="w-[90%] h-[90%] object-contain drop-shadow-md pointer-events-none" 
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
};

const ErrorBanner = ({ message, onClose }) => {
  if (!message) return null;
  return (
    <div className="bg-red-50 border-l-4 border-red-500 p-4 mb-4 rounded shadow-sm flex justify-between items-start">
      <div className="flex">
        <AlertCircle className="h-5 w-5 text-red-500 mr-2 mt-0.5" />
        <p className="text-sm text-red-700">{message}</p>
      </div>
      <button onClick={onClose} className="text-red-500 hover:text-red-700">✕</button>
    </div>
  );
};

// --- Main App Component ---
export default function App() {
  // State: Core
  const [pgn, setPgn] = useState("");
  const [draftPgn, setDraftPgn] = useState("");
  const [fen, setFen] = useState("start");
  const [moveHistory, setMoveHistory] = useState([]);
  const [currentMoveIndex, setCurrentMoveIndex] = useState(-1);
  const [errorMessage, setErrorMessage] = useState("");
  const [isPgnValid, setIsPgnValid] = useState(true);
  const [pgnErrorDetail, setPgnErrorDetail] = useState("");

  // State: OCR
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [imagePreviews, setImagePreviews] = useState([]);
  const [selectedImagesData, setSelectedImagesData] = useState([]);

  // State: Engine
  const [stockfish, setStockfish] = useState(null);
  const stockfishRef = useRef(null);
  const [evaluation, setEvaluation] = useState(null);
  const [bestMove, setBestMove] = useState(null);
  const [isAutoEvalOn, setIsAutoEvalOn] = useState(false);
  const [engineVersion, setEngineVersion] = useState("Loading Engine...");
  const [isEngineReady, setIsEngineReady] = useState(false);

  // Initialize Advanced Stockfish Web Worker Architecture
  useEffect(() => {
    const initStockfish = async () => {
      try {
        const workerCode = `
          // 1. Point Emscripten to the correct WASM binary on the CDN
          self.Module = {
            locateFile: function(path) {
              if (path.indexOf('.wasm') > -1) {
                return '${STOCKFISH_WASM_BINARY_URL}';
              }
              return path;
            }
          };

          // 2. Load the Engine (It auto-runs and binds to postMessage automatically)
          try {
            importScripts('${STOCKFISH_WASM_SCRIPT_URL}');
          } catch (err) {
            // Failsafe: Load the older ASM.js engine if WASM fails to fetch
            importScripts('${STOCKFISH_FALLBACK_URL}');
          }
        `;
        
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);
        
        worker.onmessage = (e) => {
          const line = e.data;
          
          // Prevent crashes from internal Emscripten loading objects
          if (typeof line !== 'string') return;
          
          // Parse official UCI identifying info to get the exact version running
          if (line.startsWith("id name ")) {
            setEngineVersion(line.replace("id name ", ""));
          }
          
          // 'uciok' confirms the engine is fully loaded and ready for commands
          if (line === "uciok") {
            setIsEngineReady(true);
            return;
          }

          if (line.includes("info depth") && line.includes("score")) {
            const cpMatch = line.match(/score cp (-?\d+)/);
            const mateMatch = line.match(/score mate (-?\d+)/);
            if (cpMatch) setEvaluation((parseInt(cpMatch[1]) / 100).toFixed(2));
            if (mateMatch) {
              const moves = parseInt(mateMatch[1], 10);
              setEvaluation(moves > 0 ? `+M${moves}` : `-M${Math.abs(moves)}`);
            }
          }
          
          if (line.includes("bestmove")) {
            const moveMatch = line.match(/bestmove ([a-h][1-8][a-h][1-8][qrbn]?)/);
            if (moveMatch) {
              setBestMove(moveMatch[1]);
            }
          }
        };
        
        // Immediately initialize the engine in UCI mode. 
        // The worker will buffer this command until the WASM file finishes loading!
        worker.postMessage("uci");
        
        setStockfish(worker);
        stockfishRef.current = worker;
      } catch (err) {
        console.error("Failed to setup Stockfish Web Worker:", err);
        setEngineVersion("Engine Failed to Load");
      }
    };
    initStockfish();
    
    return () => { if (stockfishRef.current) stockfishRef.current.terminate(); };
  }, []);


  // Update FEN based on move index
  const updateBoardState = (gameInstance, index) => {
    const history = gameInstance.history({ verbose: true });
    const tempGame = new Chess();
    
    for (let i = 0; i <= index; i++) {
      if (history[i]) tempGame.move(history[i].san);
    }
    
    setFen(tempGame.fen());
    setCurrentMoveIndex(index);
    setEvaluation(null);
    setBestMove(null);
  };

  // Run Real-time Engine Analysis when FEN changes and Auto-Eval is ON
  useEffect(() => {
    const worker = stockfishRef.current;
    if (!worker || !isEngineReady) return;
    if (!isAutoEvalOn) {
      worker.postMessage("stop");
      setEvaluation(null);
      setBestMove(null);
      return;
    }
    const timer = setTimeout(() => {
      const fenStr = fen === 'start'
        ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
        : fen;
      setEvaluation("...");
      setBestMove("...");
      worker.postMessage("stop");
      worker.postMessage(`position fen ${fenStr}`);
      worker.postMessage("go depth 10");
    }, 250);
    return () => clearTimeout(timer);
  }, [fen, isAutoEvalOn, isEngineReady]);

  // Explicit PGN Validation (Runs from start every time it's called)
  const validateAndApplyPgn = (inputPgn) => {
    setPgn(inputPgn);

    try {
      const game = new Chess();
      if (inputPgn.trim() === "") {
        setMoveHistory([]);
        setIsPgnValid(true);
        setPgnErrorDetail("");
        updateBoardState(game, -1);
        return;
      }
      
      game.loadPgn(inputPgn);
      const history = game.history({ verbose: true });
      setMoveHistory(history);
      setIsPgnValid(true);
      setErrorMessage("");
      setPgnErrorDetail("");
      
      updateBoardState(game, history.length - 1);
    } catch (err) {
      setIsPgnValid(false);
      
      let detailedError = err.message || "Invalid PGN syntax or illegal move.";
      try {
        const tempGame = new Chess();
        const cleanPgn = inputPgn
          .replace(/\[[^\]]*\]/g, '')
          .replace(/\{[^\}]*\}/g, '')
          .replace(/\([^\)]*\)/g, '')
          .trim();
        
        const tokens = cleanPgn.split(/\s+/).filter(t => t && !['1-0', '0-1', '1/2-1/2', '*'].includes(t));
        let lastValidIndex = -1;
        
        for (let token of tokens) {
          let actualMove = token;
          const mergedMatch = token.match(/^\d+\.+(.+)$/);
          if (mergedMatch) actualMove = mergedMatch[1];
          else if (/^\d+\.+$/.test(token)) continue; 
          
          const moveNum = Math.floor(tempGame.history().length / 2) + 1;
          const color = tempGame.turn() === 'w' ? 'White' : 'Black';
          
          try {
            const res = tempGame.move(actualMove);
            if (!res) throw new Error();
            lastValidIndex++;
          } catch (e) {
            detailedError = `Error at move ${moveNum} (${color}): "${actualMove}" is invalid or illegal.`;
            break;
          }
        }
        
        setMoveHistory(tempGame.history({ verbose: true }));
        updateBoardState(tempGame, lastValidIndex);
      } catch (fallbackErr) {
        // Fallback catch
      }
      
      setPgnErrorDetail(detailedError);
    }
  };

  const handleStepMove = (direction) => {
    if (!isPgnValid && currentMoveIndex >= moveHistory.length - 1 && direction > 0) return;
    
    const game = new Chess();
    for (let move of moveHistory) {
      game.move(move.san);
    }
    
    let newIndex = currentMoveIndex + direction;
    if (newIndex < -1) newIndex = -1;
    if (newIndex >= moveHistory.length) newIndex = moveHistory.length - 1;
    updateBoardState(game, newIndex);
  };

  const handleJumpMove = (e) => {
    const targetIndex = parseInt(e.target.value, 10);
    const game = new Chess();
    for (let move of moveHistory) {
      game.move(move.san);
    }
    updateBoardState(game, targetIndex);
  };

  // Image Upload & OCR
  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const invalidFiles = files.filter(f => !f.type.startsWith('image/'));
    if (invalidFiles.length > 0) {
      setErrorMessage("Please upload valid image files (JPEG, PNG) only.");
      return;
    }

    setImagePreviews(files.map(f => URL.createObjectURL(f)));
    setErrorMessage("");

    try {
      const imagesData = await Promise.all(files.map(async (file) => ({
        mimeType: file.type,
        data: await fileToBase64(file)
      })));
      
      setSelectedImagesData(imagesData);
    } catch (err) {
      setErrorMessage("Failed to read image files.");
      console.error(err);
    }
  };

  const handleStartTranscription = async () => {
    if (selectedImagesData.length === 0) return;
    setIsProcessingImage(true);
    setErrorMessage("");

    try {
      const extractedPgn = await callGeminiWithBackoff(selectedImagesData);
      setDraftPgn(extractedPgn);
      validateAndApplyPgn(extractedPgn);
    } catch (err) {
      const errorMsg = err.message.includes('GEMINI_API_KEY') 
        ? "API key not configured. Please check your Cloudflare Workers secrets."
        : err.message.includes('Google API error')
        ? `Gemini API error: ${err.message}`
        : `Failed to process images: ${err.message}`;
      setErrorMessage(errorMsg);
      console.error(err);
    } finally {
      setIsProcessingImage(false);
    }
  };

  const handleNewGame = () => {
    window.location.reload();
  };

  const handleDownloadPgn = () => {
    const contents = draftPgn.trim() || pgn.trim();
    if (!contents) return;

    const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'game.pgn';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Convert raw UCI best move into readable Standard Algebraic Notation (SAN)
  const displayBestMove = useMemo(() => {
    if (!bestMove) return null;
    try {
      const tempGame = new Chess(fen === 'start' ? undefined : fen);
      const from = bestMove.slice(0, 2);
      const to = bestMove.slice(2, 4);
      const promotion = bestMove.length === 5 ? bestMove[4] : undefined;
      
      const move = tempGame.move({ from, to, promotion });
      return move ? move.san : bestMove;
    } catch (e) {
      return bestMove; // Fallback to raw UCI if conversion fails
    }
  }, [bestMove, fen]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900 text-white p-4 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <SquareSquare className="h-6 w-6 text-emerald-400" />
            <h1 className="text-xl font-bold tracking-tight">Chess Vision & Analysis</h1>
          </div>
          <button
            onClick={handleNewGame}
            className="flex items-center px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-lg transition-colors border border-slate-700 shadow-sm"
          >
            <Plus className="h-4 w-4 mr-2" />
            New Game
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4 lg:p-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Column: Input & OCR */}
        <div className="space-y-6">
          
          {/* Upload Section */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <Upload className="h-5 w-5 mr-2 text-indigo-500" />
              1. Upload Score Sheet
            </h2>
            
            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-indigo-200 border-dashed rounded-lg cursor-pointer bg-indigo-50 hover:bg-indigo-100 transition-colors">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <Upload className="w-8 h-8 mb-2 text-indigo-500" />
                <p className="text-sm text-slate-600"><span className="font-semibold">Click to upload</span> or drag and drop</p>
                <p className="text-xs text-slate-500">PNG or JPG (Multiple allowed)</p>
              </div>
              <input type="file" className="hidden" accept="image/*" multiple onChange={handleImageUpload} />
            </label>

            {imagePreviews.length > 0 && (
              <div className="mt-4 flex gap-2 overflow-x-auto p-2 bg-slate-100 rounded-lg">
                {imagePreviews.map((src, index) => (
                  <img key={index} src={src} alt={`Page ${index + 1}`} className="h-32 object-contain rounded shadow-sm flex-shrink-0" />
                ))}
              </div>
            )}

            {selectedImagesData.length > 0 && !isProcessingImage && (
              <div className="mt-4">
                <button
                  onClick={handleStartTranscription}
                  className="w-full flex items-center justify-center px-4 py-3 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 transition-all shadow-sm"
                >
                  <Wand2 className="h-5 w-5 mr-2" />
                  Start Transcription
                </button>
              </div>
            )}

            {isProcessingImage && (
              <div className="mt-4 p-4 bg-indigo-50 text-indigo-700 rounded-lg flex items-center justify-center animate-pulse">
                <Cpu className="h-5 w-5 mr-2 animate-spin" />
                Gemini Vision is transcribing moves...
              </div>
            )}
            
            <ErrorBanner message={errorMessage} onClose={() => setErrorMessage("")} />
          </div>

          {/* PGN Editor Section */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h2 className="text-lg font-semibold mb-4 flex items-center justify-between">
              <div className="flex items-center">
                <CheckCircle2 className={`h-5 w-5 mr-2 ${isPgnValid ? 'text-emerald-500' : 'text-red-500'}`} />
                2. Verify & Edit PGN
              </div>
              {pgn && isPgnValid && <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">Valid</span>}
              {pgn && !isPgnValid && <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">Syntax/Move Error</span>}
            </h2>
            
            <p className="text-sm text-slate-500 mb-2">Edit text below to correct OCR mistakes, then check to apply changes.</p>
            <textarea
              className={`w-full h-48 p-3 rounded-lg border focus:ring-2 focus:outline-none transition-all font-mono text-sm ${
                isPgnValid ? 'border-slate-300 focus:ring-indigo-500' : 'border-red-400 bg-red-50 focus:ring-red-500'
              }`}
              value={draftPgn}
              onChange={(e) => setDraftPgn(e.target.value)}
              placeholder={"[Event \"Tournament\"]\n\n1. e4 e5 2. Nf3 Nc6..."}
            />
            
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                onClick={() => validateAndApplyPgn(draftPgn)}
                className="flex items-center justify-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-all shadow-sm"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Check & Apply Changes
              </button>
              <button
                onClick={handleDownloadPgn}
                disabled={!draftPgn.trim() && !pgn.trim()}
                className="flex items-center justify-center px-4 py-2 bg-slate-100 text-slate-800 text-sm font-medium rounded-lg hover:bg-slate-200 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download className="h-4 w-4 mr-2" />
                Download PGN
              </button>
            </div>

            {!isPgnValid && pgnErrorDetail && (
              <div className="mt-3 text-sm text-red-700 bg-red-50 p-3 rounded-lg border border-red-200 flex items-start">
                <AlertCircle className="h-4 w-4 mr-2 mt-0.5 flex-shrink-0" />
                <span className="font-mono">{pgnErrorDetail}</span>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Board & Engine */}
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5">
            <h2 className="text-lg font-semibold mb-4 flex items-center">
              <Play className="h-5 w-5 mr-2 text-indigo-500" />
              3. Analysis Board
            </h2>
            
            {/* Chess Board */}
            <SimpleBoard fen={fen} />

            {/* Board Controls */}
            <div className="flex items-center justify-between mt-4 bg-slate-100 p-2 rounded-lg">
              <button 
                onClick={() => handleStepMove(-1)}
                disabled={currentMoveIndex < 0}
                className="p-2 bg-white rounded shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              
              <select
                value={currentMoveIndex}
                onChange={handleJumpMove}
                disabled={moveHistory.length === 0}
                className="text-sm font-medium bg-transparent outline-none cursor-pointer hover:bg-slate-200 px-2 py-1 rounded text-center focus:ring-2 focus:ring-indigo-500 max-w-[200px] truncate"
              >
                <option value={-1}>Start Position</option>
                {moveHistory.map((move, index) => (
                  <option key={index} value={index}>
                    Move {Math.floor(index / 2) + 1} {index % 2 === 0 ? "(W)" : "(B)"} : {move.san}
                  </option>
                ))}
              </select>

              <button 
                onClick={() => handleStepMove(1)}
                disabled={currentMoveIndex >= moveHistory.length - 1}
                className="p-2 bg-white rounded shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-all"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>

            {/* Engine Analysis */}
            <div className="mt-6 border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-slate-700 flex items-center">
                  <Cpu className="h-4 w-4 mr-1 text-slate-500" /> {engineVersion}
                </h3>
                
                <button
                  onClick={() => {
                    setIsAutoEvalOn(!isAutoEvalOn);
                    if (isAutoEvalOn) {
                      setEvaluation(null);
                      setBestMove(null);
                    }
                  }}
                  disabled={!isPgnValid || !isEngineReady}
                  className={`flex items-center px-4 py-2 text-sm font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                    isAutoEvalOn 
                      ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200" 
                      : "bg-slate-200 text-slate-700 hover:bg-slate-300"
                  }`}
                >
                  {isAutoEvalOn ? <ToggleRight className="h-5 w-5 mr-2 text-emerald-600" /> : <ToggleLeft className="h-5 w-5 mr-2 text-slate-500" />}
                  {isAutoEvalOn ? "Auto-Eval: ON" : "Auto-Eval: OFF"}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Eval</div>
                  <div className={`text-xl font-bold ${
                    evaluation === "..." || evaluation === null || evaluation == 0 ? 'text-slate-500' : 
                    evaluation.toString().startsWith('-') ? 'text-slate-800' : 
                    'text-emerald-600'
                }`}>
                  {evaluation === null ? "--" : 
                  evaluation === "..." ? "..." : 
                  (typeof evaluation === 'number' && evaluation > 0 ? `+${evaluation}` : evaluation)}
                </div>
              </div>
              {evaluation !== null && evaluation !== "..." && (
                <div className="mt-4 h-2 w-full bg-slate-800 rounded-full overflow-hidden flex">
                  <div 
                    className="h-full bg-white transition-all duration-500 ease-out"
                    style={{ 
                      width: `${
                        evaluation.toString().includes('M') 
                          ? (evaluation.toString().startsWith('-') ? 0 : 100) 
                          : Math.max(5, Math.min(95, 50 + (parseFloat(evaluation) * 10)))
                      }%` 
                    }}
                  />
                </div>
              )}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                  <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Best Move</div>
                  <div className="text-xl font-bold text-indigo-600">
                    {displayBestMove !== null ? displayBestMove : "--"}
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>

      </main>
    </div>
  );
}