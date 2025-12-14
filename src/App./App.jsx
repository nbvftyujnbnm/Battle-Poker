import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  updateDoc,
  getDoc
} from 'firebase/firestore';
import { LucideFlag, LucideSwords, LucideTrophy, LucideRotateCcw, LucideCopy, LucideUsers, LucideShieldAlert } from 'lucide-react';

// --- Firebase Configuration ---
const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Game Constants & Logic ---
const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Role Strength
const FORMATIONS = {
  WEDGE: 5,     // Straight Flush
  PHALANX: 4,   // Three of a Kind
  BATTALION: 3, // Flush
  SKIRMISH: 2,  // Straight
  HOST: 1       // Sum
};

const COLOR_MAP = {
  red: 'bg-red-500 text-white border-red-700',
  orange: 'bg-orange-500 text-white border-orange-700',
  yellow: 'bg-yellow-400 text-black border-yellow-600',
  green: 'bg-green-600 text-white border-green-800',
  blue: 'bg-blue-600 text-white border-blue-800',
  purple: 'bg-purple-600 text-white border-purple-800',
  special: 'bg-stone-800 text-yellow-400 border-yellow-500 ring-2 ring-yellow-400/50' // For Tactics
};

// --- Helper Functions ---

const createDeck = () => {
  let deck = [];
  // Standard Cards
  COLORS.forEach(color => {
    NUMBERS.forEach(number => {
      deck.push({ color, number, type: 'number', id: `${color}-${number}` });
    });
  });
  
  // Tactics Cards (3 Leaders/Wilds)
  // In a full game there are more, but we start with 3 wild cards for balance in this version
  const tactics = [
    { name: 'Alexander', id: 'tac-alex' },
    { name: 'Darius', id: 'tac-darius' },
    { name: 'Hector', id: 'tac-hector' }
  ];
  
  tactics.forEach(t => {
    deck.push({ 
      color: 'special', 
      number: 0, 
      type: 'tactics', 
      name: t.name, 
      id: t.id 
    });
  });

  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

// Base evaluation for 3 specific cards (no wilds logic here)
const evaluateConcreteFormation = (cards) => {
  const nums = cards.map(c => c.number).sort((a, b) => a - b);
  const colors = cards.map(c => c.color);
  const sum = nums.reduce((a, b) => a + b, 0);
  
  const isFlush = colors.every(c => c === colors[0]);
  const isStraight = (nums[1] === nums[0] + 1) && (nums[2] === nums[1] + 1);
  const isThreeOfAKind = nums[0] === nums[2];

  if (isFlush && isStraight) return { type: FORMATIONS.WEDGE, score: sum, sum };
  if (isThreeOfAKind) return { type: FORMATIONS.PHALANX, score: nums[0], sum }; 
  if (isFlush) return { type: FORMATIONS.BATTALION, score: sum, sum };
  if (isStraight) return { type: FORMATIONS.SKIRMISH, score: sum, sum };
  
  return { type: FORMATIONS.HOST, score: sum, sum };
};

// Advanced evaluation handling Wild Cards
const evaluateBestFormation = (cards) => {
  if (cards.length !== 3) return { type: 0, score: 0, sum: 0 };

  const wildIndices = cards.map((c, i) => c.type === 'tactics' ? i : -1).filter(i => i !== -1);
  
  // If no wilds, use standard eval
  if (wildIndices.length === 0) {
    return evaluateConcreteFormation(cards);
  }

  // Generate all possible cards for simulation
  // (Optimization: We simulate replacing wilds with every possible standard card to find the best outcome)
  const allStandardCards = [];
  COLORS.forEach(c => NUMBERS.forEach(n => allStandardCards.push({ color: c, number: n })));

  let bestResult = { type: -1, score: -1, sum: -1 };

  // Helper to check if a result is better
  const updateBest = (res) => {
    if (res.type > bestResult.type) {
      bestResult = res;
    } else if (res.type === bestResult.type) {
      if (res.score > bestResult.score) {
        bestResult = res;
      }
    }
  };

  if (wildIndices.length === 1) {
    // 1 Wild: Try replacing it with every standard card
    const idx = wildIndices[0];
    const testHand = [...cards];
    
    for (const sub of allStandardCards) {
      testHand[idx] = sub;
      updateBest(evaluateConcreteFormation(testHand));
    }
  } else if (wildIndices.length === 2) {
    // 2 Wilds: Try replacing both (Double loop)
    const idx1 = wildIndices[0];
    const idx2 = wildIndices[1];
    const testHand = [...cards];

    // Optimization: If 2 wilds, the best possible is always a Wedge (Straight Flush)
    // We just need to match the 3rd card to make the highest possible Wedge.
    // E.g. if Card 3 is Red 5, best is Red 4,5,6 or Red 5,6,7? -> Red 9,10,Wild is best overall but we must use the non-wild card.
    // Actually, simplest logic is just brute force, it's only 3600 iterations, JS is fast enough.
    for (const sub1 of allStandardCards) {
      testHand[idx1] = sub1;
      for (const sub2 of allStandardCards) {
        testHand[idx2] = sub2;
        updateBest(evaluateConcreteFormation(testHand));
      }
    }
  } else {
    // 3 Wilds (Rare but possible): Best is Red 8,9,10 (Sum 27) or simply 10,10,10? 
    // BattleLine rule: 10,10,10 isn't valid set usually, but Phalanx 10,10,10 is strong.
    // Wedge 8,9,10 (Sum 27) is strongest possible sum for Wedge.
    return { type: FORMATIONS.WEDGE, score: 30, sum: 30 }; // Theoretical max
  }

  return bestResult;
};

// --- React Components ---

const Card = ({ card, onClick, isSelected, isPlayable, small = false }) => {
  if (!card) return <div className={`border-2 border-dashed border-gray-300 rounded bg-black/5 ${small ? 'w-8 h-12' : 'w-12 h-16 sm:w-16 sm:h-24'}`}></div>;

  const isTactics = card.type === 'tactics';

  return (
    <button 
      onClick={() => isPlayable && onClick && onClick(card)}
      className={`
        relative flex flex-col items-center justify-center shadow-md rounded border-2 transition-all duration-200 overflow-hidden
        ${COLOR_MAP[card.color]}
        ${small ? 'w-8 h-12' : 'w-12 h-16 sm:w-16 sm:h-24'}
        ${isSelected ? 'ring-4 ring-white -translate-y-2 z-10 shadow-xl' : ''}
        ${!isPlayable ? 'opacity-80 cursor-default' : 'cursor-pointer hover:-translate-y-1 hover:shadow-lg'}
      `}
    >
      {isTactics ? (
        <>
          <div className={`${small ? 'text-[8px]' : 'text-xs sm:text-sm'} font-bold uppercase tracking-tighter opacity-80 absolute top-1`}>Leader</div>
          <LucideShieldAlert className={`${small ? 'w-4 h-4' : 'w-6 h-6 sm:w-8 sm:h-8'}`} />
        </>
      ) : (
        <span className={`${small ? 'text-sm' : 'text-xl sm:text-3xl'} font-bold`}>{card.number}</span>
      )}
    </button>
  );
};

// Main App
export default function BattleLineTactics() {
  const [user, setUser] = useState(null);
  const [gameId, setGameId] = useState('');
  const [gameState, setGameState] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 1. Auth & Init
  useEffect(() => {
    const initAuth = async () => {
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token);
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // 2. Sync Game State
  useEffect(() => {
    if (!user || !gameId) return;

    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    
    const unsubscribe = onSnapshot(gameRef, (docSnap) => {
      if (docSnap.exists()) {
        setGameState(docSnap.data());
      } else {
        setError("ゲームが見つかりません");
      }
    }, (err) => {
      console.error(err);
      setError("同期エラー");
    });

    return () => unsubscribe();
  }, [user, gameId]);

  // --- Actions ---

  const createGame = async () => {
    if (!user) return;
    setLoading(true);
    const newGameId = Math.random().toString(36).substring(2, 6).toUpperCase();
    const deck = createDeck();
    
    // Initial Hand: 7 cards
    const hostHand = deck.splice(0, 7);
    const guestHand = deck.splice(0, 7);

    const board = Array(9).fill(null).map((_, i) => ({
      id: i,
      hostCards: [],
      guestCards: [],
      winner: null
    }));

    const initialData = {
      gameId: newGameId,
      hostId: user.uid,
      guestId: null,
      status: 'waiting',
      turn: 'host',
      deck,
      hostHand,
      guestHand,
      board,
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', newGameId), initialData);
      setGameId(newGameId);
    } catch (e) {
      console.error(e);
      setError("作成失敗");
    }
    setLoading(false);
  };

  const joinGame = async (inputGameId) => {
    if (!user || !inputGameId) return;
    setLoading(true);
    const id = inputGameId.trim().toUpperCase();
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', id);

    try {
      const snap = await getDoc(gameRef);
      if (!snap.exists()) {
        setError("ゲームが見つかりません");
        setLoading(false);
        return;
      }
      
      const data = snap.data();
      if (data.status !== 'waiting' && data.guestId !== user.uid && data.hostId !== user.uid) {
        setError("参加不可");
        setLoading(false);
        return;
      }

      if (data.hostId !== user.uid && !data.guestId) {
        await updateDoc(gameRef, {
          guestId: user.uid,
          status: 'playing'
        });
      }
      setGameId(id);
    } catch (e) {
      console.error(e);
      setError("参加エラー");
    }
    setLoading(false);
  };

  const playCard = async (slotIndex) => {
    if (!user || !gameState || !selectedCard) return;

    const isHost = gameState.hostId === user.uid;
    const playerRole = isHost ? 'host' : 'guest';
    
    if (gameState.turn !== playerRole) return; 
    if (gameState.board[slotIndex].winner) return;

    const currentSlotCards = isHost ? gameState.board[slotIndex].hostCards : gameState.board[slotIndex].guestCards;
    if (currentSlotCards.length >= 3) return;

    // --- Core Logic ---
    const newBoard = [...gameState.board];
    const targetSlot = { ...newBoard[slotIndex] };
    
    if (isHost) {
      targetSlot.hostCards = [...targetSlot.hostCards, selectedCard];
    } else {
      targetSlot.guestCards = [...targetSlot.guestCards, selectedCard];
    }

    // Resolve Flag
    let flagWinner = targetSlot.winner;
    if (targetSlot.hostCards.length === 3 && targetSlot.guestCards.length === 3) {
      const hostEval = evaluateBestFormation(targetSlot.hostCards);
      const guestEval = evaluateBestFormation(targetSlot.guestCards);

      // Debug
      console.log(`Slot ${slotIndex}: Host(${hostEval.type}/${hostEval.score}), Guest(${guestEval.type}/${guestEval.score})`);

      if (hostEval.type > guestEval.type) {
        flagWinner = 'host';
      } else if (guestEval.type > hostEval.type) {
        flagWinner = 'guest';
      } else {
        if (hostEval.score > guestEval.score) {
          flagWinner = 'host';
        } else if (guestEval.score > hostEval.score) {
          flagWinner = 'guest';
        } else {
          // Tie goes to defender (second player)? Or null?
          // BattleLine: Tie goes to whoever played last (defender wins tie), usually.
          // Let's give it to the active player (the one who just completed the slot) for simplicity if they managed to TIE a completed slot?
          // Actually, if it's a pure tie, the flag remains unclaimed usually until broken, but since both are full (3 cards), it's a dead lock.
          // Rule: "If the formations are identical, the sum of the numbers wins. If sums are equal, the player who completed the formation LAST loses."
          // So the Current Player loses the tie.
          flagWinner = isHost ? 'guest' : 'host';
        }
      }
    }
    targetSlot.winner = flagWinner;
    newBoard[slotIndex] = targetSlot;

    // Hand & Deck Management
    let newDeck = [...gameState.deck];
    let newHand = isHost ? [...gameState.hostHand] : [...gameState.guestHand];
    
    newHand = newHand.filter(c => c.id !== selectedCard.id);
    
    if (newDeck.length > 0) {
      const drawnCard = newDeck.shift();
      newHand.push(drawnCard);
    }

    // Win Check
    let hostFlags = 0;
    let guestFlags = 0;
    let consecHost = 0;
    let consecGuest = 0;
    let maxConsecHost = 0;
    let maxConsecGuest = 0;

    newBoard.forEach(slot => {
      if (slot.winner === 'host') {
        hostFlags++;
        consecHost++;
        consecGuest = 0;
      } else if (slot.winner === 'guest') {
        guestFlags++;
        consecGuest++;
        consecHost = 0;
      } else {
        consecHost = 0;
        consecGuest = 0;
      }
      maxConsecHost = Math.max(maxConsecHost, consecHost);
      maxConsecGuest = Math.max(maxConsecGuest, consecGuest);
    });

    let newStatus = gameState.status;
    let winnerId = null;

    if (hostFlags >= 5 || maxConsecHost >= 3) {
      newStatus = 'finished';
      winnerId = gameState.hostId;
    } else if (guestFlags >= 5 || maxConsecGuest >= 3) {
      newStatus = 'finished';
      winnerId = gameState.guestId;
    } else if (newDeck.length === 0 && newHand.length === 0) {
      // Draw condition or count flags
      if (hostFlags > guestFlags) winnerId = gameState.hostId;
      else if (guestFlags > hostFlags) winnerId = gameState.guestId;
      newStatus = 'finished';
    }

    const updates = {
      board: newBoard,
      deck: newDeck,
      turn: isHost ? 'guest' : 'host',
      status: newStatus,
      winnerId: winnerId || null
    };

    if (isHost) updates.hostHand = newHand;
    else updates.guestHand = newHand;

    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId), updates);
    setSelectedCard(null);
  };

  // --- Views ---

  if (!user) return <div className="h-screen flex justify-center items-center">Loading...</div>;

  if (!gameId) {
    return (
      <div className="min-h-screen bg-stone-900 text-stone-100 p-6 flex flex-col items-center justify-center font-sans">
        <h1 className="text-5xl font-black mb-8 flex items-center gap-3 text-yellow-500">
          <LucideSwords size={48} />
          <span className="tracking-tighter">BATTLE LINE</span>
          <span className="text-xs bg-yellow-600 text-stone-900 px-2 py-1 rounded align-top self-start mt-2">TACTICS</span>
        </h1>
        
        <div className="bg-stone-800 p-8 rounded-xl shadow-2xl w-full max-w-md space-y-6 border border-stone-700">
          <button 
            onClick={createGame} 
            disabled={loading}
            className="w-full bg-yellow-600 hover:bg-yellow-500 text-stone-900 font-black py-4 rounded-lg text-lg transition shadow-lg flex justify-center items-center gap-2"
          >
            {loading ? 'DEPLOYING...' : 'NEW GAME'}
          </button>
          
          <div className="flex items-center text-stone-500 text-sm">
            <div className="flex-grow border-t border-stone-700"></div>
            <span className="mx-4">OR JOIN</span>
            <div className="flex-grow border-t border-stone-700"></div>
          </div>

          <form onSubmit={(e) => { e.preventDefault(); joinGame(e.target.gameIdInput.value); }} className="flex gap-2">
            <input 
              name="gameIdInput"
              type="text" 
              placeholder="ROOM ID" 
              className="flex-1 p-3 bg-stone-900 border border-stone-600 rounded-lg text-white focus:ring-2 focus:ring-yellow-500 outline-none uppercase tracking-widest font-mono text-center"
            />
            <button 
              type="submit"
              disabled={loading}
              className="bg-stone-700 hover:bg-stone-600 text-white font-bold px-6 rounded-lg"
            >
              JOIN
            </button>
          </form>
          {error && <p className="text-red-400 text-center text-sm">{error}</p>}
        </div>
      </div>
    );
  }

  if (!gameState) return <div className="h-screen flex justify-center items-center bg-stone-900 text-white">Loading Field...</div>;

  const isHost = user.uid === gameState.hostId;
  const myRole = isHost ? 'host' : 'guest';
  const myHand = isHost ? gameState.hostHand : gameState.guestHand;
  const isMyTurn = gameState.status === 'playing' && gameState.turn === myRole;

  if (gameState.status === 'finished') {
    const isWinner = gameState.winnerId === user.uid;
    return (
      <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center text-white p-4">
        <div className="bg-stone-800 p-10 rounded-3xl shadow-2xl text-center max-w-md w-full border-2 border-stone-700 relative overflow-hidden">
          <div className={`absolute inset-0 opacity-10 ${isWinner ? 'bg-yellow-500' : 'bg-red-900'}`}></div>
          <div className="relative z-10">
            {isWinner ? (
              <>
                <LucideTrophy className="w-24 h-24 text-yellow-400 mx-auto mb-6 animate-bounce" />
                <h2 className="text-5xl font-black mb-2 text-yellow-400 tracking-tighter">VICTORY</h2>
                <p className="text-stone-400 mb-8">戦線を制圧しました！</p>
              </>
            ) : (
              <>
                <LucideFlag className="w-24 h-24 text-red-500 mx-auto mb-6" />
                <h2 className="text-5xl font-black mb-2 text-stone-500 tracking-tighter">DEFEAT</h2>
                <p className="text-stone-400 mb-8">戦線が崩壊しました...</p>
              </>
            )}
            <button 
              onClick={() => { setGameId(''); setGameState(null); }}
              className="bg-stone-100 text-stone-900 px-8 py-3 rounded-full font-bold hover:bg-white transition w-full flex items-center justify-center gap-2"
            >
              <LucideRotateCcw size={20} />
              RETURN TO LOBBY
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (gameState.status === 'waiting') {
    return (
      <div className="min-h-screen bg-stone-800 flex flex-col items-center justify-center p-6 text-white">
        <div className="bg-stone-900 p-8 rounded-xl shadow-2xl w-full max-w-md text-center border border-stone-700">
          <LucideUsers size={48} className="text-yellow-500 mx-auto mb-4 animate-pulse" />
          <h2 className="text-xl font-bold mb-4">WAITING FOR OPPONENT</h2>
          <div className="bg-stone-800 p-4 rounded-lg flex items-center justify-between mb-2 border border-stone-700">
            <span className="text-4xl font-mono font-bold tracking-widest text-yellow-500">{gameId}</span>
            <button onClick={() => navigator.clipboard.writeText(gameId)} className="text-stone-400 hover:text-white"><LucideCopy /></button>
          </div>
          <p className="text-xs text-stone-500 mt-4">Share this code to start the battle.</p>
        </div>
      </div>
    );
  }

  // --- Playing View ---
  return (
    <div className="h-screen flex flex-col bg-stone-200 overflow-hidden font-sans">
      {/* Top Bar */}
      <div className="bg-stone-900 text-white p-3 flex justify-between items-center shadow-lg z-30 shrink-0">
        <div className="flex items-center gap-3">
           <span className="text-xs font-mono bg-stone-800 px-2 py-1 rounded text-stone-400">ID: {gameId}</span>
           <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-bold transition-colors ${isMyTurn ? 'bg-yellow-600 text-black' : 'bg-stone-800 text-stone-500'}`}>
             {isMyTurn ? <><LucideSwords size={14}/> YOUR TURN</> : "OPPONENT'S TURN"}
           </div>
        </div>
        <div className="text-xs font-mono text-stone-500">
          DECK: {gameState.deck.length}
        </div>
      </div>

      {/* Battlefield (Scrollable) */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden bg-stone-300 relative shadow-inner">
        <div className="absolute inset-0 min-w-[800px] flex flex-col h-full">
          
          {/* Opponent Area */}
          <div className="flex-1 flex items-end justify-center pb-2 gap-2 px-4 border-b border-stone-400/20 bg-stone-300/50">
             <div className="absolute top-2 right-2 flex -space-x-10 opacity-60 scale-75 origin-top-right">
                {Array((isHost ? gameState.guestHand.length : gameState.hostHand.length) || 0).fill(0).map((_, i) => (
                  <div key={i} className="w-14 h-20 bg-stone-800 rounded border border-stone-600 shadow-sm bg-[url('https://www.transparenttextures.com/patterns/diagmonds-light.png')]"></div>
                ))}
             </div>
          </div>

          {/* FLAGG LINE */}
          <div className="h-[380px] sm:h-[480px] flex items-center justify-center px-4 gap-2 sm:gap-4 bg-stone-300">
            {gameState.board.map((slot, i) => {
              const mySlotCards = isHost ? slot.hostCards : slot.guestCards;
              const oppSlotCards = isHost ? slot.guestCards : slot.hostCards;
              const isSlotWon = !!slot.winner;
              const isMyFlag = slot.winner === myRole;
              const isOppFlag = slot.winner === (isHost ? 'guest' : 'host');

              return (
                <div 
                  key={i} 
                  onClick={() => isMyTurn && !isSlotWon && selectedCard && playCard(i)}
                  className={`
                    relative w-16 sm:w-24 h-full flex flex-col items-center justify-center transition-all duration-300 rounded-lg group
                    ${!isSlotWon && isMyTurn && selectedCard && mySlotCards.length < 3 ? 'bg-yellow-100/40 cursor-pointer ring-4 ring-yellow-400/30 scale-[1.02]' : ''}
                    ${isSlotWon ? (isMyFlag ? 'bg-blue-100/50' : 'bg-red-100/50') : 'bg-stone-200/50'}
                  `}
                >
                  {/* Opponent Cards */}
                  <div className="flex flex-col-reverse items-center justify-start gap-1 h-[140px] w-full py-1">
                    {oppSlotCards.map((c, idx) => <Card key={`opp-${i}-${idx}`} card={c} small />)}
                  </div>

                  {/* Flag Status */}
                  <div className={`
                    z-10 w-10 h-10 rounded-full flex items-center justify-center shadow-lg my-1 transition-transform duration-500
                    ${isMyFlag ? 'bg-blue-600 text-white scale-110 rotate-12' : isOppFlag ? 'bg-red-600 text-white scale-110 -rotate-12' : 'bg-stone-100 text-stone-300 border-2 border-stone-300'}
                  `}>
                    <LucideFlag size={20} fill={isSlotWon ? "currentColor" : "none"} />
                  </div>

                  {/* My Cards */}
                  <div className="flex flex-col items-center justify-start gap-1 h-[140px] w-full py-1">
                    {mySlotCards.map((c, idx) => <Card key={`my-${i}-${idx}`} card={c} small />)}
                  </div>
                  
                  {/* Slot Highlight on Hover */}
                  {!isSlotWon && isMyTurn && selectedCard && mySlotCards.length < 3 && (
                    <div className="absolute inset-0 bg-yellow-400/10 rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity"></div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex-1 bg-stone-300/50"></div>
        </div>
      </div>

      {/* Hand Area */}
      <div className="h-[150px] sm:h-[200px] bg-stone-100 border-t-4 border-stone-300 p-2 shrink-0 z-40 shadow-[0_-5px_20px_rgba(0,0,0,0.1)]">
        <div className="text-xs text-stone-500 text-center mb-1 font-bold tracking-widest uppercase">
          {isMyTurn ? "Select Card & Target Flag" : "Opponent is thinking..."}
        </div>
        <div className="flex justify-center items-center gap-2 overflow-x-auto h-full pb-2 px-4 scrollbar-hide">
          {myHand.map((card) => (
            <Card 
              key={card.id} 
              card={card} 
              isPlayable={isMyTurn}
              isSelected={selectedCard?.id === card.id}
              onClick={() => setSelectedCard(card)} 
            />
          ))}
        </div>
      </div>
    </div>
  );
}


