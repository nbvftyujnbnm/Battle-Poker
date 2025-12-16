import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged
} from 'firebase/auth';
import { 
  getFirestore, 
  collection, 
  doc, 
  getDoc,
  setDoc, 
  onSnapshot, 
  updateDoc, 
  arrayUnion,
  serverTimestamp,
  initializeFirestore
} from 'firebase/firestore';
import { 
  Shield, 
  Swords, 
  Crown, 
  Users, 
  Copy, 
  Play, 
  RotateCcw,
  Trophy, 
  AlertCircle,
  Download,
  Share2,
  Eye,
  Gavel,
  CheckCircle2,
  XCircle,
  MessageCircle,
  Send,
  X,
  Ban,
  ArrowRight,
  Cloud,
  Zap,
  Scroll,
  Layers,
  Info,
  Trash2,
  Reply,
  Move,
  HelpCircle,
  ArrowDownWideNarrow
} from 'lucide-react';

// --- Firebase Init ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});

const appId = 'battle-line-prod';

// --- Game Constants ---
const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];
const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const FLAGS_COUNT = 9;
const HAND_SIZE = 7;

// --- Helper Functions ---
const createDeck = () => {
  let deck = [];
  COLORS.forEach(color => {
    VALUES.forEach(value => {
      deck.push({ id: `${color}-${value}`, color, value, type: 'number' });
    });
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const createTacticsDeck = () => {
  const tactics = [
    { id: 't-leader-1', type: 'tactics', subType: 'morale', name: 'Alexander', description: '【リーダー】ワイルドカード（色・数を自由に指定）。1人1枚まで。' },
    { id: 't-leader-2', type: 'tactics', subType: 'morale', name: 'Darius', description: '【リーダー】ワイルドカード（色・数を自由に指定）。1人1枚まで。' },
    { id: 't-cavalry', type: 'tactics', subType: 'morale', name: 'Companion Cavalry', description: '【援軍騎兵】好きな色の「8」として使用。' },
    { id: 't-shield', type: 'tactics', subType: 'morale', name: 'Shield Bearers', description: '【盾】好きな色の「1, 2, 3」のいずれかとして使用。' },
    { id: 't-fog', type: 'tactics', subType: 'environment', name: 'Fog', description: '【霧】このフラッグは役が無効になり、合計値勝負になる。' },
    { id: 't-mud', type: 'tactics', subType: 'environment', name: 'Mud', description: '【泥濘】このフラッグは4枚のカードでフォーメーションを作る。' },
    { id: 't-scout', type: 'tactics', subType: 'guile', name: 'Scout', description: '【偵察】山札から合計3枚引き、手札から2枚を山札に戻す。' },
    { id: 't-redeploy', type: 'tactics', subType: 'guile', name: 'Redeploy', description: '【配置転換】自分のカードを別のフラッグへ移動、または破棄する。' },
    { id: 't-deserter', type: 'tactics', subType: 'guile', name: 'Deserter', description: '【脱走】相手のカードを1枚選び、ゲームから除外する。' },
    { id: 't-traitor', type: 'tactics', subType: 'guile', name: 'Traitor', description: '【裏切り】相手のカードを奪い、自分のフラッグに配置する。' },
  ];
  for (let i = tactics.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tactics[i], tactics[j]] = [tactics[j], tactics[i]];
  }
  return tactics;
};

// --- Formation Logic ---
const calculateRawScore = (cards) => {
  const sorted = [...cards].sort((a, b) => a.value - b.value);
  const values = sorted.map(c => c.value);
  const colors = sorted.map(c => c.color);
  const sum = values.reduce((a, b) => a + b, 0);
  const len = cards.length;

  const isFlush = colors.every(c => c === colors[0]);
  let isStraight = true;
  for (let i = 0; i < len - 1; i++) {
    if (values[i + 1] !== values[i] + 1) isStraight = false;
  }
  const isNOfAKind = values.every(v => v === values[0]);

  let tier = 1;
  if (isStraight && isFlush) tier = 5;
  else if (isNOfAKind) tier = 4;
  else if (isFlush) tier = 3;
  else if (isStraight) tier = 2;

  return { tier, sum };
};

const resolveBestFormation = (currentCards, index, isFog) => {
  if (index === currentCards.length) {
    const score = calculateRawScore(currentCards);
    if (isFog) return { tier: 0, sum: score.sum };
    return score;
  }

  const card = currentCards[index];
  if (!card.type || card.type === 'number') {
    return resolveBestFormation(currentCards, index + 1, isFog);
  }

  let bestResult = { tier: -1, sum: -1 };
  let possibilities = [];

  if (card.name === 'Alexander' || card.name === 'Darius') {
    COLORS.forEach(c => VALUES.forEach(v => possibilities.push({ color: c, value: v })));
  } else if (card.name === 'Companion Cavalry') {
    COLORS.forEach(c => possibilities.push({ color: c, value: 8 }));
  } else if (card.name === 'Shield Bearers') {
    COLORS.forEach(c => [1, 2, 3].forEach(v => possibilities.push({ color: c, value: v })));
  } else {
    possibilities.push({ color: 'gray', value: 0 });
  }

  for (const p of possibilities) {
    const nextCards = [...currentCards];
    nextCards[index] = { ...card, ...p, isResolved: true };
    const res = resolveBestFormation(nextCards, index + 1, isFog);
    if (res.tier > bestResult.tier) bestResult = res;
    else if (res.tier === bestResult.tier && res.sum > bestResult.sum) bestResult = res;
  }
  return bestResult;
};

const evaluateFormation = (cards, environment) => {
  try {
    const isMud = environment?.name === 'Mud';
    const isFog = environment?.name === 'Fog';
    const requiredCount = isMud ? 4 : 3;
    if (cards.length !== requiredCount) return { tier: 0, sum: 0 };
    return resolveBestFormation(cards, 0, isFog);
  } catch (e) {
    console.error("Eval Error:", e);
    return { tier: 0, sum: 0 };
  }
};

const checkWinner = (flags) => {
  let hostCount = 0;
  let guestCount = 0;
  let hostConsecutive = 0;
  let guestConsecutive = 0;

  for (let i = 0; i < flags.length; i++) {
    if (flags[i].owner === 'host') {
      hostCount++;
      hostConsecutive++;
      guestConsecutive = 0;
    } else if (flags[i].owner === 'guest') {
      guestCount++;
      guestConsecutive++;
      hostConsecutive = 0;
    } else {
      hostConsecutive = 0;
      guestConsecutive = 0;
    }
    if (hostConsecutive >= 3) return 'host';
    if (guestConsecutive >= 3) return 'guest';
  }
  if (hostCount >= 5) return 'host';
  if (guestCount >= 5) return 'guest';
  return null;
};

const calculateTacticsCount = (game) => {
  let hostCount = (game.hostGuile || []).length;
  let guestCount = (game.guestGuile || []).length;

  game.flags.forEach(flag => {
    flag.hostCards.forEach(c => { if(c.type === 'tactics') hostCount++; });
    flag.guestCards.forEach(c => { if(c.type === 'tactics') guestCount++; });
    if (flag.environment) {
      if (flag.environment.playedBy === 'host') hostCount++;
      else if (flag.environment.playedBy === 'guest') guestCount++;
    }
  });

  return { hostCount, guestCount };
};

// --- Components ---

const Card = ({ card, hidden, onClick, selected, disabled, isLastPlayed, className = "" }) => {
  if (!card) return <div className={`w-12 h-16 sm:w-16 sm:h-24 border-2 border-dashed border-gray-300 rounded-lg flex-shrink-0 ${className}`}></div>;
  
  if (hidden) {
    const isTactics = card.type === 'tactics';
    const bgClass = isTactics ? 'bg-orange-900 border-orange-700' : 'bg-slate-700 border-slate-600';
    const innerClass = isTactics ? 'bg-orange-800' : 'bg-slate-600';
    return (
      <div className={`w-10 h-14 sm:w-16 sm:h-24 rounded-lg border-2 shadow-sm flex items-center justify-center flex-shrink-0 ${bgClass} ${className}`}>
        <div className={`w-6 h-10 rounded-sm opacity-50 ${innerClass}`}></div>
      </div>
    );
  }

  // Highlight style for the last played card
  const highlightClass = isLastPlayed ? 'ring-2 ring-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.6)] z-10' : '';

  if (card.type === 'tactics') {
    let typeColor = "bg-slate-200 border-slate-400 text-slate-700";
    let TypeIcon = Zap;
    if (card.subType === 'environment') { typeColor = "bg-emerald-100 border-emerald-400 text-emerald-700"; TypeIcon = Cloud; }
    if (card.subType === 'guile') { typeColor = "bg-purple-100 border-purple-400 text-purple-700"; TypeIcon = Scroll; }
    if (card.subType === 'morale') { typeColor = "bg-orange-100 border-orange-400 text-orange-700"; TypeIcon = Zap; }

    return (
      <div onClick={!disabled ? onClick : undefined} className={`relative w-10 h-14 sm:w-16 sm:h-24 rounded-lg border-2 shadow-sm flex flex-col items-center justify-center p-1 cursor-pointer transition-all duration-200 flex-shrink-0 select-none ${typeColor} ${selected ? 'ring-4 ring-slate-800 -translate-y-4 z-10' : !disabled ? 'active:scale-95' : 'opacity-50 cursor-not-allowed'} ${highlightClass} ${className}`}>
        <TypeIcon size={20} />
        <span className="text-[9px] sm:text-xs font-bold text-center leading-tight mt-0.5 line-clamp-2">{card.name}</span>
      </div>
    );
  }

  const colorMap = {
    red: 'bg-red-100 text-red-600 border-red-300',
    orange: 'bg-orange-100 text-orange-600 border-orange-300',
    yellow: 'bg-yellow-100 text-yellow-600 border-yellow-300',
    green: 'bg-green-100 text-green-600 border-green-300',
    blue: 'bg-blue-100 text-blue-600 border-blue-300',
    purple: 'bg-purple-100 text-purple-600 border-purple-300',
  };

  return (
    <div onClick={!disabled ? onClick : undefined} className={`relative w-10 h-14 sm:w-16 sm:h-24 rounded-lg border-2 shadow-sm flex flex-col items-center justify-between p-0.5 sm:p-1 cursor-pointer transition-all duration-200 flex-shrink-0 select-none ${colorMap[card.color]} ${selected ? 'ring-4 ring-slate-800 -translate-y-4 z-10' : !disabled ? 'active:scale-95' : 'opacity-50 cursor-not-allowed'} ${highlightClass} ${className}`}>
      <span className="text-[10px] sm:text-sm font-bold self-start leading-none">{card.value}</span>
      <div className={`w-2.5 h-2.5 sm:w-4 sm:h-4 rounded-full opacity-50 bg-current`} />
      <span className="text-[10px] sm:text-sm font-bold self-end leading-none rotate-180">{card.value}</span>
    </div>
  );
};

// FlagSpot: Receives lastPlacedCard
const FlagSpot = ({ index, data, isHost, onPlayToFlag, onClaim, onConcede, onDeny, onCancelClaim, onEnvironmentClick, onCardClick, onFlagClick, onZoom, canPlay, isSpectator, isMyTurn, interactionMode, lastPlacedCard }) => {
  const isOwner = data.owner === (isHost ? 'host' : 'guest');
  let statusColor = "bg-gray-200 border-gray-300";
  let Icon = Shield;
  if (data.owner === 'host') { statusColor = "bg-blue-100 border-blue-400"; Icon = isHost ? Trophy : AlertCircle; }
  else if (data.owner === 'guest') { statusColor = "bg-red-100 border-red-400"; Icon = !isHost ? Trophy : AlertCircle; }

  const myRole = isHost ? 'host' : 'guest';
  const hasClaim = data.proofClaim && data.proofClaim.claimant;
  const isMyClaim = hasClaim === myRole;
  const showActions = !isSpectator && !data.owner && !interactionMode; 
  
  const isMud = data.environment?.name === 'Mud';
  const maxSlots = isMud ? 4 : 3;
  const hostFull = data.hostCards.length >= maxSlots;
  const guestFull = data.guestCards.length >= maxSlots;
  const isOpponent = (isHost, cardSide) => (isHost && cardSide === 'guest') || (!isHost && cardSide === 'host');

  // Check if environment card was the last played
  const isLastEnv = lastPlacedCard?.type === 'environment' && lastPlacedCard?.flagIndex === index;

  return (
    <div className="flex flex-col items-center gap-0.5 sm:gap-2 snap-center flex-shrink-0 px-0.5 relative">
      {data.environment ? (
         <button onClick={(e) => { e.stopPropagation(); onEnvironmentClick(data.environment); }} className={`absolute -top-6 bg-emerald-100 text-emerald-800 border border-emerald-300 px-1.5 py-0.5 rounded-full text-[9px] flex items-center gap-1 whitespace-nowrap shadow-sm z-10 hover:bg-emerald-200 active:scale-95 ${isLastEnv ? 'ring-2 ring-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.8)]' : ''}`}>
           <Cloud size={10} /> <span className="max-w-[50px] truncate">{data.environment.name}</span><Info size={8} className="opacity-50"/>
         </button>
      ) : null}

      <div className="flex flex-col gap-0.5">
        {Array.from({ length: maxSlots }).map((_, i) => {
          const cardSide = isHost ? 'guest' : 'host';
          const card = isHost ? data.guestCards[i] : data.hostCards[i];
          const isOpponentCard = true;
          const canTraitor = interactionMode === 'select_traitor_source' && card && isOpponentCard;
          const canDeserter = interactionMode === 'select_deserter_target' && card && isOpponentCard;
          const canInteract = canTraitor || canDeserter;
          
          // Check for Last Played Card
          const isLast = lastPlacedCard && lastPlacedCard.type !== 'environment' && lastPlacedCard.flagIndex === index && lastPlacedCard.side === cardSide && lastPlacedCard.cardIndex === i;

          return (
            <div key={`opp-${i}`} className="w-10 h-6 sm:w-16 sm:h-12 flex justify-center">
               {card ? (
                 <div className="relative">
                   <Card 
                     card={card} 
                     isLastPlayed={isLast}
                     onClick={() => {
                        if (canInteract && onCardClick) onCardClick(index, i, isHost ? 'guest' : 'host');
                        else if (!interactionMode && onZoom) onZoom(card);
                     }} 
                     className={canInteract ? 'ring-2 ring-red-500 cursor-pointer hover:scale-105 z-20' : ''}
                   />
                   {canInteract && <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-lg pointer-events-none"><Trash2 className="text-red-600"/></div>}
                 </div>
               ) : <div className="w-10 h-14 sm:w-16 sm:h-24 border border-dashed border-gray-300 rounded opacity-50 scale-75 origin-top" />}
            </div>
          );
        })}
      </div>

      <div className="relative z-10 my-1">
        <button 
          disabled={(!canPlay || data.owner || (isHost ? hostFull : guestFull)) && !(interactionMode === 'select_traitor_target' && !data.owner && (isHost ? !hostFull : !guestFull)) && !(interactionMode === 'redeploy_action' && !data.owner && (isHost ? !hostFull : !guestFull))}
          onClick={() => {
            if ((interactionMode === 'select_traitor_target' || interactionMode === 'redeploy_action') && onFlagClick) onFlagClick(index);
            else onPlayToFlag(index);
          }}
          className={`
            w-8 h-8 sm:w-12 sm:h-12 rounded-full border-2 sm:border-4 flex items-center justify-center shadow-inner transition-all flex-shrink-0 touch-manipulation
            ${statusColor}
            ${canPlay && !data.owner && (isHost ? !hostFull : !guestFull) ? 'animate-pulse hover:scale-110 ring-2 ring-yellow-400 cursor-pointer' : ''}
            ${hasClaim ? 'ring-2 ring-purple-500 animate-bounce' : ''}
            ${(interactionMode === 'select_traitor_target' || interactionMode === 'redeploy_action') && !data.owner && (isHost ? !hostFull : !guestFull) ? 'ring-4 ring-green-500 animate-pulse bg-green-100 scale-110 cursor-pointer z-30' : ''}
          `}
        >
          {data.owner ? <Icon className={`w-4 h-4 sm:w-6 sm:h-6 ${data.owner === 'host' ? 'text-blue-600' : 'text-red-600'}`} /> : 
           hasClaim ? <Gavel className="w-4 h-4 sm:w-6 sm:h-6 text-purple-600" /> : 
           <span className="text-gray-400 text-[10px] sm:text-xs font-bold">{index + 1}</span>}
        </button>

        {showActions && (
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex gap-1 z-20">
            {!hasClaim ? (
              isMyTurn && <button onClick={(e) => { e.stopPropagation(); onClaim(index); }} className="bg-white border border-slate-300 rounded-full p-1 shadow-sm hover:bg-slate-50 text-slate-500"><Gavel size={12} /></button>
            ) : isMyClaim ? (
              <button onClick={(e) => { e.stopPropagation(); onCancelClaim(index); }} className="bg-white border border-red-200 rounded-full p-1 shadow-sm hover:bg-red-50 text-red-500"><XCircle size={12} /></button>
            ) : (
              <>
                <button onClick={(e) => { e.stopPropagation(); onConcede(index); }} className="bg-green-500 border border-green-600 rounded-full p-1 shadow-sm hover:bg-green-600 text-white animate-pulse"><CheckCircle2 size={12} /></button>
                <button onClick={(e) => { e.stopPropagation(); onDeny(index); }} className="bg-white border border-slate-300 rounded-full p-1 shadow-sm hover:bg-slate-100 text-slate-500"><Ban size={12} /></button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-0.5">
        {Array.from({ length: maxSlots }).map((_, i) => {
          const cardSide = isHost ? 'host' : 'guest';
          const card = isHost ? data.hostCards[i] : data.guestCards[i];
          const canRedeploy = interactionMode === 'select_redeploy_source' && card && !data.owner;
          const isLast = lastPlacedCard && lastPlacedCard.type !== 'environment' && lastPlacedCard.flagIndex === index && lastPlacedCard.side === cardSide && lastPlacedCard.cardIndex === i;

          return (
            <div key={`my-${i}`} className="w-10 h-6 sm:w-16 sm:h-12 flex justify-center">
               {card ? (
                 <div className="relative">
                   <Card 
                     card={card} 
                     isLastPlayed={isLast}
                     onClick={() => {
                        if (canRedeploy && onCardClick) onCardClick(index, i, isHost ? 'host' : 'guest');
                        else if (!interactionMode && onZoom) onZoom(card);
                     }}
                     className={canRedeploy ? 'ring-2 ring-blue-500 cursor-pointer hover:scale-105 z-20' : ''}
                   />
                   {canRedeploy && <div className="absolute inset-0 flex items-center justify-center bg-black/10 rounded-lg pointer-events-none"><Move className="text-blue-600"/></div>}
                 </div>
               ) : <div className="w-10 h-14 sm:w-16 sm:h-24 border border-dashed border-gray-300 rounded opacity-50 scale-75 origin-bottom" />}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null);
  const [gameId, setGameId] = useState("");
  const [game, setGame] = useState(null);
  const [selectedCardIdx, setSelectedCardIdx] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const flagsContainerRef = useRef(null);

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [chatMessage, setChatMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [viewingCard, setViewingCard] = useState(null);
  
  const [interactionMode, setInteractionMode] = useState(null);
  const [scoutDrawCount, setScoutDrawCount] = useState(0);
  const [scoutReturnCount, setScoutReturnCount] = useState(0);
  const [selectedBoardCard, setSelectedBoardCard] = useState(null);
  const [sortState, setSortState] = useState(0); 
  
  const chatEndRef = useRef(null);
  const lastReadCountRef = useRef(0);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (let registration of registrations) registration.unregister();
      });
    }
  }, []);

  useEffect(() => {
    const metaTags = [
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'theme-color', content: '#f1f5f9' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover' }
    ];
    metaTags.forEach(tag => {
      let el = document.querySelector(`meta[name="${tag.name}"]`);
      if (!el) { el = document.createElement('meta'); el.name = tag.name; document.head.appendChild(el); }
      el.content = tag.content;
    });
    const handleContext = (e) => e.preventDefault();
    document.addEventListener('contextmenu', handleContext);
    const handleInstall = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', handleInstall);
    return () => {
      document.removeEventListener('contextmenu', handleContext);
      window.removeEventListener('beforeinstallprompt', handleInstall);
    };
  }, []);

  const triggerInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  useEffect(() => {
    const initAuth = async () => {
      try { await signInAnonymously(auth); } catch (e) { console.error("Auth failed", e); }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  useEffect(() => {
    if (!gameId || !user) return;
    const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    const unsubscribe = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setGame(data);
        const msgs = data.chat || [];
        if (isChatOpen) {
          lastReadCountRef.current = msgs.length;
          setUnreadCount(0);
        } else {
          setUnreadCount(msgs.length - lastReadCountRef.current);
        }
      } else {
        setError("Game not found.");
      }
    }, (err) => {
        console.error("Snapshot Error:", err);
        setError("Connection lost. Please reload.");
    });
    return () => unsubscribe();
  }, [gameId, user, isChatOpen]);

  useEffect(() => {
    if (!game || game.winner) return;
    const actualWinner = checkWinner(game.flags);
    if (actualWinner && !game.winner) {
      const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
      updateDoc(gameRef, { winner: actualWinner }).catch(err => console.error("Auto-fix failed:", err));
    }
  }, [game]);

  useEffect(() => {
    if (isChatOpen && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [game?.chat, isChatOpen]);

  // --- Actions ---

  const createGame = async () => {
    if (!user) return;
    setLoading(true);
    const newDeck = createDeck();
    const tacticsDeck = createTacticsDeck();
    const hostHand = newDeck.splice(0, HAND_SIZE);
    const guestHand = newDeck.splice(0, HAND_SIZE);
    const initialFlags = Array(FLAGS_COUNT).fill(null).map(() => ({
      hostCards: [], guestCards: [], owner: null, completedAt: null, proofClaim: null, environment: null 
    }));
    const newGameId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const gameData = {
      id: newGameId,
      host: user.uid,
      guest: null,
      turn: 'host',
      hasPlayedCard: false,
      winner: null,
      deck: newDeck,
      tacticsDeck: tacticsDeck,
      hostHand,
      guestHand,
      hostGuile: [],
      guestGuile: [],
      flags: initialFlags,
      chat: [], 
      lastPlacedCard: null, // Init lastPlacedCard
      createdAt: serverTimestamp(),
      lastMove: serverTimestamp()
    };
    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', newGameId), gameData);
      setGameId(newGameId);
    } catch (e) {
      setError("Could not create game.");
    }
    setLoading(false);
  };

  const joinGame = async (inputCode) => {
    if (!user || !inputCode) return;
    setLoading(true);
    const code = inputCode.trim().toUpperCase();
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', code);
    try {
      const gameSnap = await getDoc(gameRef);
      if (!gameSnap.exists()) { setError("ゲームが見つかりません。"); setLoading(false); return; }
      const gameData = gameSnap.data();
      if (!gameData.guest) await updateDoc(gameRef, { guest: user.uid });
      setGameId(code);
    } catch (e) {
        setError("参加エラー。コードを確認してください。");
    }
    setLoading(false);
  };

  const playCard = async (flagIndex) => {
    if (!game || !user || selectedCardIdx === null) return;
    const isHost = user.uid === game.host;
    if (user.uid !== game.host && user.uid !== game.guest) return;
    if (game.turn !== (isHost ? 'host' : 'guest')) return;
    if (game.hasPlayedCard) return; 

    const newFlags = [...game.flags];
    const flag = { ...newFlags[flagIndex] };
    const myHandKey = isHost ? 'hostHand' : 'guestHand';
    const myCardsKey = isHost ? 'hostCards' : 'guestCards';
    const myGuileKey = isHost ? 'hostGuile' : 'guestGuile';
    
    const hand = [...game[myHandKey]];
    const cardToPlay = hand[selectedCardIdx];
    
    // Tactics Play Limit Check
    if (cardToPlay.type === 'tactics') {
      const { hostCount, guestCount } = calculateTacticsCount(game);
      const myCount = isHost ? hostCount : guestCount;
      const oppCount = isHost ? guestCount : hostCount;
      if (myCount > oppCount) {
        setError("Cannot play Tactics (Limit exceeded!)");
        return;
      }
    }

    let updateData = {};

    const hasValidTarget = (targetIsMine) => {
       const targetKey = targetIsMine 
         ? (isHost ? 'hostCards' : 'guestCards')
         : (isHost ? 'guestCards' : 'hostCards');
       return game.flags.some(f => !f.owner && f[targetKey].length > 0);
    };

    if (cardToPlay.name === 'Scout') {
      const deckCount = (game.deck.length + (game.tacticsDeck ? game.tacticsDeck.length : 0));
      if (deckCount === 0) {
        setError("No cards in decks!");
        return;
      }
      hand.splice(selectedCardIdx, 1);
      updateData[myHandKey] = hand;
      updateData[myGuileKey] = arrayUnion(cardToPlay);
      updateData.hasPlayedCard = true;
      updateData.lastPlacedCard = null; // Scout hides
      const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
      await updateDoc(gameRef, updateData);
      setInteractionMode('scout_draw');
      setScoutDrawCount(0);
      setScoutReturnCount(0);
      setSelectedCardIdx(null);
      return;
    }
    
    if (cardToPlay.name === 'Deserter') {
      if (!hasValidTarget(false)) { setError("No valid target cards on board!"); return; }
      setInteractionMode('select_deserter_target');
      return; 
    }

    if (cardToPlay.name === 'Redeploy') {
      if (!hasValidTarget(true)) { setError("No valid cards to move!"); return; }
      setInteractionMode('select_redeploy_source');
      return;
    }

    if (cardToPlay.name === 'Traitor') {
      if (!hasValidTarget(false)) { setError("No valid target cards on board!"); return; }
      setInteractionMode('select_traitor_source');
      return;
    }

    if (cardToPlay.type === 'tactics' && cardToPlay.subType === 'environment') {
       if (flag.environment) return;
       flag.environment = { ...cardToPlay, playedBy: isHost ? 'host' : 'guest' };
       hand.splice(selectedCardIdx, 1);
       newFlags[flagIndex] = flag;
       updateData.flags = newFlags;
       updateData[myHandKey] = hand;
       updateData.lastPlacedCard = { flagIndex, type: 'environment' }; // Env Highlighting
    }
    else if (cardToPlay.type === 'tactics' && cardToPlay.subType === 'guile') {
       hand.splice(selectedCardIdx, 1);
       updateData[myHandKey] = hand;
       updateData[myGuileKey] = arrayUnion(cardToPlay);
       updateData.lastPlacedCard = null;
    }
    else {
       const isMud = flag.environment?.name === 'Mud';
       const maxSlots = isMud ? 4 : 3;
       if (cardToPlay.name === 'Alexander' || cardToPlay.name === 'Darius') {
         const alreadyUsedLeader = game.flags.some(f => f[myCardsKey].some(c => c.name === 'Alexander' || c.name === 'Darius'));
         if (alreadyUsedLeader) return; 
       }
       if (flag.owner || flag[myCardsKey].length >= maxSlots) return;
       hand.splice(selectedCardIdx, 1);
       flag[myCardsKey] = [...flag[myCardsKey], cardToPlay];
       if (flag.hostCards.length === maxSlots && flag.guestCards.length === maxSlots) {
         const hostScore = evaluateFormation(flag.hostCards, flag.environment);
         const guestScore = evaluateFormation(flag.guestCards, flag.environment);
         let winner = null;
         if (hostScore.tier > guestScore.tier) winner = 'host';
         else if (guestScore.tier > hostScore.tier) winner = 'guest';
         else {
           if (hostScore.sum > guestScore.sum) winner = 'host';
           else if (guestScore.sum > hostScore.sum) winner = 'guest';
           else winner = isHost ? 'guest' : 'host';
         }
         flag.owner = winner;
         flag.proofClaim = null;
       }
       newFlags[flagIndex] = flag;
       updateData.flags = newFlags;
       updateData[myHandKey] = hand;
       // Set Last Placed Card
       updateData.lastPlacedCard = {
         flagIndex: flagIndex,
         side: isHost ? 'host' : 'guest',
         cardIndex: flag[myCardsKey].length - 1,
         type: 'troop'
       };
    }

    updateData.hasPlayedCard = true;
    updateData.winner = checkWinner(newFlags) || null;

    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    try { await updateDoc(gameRef, updateData); } catch (e) { setError("通信エラーが発生しました。"); }
    setSelectedCardIdx(null);
  };

  const handleSortHand = async () => {
    if (!game || !user) return;
    const isHost = user.uid === game.host;
    const myHandKey = isHost ? 'hostHand' : 'guestHand';
    const hand = [...game[myHandKey]];
    
    const nextSortState = (sortState + 1) % 2;

    hand.sort((a, b) => {
      // Tactics last
      if (a.type === 'tactics' && b.type !== 'tactics') return 1;
      if (a.type !== 'tactics' && b.type === 'tactics') return -1;
      if (a.type === 'tactics' && b.type === 'tactics') return a.name.localeCompare(b.name);

      if (nextSortState === 0) { // Value -> Color
        if (a.value !== b.value) return a.value - b.value;
        return COLORS.indexOf(a.color) - COLORS.indexOf(b.color);
      } else { // Color -> Value
        if (a.color !== b.color) return COLORS.indexOf(a.color) - COLORS.indexOf(b.color);
        return a.value - b.value;
      }
    });

    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, { [myHandKey]: hand });
    setSortState(nextSortState);
  };

  const handleScoutDraw = async (deckType) => {
    if (interactionMode !== 'scout_draw' || scoutDrawCount >= 3) return;
    let newDeck = deckType === 'normal' ? [...game.deck] : [...game.tacticsDeck];
    if (newDeck.length === 0) return;
    const drawn = newDeck.shift();
    const isHost = user.uid === game.host;
    const myHandKey = isHost ? 'hostHand' : 'guestHand';
    const hand = [...game[myHandKey]];
    hand.push(drawn);
    const updateData = { [myHandKey]: hand };
    if (deckType === 'normal') updateData.deck = newDeck;
    else updateData.tacticsDeck = newDeck;
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, updateData);
    setScoutDrawCount(prev => {
      const next = prev + 1;
      if (next >= 3) setInteractionMode('scout_return');
      return next;
    });
  };

  const handleScoutReturn = async (cardIndex) => {
    if (interactionMode !== 'scout_return' || scoutReturnCount >= 2) return;
    const isHost = user.uid === game.host;
    const myHandKey = isHost ? 'hostHand' : 'guestHand';
    const hand = [...game[myHandKey]];
    const card = hand[cardIndex];
    const isTactic = card.type === 'tactics';
    const targetDeckKey = isTactic ? 'tacticsDeck' : 'deck';
    const targetDeck = isTactic ? [...game.tacticsDeck] : [...game.deck];
    targetDeck.unshift(card);
    hand.splice(cardIndex, 1);
    const updateData = { [myHandKey]: hand, [targetDeckKey]: targetDeck };
    const nextCount = scoutReturnCount + 1;
    if (nextCount >= 2) {
      updateData.turn = isHost ? 'guest' : 'host';
      updateData.hasPlayedCard = false;
      updateData.winner = checkWinner(game.flags) || null;
      updateData.lastMove = serverTimestamp();
      setInteractionMode(null);
    }
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, updateData);
    setScoutReturnCount(nextCount);
  };

  const handleBoardCardClick = async (flagIndex, cardIndex, side) => {
    const isHost = user.uid === game.host;
    const myHandKey = isHost ? 'hostHand' : 'guestHand';
    const myGuileKey = isHost ? 'hostGuile' : 'guestGuile';
    
    if (interactionMode === 'select_deserter_target') {
      const targetIsGuest = side === 'guest';
      if (isHost === !targetIsGuest) return; 
      const hand = [...game[myHandKey]];
      const playedCard = hand[selectedCardIdx]; 
      hand.splice(selectedCardIdx, 1);
      const newFlags = [...game.flags];
      const targetFlag = { ...newFlags[flagIndex] };
      const targetCardsKey = side === 'host' ? 'hostCards' : 'guestCards';
      const targetCards = [...targetFlag[targetCardsKey]];
      const removedCard = targetCards.splice(cardIndex, 1)[0];
      targetFlag[targetCardsKey] = targetCards;
      newFlags[flagIndex] = targetFlag;
      const logMsg = { sender: 'system', text: `Deserter removed ${removedCard.name || removedCard.color + ' ' + removedCard.value}.`, timestamp: Date.now() };
      const updateData = { 
        flags: newFlags, 
        [myHandKey]: hand, 
        [myGuileKey]: arrayUnion(playedCard), 
        chat: arrayUnion(logMsg), 
        hasPlayedCard: true, 
        winner: checkWinner(newFlags) || null,
        lastPlacedCard: null 
      };
      const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
      await updateDoc(gameRef, updateData);
      setInteractionMode(null);
      setSelectedCardIdx(null);
    }
    else if (interactionMode === 'select_redeploy_source') {
      const targetIsHost = side === 'host';
      if (isHost !== targetIsHost) return;
      setSelectedBoardCard({ flagIndex, cardIndex, side });
      setInteractionMode('redeploy_action');
    }
    else if (interactionMode === 'select_traitor_source') {
      const targetIsGuest = side === 'guest';
      if (isHost === !targetIsGuest) return;
      setSelectedBoardCard({ flagIndex, cardIndex, side });
      setInteractionMode('select_traitor_target');
    }
  };

  const handleFlagInteractionClick = async (flagIndex) => {
    const isHost = user.uid === game.host;
    const myHandKey = isHost ? 'hostHand' : 'guestHand';
    const myGuileKey = isHost ? 'hostGuile' : 'guestGuile';
    const myCardsKey = isHost ? 'hostCards' : 'guestCards';
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);

    if (interactionMode === 'redeploy_action' && selectedBoardCard) {
      if (flagIndex === selectedBoardCard.flagIndex) return; 
      const newFlags = [...game.flags];
      const sourceFlag = { ...newFlags[selectedBoardCard.flagIndex] };
      const targetFlag = { ...newFlags[flagIndex] };
      
      const isMud = targetFlag.environment?.name === 'Mud';
      const maxSlots = isMud ? 4 : 3;
      if (targetFlag[myCardsKey].length >= maxSlots) return;

      const sourceCards = [...sourceFlag[myCardsKey]];
      const cardToMove = sourceCards.splice(selectedBoardCard.cardIndex, 1)[0];
      sourceFlag[myCardsKey] = sourceCards;
      
      const targetCards = [...targetFlag[myCardsKey]];
      targetCards.push(cardToMove);
      targetFlag[myCardsKey] = targetCards;

      newFlags[selectedBoardCard.flagIndex] = sourceFlag;
      newFlags[flagIndex] = targetFlag;

      const hand = [...game[myHandKey]];
      const playedCard = hand[selectedCardIdx];
      hand.splice(selectedCardIdx, 1);

      await updateDoc(gameRef, {
        flags: newFlags,
        [myHandKey]: hand,
        [myGuileKey]: arrayUnion(playedCard),
        hasPlayedCard: true,
        winner: checkWinner(newFlags) || null,
        chat: arrayUnion({ sender: 'system', text: `Redeployed ${cardToMove.name || cardToMove.color} to Flag ${flagIndex + 1}`, timestamp: Date.now() }),
        lastPlacedCard: {
          flagIndex: flagIndex,
          side: isHost ? 'host' : 'guest',
          cardIndex: targetCards.length - 1,
          type: 'troop'
        }
      });
      setInteractionMode(null);
      setSelectedBoardCard(null);
      setSelectedCardIdx(null);
    }
    else if (interactionMode === 'select_traitor_target' && selectedBoardCard) {
      const newFlags = [...game.flags];
      const isSameFlag = selectedBoardCard.flagIndex === flagIndex;
      const sourceFlag = { ...newFlags[selectedBoardCard.flagIndex] };
      const targetFlag = isSameFlag ? sourceFlag : { ...newFlags[flagIndex] };
      
      const isMud = targetFlag.environment?.name === 'Mud';
      const maxSlots = isMud ? 4 : 3;
      if (targetFlag[myCardsKey].length >= maxSlots) return;

      const oppCardsKey = selectedBoardCard.side === 'host' ? 'hostCards' : 'guestCards';
      const sourceCards = [...sourceFlag[oppCardsKey]];
      const cardToMove = sourceCards[selectedBoardCard.cardIndex];

      if (cardToMove.name === 'Alexander' || cardToMove.name === 'Darius') {
         const alreadyUsedLeader = game.flags.some(f => 
           f[myCardsKey].some(c => c.name === 'Alexander' || c.name === 'Darius')
         );
         if (alreadyUsedLeader) {
           return; 
         }
      }

      sourceCards.splice(selectedBoardCard.cardIndex, 1);
      sourceFlag[oppCardsKey] = sourceCards;

      const targetCards = [...targetFlag[myCardsKey]];
      targetCards.push(cardToMove);
      targetFlag[myCardsKey] = targetCards;

      newFlags[selectedBoardCard.flagIndex] = sourceFlag;
      if (!isSameFlag) newFlags[flagIndex] = targetFlag;

      const hand = [...game[myHandKey]];
      const playedCard = hand[selectedCardIdx];
      hand.splice(selectedCardIdx, 1);

      await updateDoc(gameRef, {
        flags: newFlags,
        [myHandKey]: hand,
        [myGuileKey]: arrayUnion(playedCard),
        hasPlayedCard: true,
        winner: checkWinner(newFlags) || null,
        chat: arrayUnion({ sender: 'system', text: `Traitor stole ${cardToMove.name || cardToMove.color} to Flag ${flagIndex + 1}`, timestamp: Date.now() }),
        lastPlacedCard: {
          flagIndex: flagIndex,
          side: isHost ? 'host' : 'guest',
          cardIndex: targetCards.length - 1,
          type: 'troop'
        }
      });
      setInteractionMode(null);
      setSelectedBoardCard(null);
      setSelectedCardIdx(null);
    }
  };

  const handleRedeployDiscard = async () => {
    if (interactionMode !== 'redeploy_action' || !selectedBoardCard) return;
    const isHost = user.uid === game.host;
    const myHandKey = isHost ? 'hostHand' : 'guestHand';
    const myGuileKey = isHost ? 'hostGuile' : 'guestGuile';
    const myCardsKey = isHost ? 'hostCards' : 'guestCards';
    
    const newFlags = [...game.flags];
    const sourceFlag = { ...newFlags[selectedBoardCard.flagIndex] };
    const sourceCards = [...sourceFlag[myCardsKey]];
    const removedCard = sourceCards.splice(selectedBoardCard.cardIndex, 1)[0];
    sourceFlag[myCardsKey] = sourceCards;
    newFlags[selectedBoardCard.flagIndex] = sourceFlag;

    const hand = [...game[myHandKey]];
    const playedCard = hand[selectedCardIdx];
    hand.splice(selectedCardIdx, 1);

    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, {
      flags: newFlags,
      [myHandKey]: hand,
      [myGuileKey]: arrayUnion(playedCard),
      hasPlayedCard: true,
      winner: checkWinner(newFlags) || null,
      chat: arrayUnion({ sender: 'system', text: `Redeployed (Discarded) ${removedCard.name || removedCard.color}`, timestamp: Date.now() }),
      lastPlacedCard: null
    });
    setInteractionMode(null);
    setSelectedBoardCard(null);
    setSelectedCardIdx(null);
  };

  const drawAndEndTurn = async (deckType) => {
    if (!game || !user) return;
    const isHost = user.uid === game.host;
    const myHandKey = isHost ? 'hostHand' : 'guestHand';
    const myRole = isHost ? 'host' : 'guest';
    let newDeck = [];
    let drawnCard = null;
    let updateData = {};
    if (deckType === 'normal') {
      newDeck = [...game.deck];
      if (newDeck.length > 0) {
        drawnCard = newDeck.shift();
        updateData.deck = newDeck;
      }
    } else if (deckType === 'tactics') {
      newDeck = [...game.tacticsDeck];
      if (newDeck.length > 0) {
        drawnCard = newDeck.shift();
        updateData.tacticsDeck = newDeck;
      }
    }
    const hand = [...game[myHandKey]];
    if (drawnCard) {
      hand.push(drawnCard);
    }
    updateData[myHandKey] = hand;
    const newFlags = game.flags.map(flag => {
      if (flag.proofClaim && flag.proofClaim.claimant === myRole) {
        return { ...flag, proofClaim: null };
      }
      return flag;
    });
    updateData.flags = newFlags;
    updateData.turn = isHost ? 'guest' : 'host';
    updateData.hasPlayedCard = false;
    updateData.winner = checkWinner(newFlags) || null; 
    updateData.lastMove = serverTimestamp();
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    try {
      await updateDoc(gameRef, updateData);
    } catch (e) {
      setError("通信エラーが発生しました。");
    }
  };

  const claimFlag = async (flagIndex) => {
    if (!game || !user) return;
    const isHost = user.uid === game.host;
    const myRole = isHost ? 'host' : 'guest';
    if (game.turn !== myRole) return;
    const newFlags = [...game.flags];
    newFlags[flagIndex] = {
      ...newFlags[flagIndex],
      proofClaim: { claimant: myRole, timestamp: Date.now() }
    };
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, { flags: newFlags });
  };

  const cancelClaim = async (flagIndex) => {
    if (!game || !user) return;
    const newFlags = [...game.flags];
    newFlags[flagIndex] = { ...newFlags[flagIndex], proofClaim: null };
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, { flags: newFlags });
  };

  const denyFlag = async (flagIndex) => {
    if (!game || !user) return;
    const newFlags = [...game.flags];
    newFlags[flagIndex] = { ...newFlags[flagIndex], proofClaim: null };
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, { flags: newFlags });
  };

  const concedeFlag = async (flagIndex) => {
    if (!game || !user) return;
    const flag = game.flags[flagIndex];
    if (!flag.proofClaim) return;
    const winnerRole = flag.proofClaim.claimant;
    const newFlags = [...game.flags];
    newFlags[flagIndex] = { ...newFlags[flagIndex], owner: winnerRole, proofClaim: null };
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, { flags: newFlags, winner: checkWinner(newFlags) || null });
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!chatMessage.trim() || !user || !game) return;
    const isHost = user.uid === game.host;
    const isGuest = user.uid === game.guest;
    if (!isHost && !isGuest) return; 
    const role = isHost ? 'host' : 'guest';
    const msg = { sender: role, text: chatMessage.trim(), timestamp: Date.now() };
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, { chat: arrayUnion(msg) });
    setChatMessage("");
  };

  if (!user) return <div className="h-[100dvh] flex items-center justify-center bg-slate-50">Loading...</div>;

  if (!game) {
    return (
      <div className="min-h-[100dvh] bg-slate-100 flex flex-col items-center justify-center p-4 overscroll-none select-none">
        <div className="max-w-md w-full bg-white shadow-xl rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="text-center">
            <Swords className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-blue-600 mb-4" />
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-800">Battle Line</h1>
            <p className="text-slate-500 mt-2 text-sm sm:text-base">Strategic Formation Card Game</p>
          </div>
          <div className="space-y-4">
            <button onClick={createGame} disabled={loading} className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow transition-all flex items-center justify-center gap-2 active:scale-95 touch-manipulation">{loading ? 'Creating...' : <><Play size={20} /> New Game</>}</button>
            <form onSubmit={(e) => { e.preventDefault(); joinGame(e.target.code.value); }} className="flex gap-2">
              <input name="code" placeholder="Game Code" className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase text-sm sm:text-base touch-manipulation"/>
              <button type="submit" disabled={loading} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg transition-colors text-sm sm:text-base active:scale-95 touch-manipulation">Join</button>
            </form>
            {installPrompt && <button onClick={triggerInstall} className="w-full py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow flex items-center justify-center gap-2 active:scale-95 touch-manipulation"><Download size={18} /> Install App</button>}
            {error && <p className="text-red-500 text-sm text-center">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  const isHost = user.uid === game.host;
  const isGuest = user.uid === game.guest;
  const isSpectator = !isHost && !isGuest;
  const viewAsHost = isHost || isSpectator;
  
  const myHand = viewAsHost ? game.hostHand : game.guestHand;
  const opponentHand = viewAsHost ? game.guestHand : game.hostHand;
  const opponentGuile = viewAsHost ? (game.guestGuile || []) : (game.hostGuile || []);
  const myGuile = viewAsHost ? (game.hostGuile || []) : (game.guestGuile || []);
  const isMyTurn = !isSpectator && (game.turn === (isHost ? 'host' : 'guest'));
  const selectedDetails = selectedCardIdx !== null && myHand[selectedCardIdx] && myHand[selectedCardIdx].type === 'tactics' ? myHand[selectedCardIdx] : null;
  const lastPlacedCard = game.lastPlacedCard;

  let interactionMsg = null;
  if (interactionMode === 'scout_draw') interactionMsg = `Draw ${3 - scoutDrawCount} more cards`;
  else if (interactionMode === 'scout_return') interactionMsg = `Return ${2 - scoutReturnCount} cards to deck`;
  else if (interactionMode === 'select_deserter_target') interactionMsg = "Select an OPPONENT card to destroy";
  else if (interactionMode === 'select_redeploy_source') interactionMsg = "Select YOUR card to move";
  else if (interactionMode === 'redeploy_action') interactionMsg = "Tap a flag to move, or Discard";
  else if (interactionMode === 'select_traitor_source') interactionMsg = "Select an OPPONENT card to steal";
  else if (interactionMode === 'select_traitor_target') interactionMsg = "Select YOUR flag to place it";

  return (
    <div className="h-[100dvh] w-full bg-slate-100 flex flex-col overflow-hidden overscroll-y-none select-none touch-manipulation">
      {interactionMsg && (
        <div className="bg-purple-600 text-white p-2 text-center font-bold text-sm z-30 animate-pulse flex justify-between items-center px-4">
          <span>{interactionMsg}</span>
          {(interactionMode === 'select_deserter_target' || interactionMode === 'select_redeploy_source' || interactionMode === 'select_traitor_source') && (
            <button 
              onClick={() => { setInteractionMode(null); setSelectedCardIdx(null); setSelectedBoardCard(null); }}
              className="bg-white/20 px-3 py-1 rounded text-xs hover:bg-white/30"
            >
              Cancel
            </button>
          )}
        </div>
      )}

      <header className="bg-white shadow-sm px-3 py-2 flex justify-between items-center z-20 flex-shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2">
          <Shield className="text-blue-600 w-6 h-6" />
          <span className="font-bold text-slate-800 text-lg hidden sm:inline">Battle Line</span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Help Button */}
          <button onClick={() => setIsHelpOpen(true)} className="p-2 rounded-full hover:bg-slate-100 text-slate-600">
            <HelpCircle size={20} />
          </button>

          {isSpectator ? (
             <div className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-xs sm:text-sm font-bold flex items-center gap-1"><Eye size={16} /> 観戦中</div>
          ) : (
            <div className="flex items-center gap-2">
               <button onClick={() => setIsChatOpen(!isChatOpen)} className="relative p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 mr-2">
                  <MessageCircle size={20} />
                  {unreadCount > 0 && <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border border-white"></span>}
               </button>
               <div className="flex items-center gap-2 sm:gap-4 bg-slate-100 px-3 py-1 rounded-full text-xs sm:text-sm">
                 <div className={`flex items-center gap-1 ${game.turn === 'host' ? 'text-blue-600 font-bold' : 'text-slate-400'}`}><Users size={14} /> <span className="hidden xs:inline">Host</span></div>
                 <div className="text-slate-300">|</div>
                 <div className={`flex items-center gap-1 ${game.turn === 'guest' ? 'text-red-600 font-bold' : 'text-slate-400'}`}><Users size={14} /> <span className="hidden xs:inline">Guest</span></div>
               </div>
            </div>
          )}
          <div className="bg-slate-100 px-2 py-1 rounded text-xs sm:text-sm font-mono flex items-center gap-2">
            {gameId}
            <button onClick={() => { navigator.clipboard.writeText(gameId); }} className="active:text-blue-600"><Copy size={12} /></button>
          </div>
        </div>
      </header>

      {/* Help Modal */}
      {isHelpOpen && <HelpModal onClose={() => setIsHelpOpen(false)} />}

      {/* Chat Overlay */}
      {isChatOpen && (
        <div className="absolute inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/20" onClick={() => setIsChatOpen(false)}>
          <div className="w-full sm:w-96 h-[60vh] sm:h-[500px] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom" onClick={(e) => e.stopPropagation()}>
            <div className="p-3 bg-slate-800 text-white flex justify-between items-center shrink-0">
               <span className="font-bold flex items-center gap-2"><MessageCircle size={16}/> Game Chat</span>
               <button onClick={() => setIsChatOpen(false)}><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
               {game.chat && game.chat.length > 0 ? (
                 game.chat.map((msg, i) => (
                   <div key={i} className={`flex flex-col ${(isHost && msg.sender === 'host') || (isGuest && msg.sender === 'guest') ? 'items-end' : 'items-start'}`}>
                       <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${(isHost && msg.sender === 'host') || (isGuest && msg.sender === 'guest') ? 'bg-blue-600 text-white rounded-br-none' : msg.sender === 'host' ? 'bg-blue-100 text-blue-900 rounded-bl-none' : 'bg-red-100 text-red-900 rounded-bl-none'}`}>{msg.text}</div>
                   </div>
                 ))
               ) : <div className="text-center text-slate-400 text-sm mt-10">No messages yet.</div>}
               <div ref={chatEndRef}></div>
            </div>
            {!isSpectator && (
              <form onSubmit={sendMessage} className="p-3 border-t bg-white flex gap-2 shrink-0">
                <input className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" value={chatMessage} onChange={(e) => setChatMessage(e.target.value)}/>
                <button type="submit" className="bg-slate-800 text-white p-2 rounded-lg hover:bg-slate-900"><Send size={18} /></button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Card Detail / Zoom Overlay */}
      {viewingCard && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in" onClick={() => setViewingCard(null)}>
           <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-xs w-full text-center transform scale-110" onClick={(e) => e.stopPropagation()}>
              {viewingCard.type === 'tactics' ? (
                <>
                  <div className="flex justify-center mb-4 text-slate-700">
                    {viewingCard.subType === 'environment' ? <Cloud size={64} className="text-emerald-500"/> : viewingCard.subType === 'guile' ? <Scroll size={64} className="text-purple-500"/> : <Zap size={64} className="text-orange-500"/>}
                  </div>
                  <h3 className="text-2xl font-bold text-slate-800 mb-2">{viewingCard.name}</h3>
                  <div className="inline-block bg-slate-100 text-slate-500 text-xs px-2 py-1 rounded mb-4 capitalize">{viewingCard.subType} Tactic</div>
                  <p className="text-slate-600 mb-6 text-sm leading-relaxed">{viewingCard.description}</p>
                </>
              ) : (
                <>
                  <div className={`w-32 h-48 mx-auto rounded-xl border-4 shadow-md flex flex-col items-center justify-between p-2 mb-4 bg-${viewingCard.color}-100 text-${viewingCard.color}-600 border-${viewingCard.color}-300`}>
                    <span className="text-4xl font-bold self-start">{viewingCard.value}</span>
                    <div className="w-12 h-12 rounded-full opacity-50 bg-current"></div>
                    <span className="text-4xl font-bold self-end rotate-180">{viewingCard.value}</span>
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mb-6 capitalize">{viewingCard.color} Troop</h3>
                </>
              )}
              <button onClick={() => setViewingCard(null)} className="bg-slate-800 text-white px-6 py-3 rounded-xl hover:bg-slate-900 w-full font-bold">Close</button>
           </div>
        </div>
      )}

      <main className="flex-1 relative flex flex-col items-center justify-between overflow-hidden pb-[env(safe-area-inset-bottom)]">
        {game.winner && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl text-center w-full max-w-sm">
              <Crown className="w-16 h-16 sm:w-20 sm:h-20 mx-auto text-yellow-500 mb-4 animate-bounce" />
              <h2 className="text-3xl font-black text-slate-800 mb-2">{game.winner === (isHost ? 'host' : 'guest') ? "VICTORY!" : "DEFEAT"}</h2>
              {isSpectator && <p className="text-slate-500 mb-4">{game.winner.toUpperCase()} WON!</p>}
              <button onClick={() => { setGameId(""); setGame(null); }} className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 flex items-center justify-center gap-2 mt-6 active:scale-95"><RotateCcw size={18} /> Return to Lobby</button>
            </div>
          </div>
        )}

        <div className="w-full flex justify-between items-end py-2 bg-slate-100/50 flex-shrink-0 min-h-[60px] sm:min-h-[80px] px-2">
           <div className="flex gap-1 overflow-x-auto px-4 no-scrollbar items-end h-full flex-1 justify-center">
             {opponentHand && opponentHand.map((c, i) => (<Card key={`enemy-${i}`} card={c} hidden className="scale-75 origin-bottom" />))}
           </div>
           <div className="w-24 h-full border-l border-slate-300 pl-2 flex flex-col justify-end items-center opacity-70">
              <span className="text-[10px] text-slate-500 font-bold mb-1">Played Guile</span>
              <div className="flex flex-wrap gap-1 justify-center max-h-20 overflow-y-auto">
                {opponentGuile.length > 0 ? opponentGuile.map((c, i) => (<div key={i} onClick={() => setViewingCard(c)} className="w-5 h-7 bg-purple-100 border border-purple-400 rounded flex items-center justify-center shadow-sm cursor-pointer hover:scale-110 transition-transform flex-shrink-0"><Scroll size={10} className="text-purple-700" /></div>)) : <div className="text-[10px] text-slate-400">-</div>}
              </div>
           </div>
        </div>

        <div ref={flagsContainerRef} className="w-full flex-1 overflow-x-auto overflow-y-hidden snap-x snap-mandatory flex items-center py-2 sm:py-4 px-4 sm:px-0 no-scrollbar touch-pan-x">
          <div className="flex gap-2 sm:gap-4 justify-start sm:justify-center min-w-[max-content] mx-auto">
            {game.flags.map((flag, idx) => (
              <FlagSpot 
                key={idx} index={idx} data={flag} isHost={viewAsHost} 
                onPlayToFlag={playCard} onClaim={claimFlag} onConcede={concedeFlag} onDeny={denyFlag} onCancelClaim={cancelClaim} 
                onEnvironmentClick={setViewingCard}
                onCardClick={handleBoardCardClick} onFlagClick={handleFlagInteractionClick}
                onZoom={setViewingCard}
                canPlay={isMyTurn && selectedCardIdx !== null && !interactionMode}
                isSpectator={isSpectator} isMyTurn={isMyTurn} interactionMode={interactionMode}
                lastPlacedCard={lastPlacedCard}
              />
            ))}
          </div>
        </div>

        <div className="w-full bg-white border-t border-slate-200 p-2 pb-2 sm:p-4 z-10 flex-shrink-0">
          <div className="relative w-full max-w-4xl mx-auto">
             {/* My Guile Zone */}
             <div className="absolute -top-24 right-2 w-24 flex flex-col items-end opacity-90 z-10 pointer-events-none">
                <span className="text-[10px] text-slate-500 font-bold mb-1 bg-white/80 px-1 rounded shadow-sm">My Guile</span>
                <div className="flex flex-wrap gap-1 justify-end content-start pointer-events-auto max-h-24 overflow-y-auto">
                  {myGuile.length > 0 ? myGuile.map((c, i) => (<div key={i} onClick={() => setViewingCard(c)} className="w-6 h-9 bg-purple-100 border border-purple-400 rounded flex items-center justify-center shadow-sm cursor-pointer hover:scale-110 transition-transform flex-shrink-0"><Scroll size={12} className="text-purple-700" /></div>)) : <div className="text-[10px] text-slate-400 bg-white/50 px-1 rounded">-</div>}
                </div>
             </div>

             {/* Redeploy Discard Button */}
             {interactionMode === 'redeploy_action' && (
                <div className="absolute -top-24 inset-x-0 flex justify-center z-30 pointer-events-auto">
                   <button 
                     onClick={handleRedeployDiscard}
                     className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-6 rounded-full shadow-xl flex items-center gap-2 animate-bounce"
                   >
                     <Trash2 size={18} /> 破棄して終了
                   </button>
                </div>
             )}

             {isMyTurn && !interactionMode && <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold bg-blue-100 text-blue-700 px-3 py-1 rounded-full shadow-sm animate-bounce z-20 whitespace-nowrap pointer-events-none">YOUR TURN</div>}

             {/* Sort Button (Left Side) */}
             <div className="absolute -top-10 left-2 z-20 pointer-events-auto">
               <button 
                 onClick={handleSortHand}
                 className="bg-white border border-slate-300 text-slate-600 p-2 rounded-full shadow-lg hover:bg-slate-50 active:scale-95 transition-all"
                 title="Sort Hand"
               >
                 <ArrowDownWideNarrow size={18} />
               </button>
             </div>

             {selectedDetails && !interactionMode && (
               <div className="absolute -top-24 left-1/2 -translate-x-1/2 bg-slate-800/90 text-white p-3 rounded-lg shadow-lg w-64 z-30 text-center backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 pointer-events-none">
                 <h4 className="font-bold text-yellow-400 flex items-center justify-center gap-2">{selectedDetails.name}</h4>
                 <p className="text-xs mt-1 leading-snug">{selectedDetails.description}</p>
               </div>
             )}
             
             {isMyTurn && game.hasPlayedCard && !interactionMode && (
               <div className="absolute -top-16 inset-x-0 flex justify-center gap-4 z-20 pointer-events-auto">
                 <button onClick={() => drawAndEndTurn('normal')} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl shadow-lg flex flex-col items-center gap-1 active:scale-95 transition-all"><span className="text-xs opacity-80">通常ドロー</span><span className="flex items-center gap-1"><Layers size={16}/> 終了</span></button>
                 <button onClick={() => drawAndEndTurn('tactics')} disabled={!game.tacticsDeck || game.tacticsDeck.length === 0} className="bg-orange-600 hover:bg-orange-700 disabled:bg-slate-400 text-white font-bold py-2 px-4 rounded-xl shadow-lg flex flex-col items-center gap-1 active:scale-95 transition-all"><span className="text-xs opacity-80">戦術ドロー</span><span className="flex items-center gap-1"><Zap size={16}/> 終了</span></button>
               </div>
             )}

             {interactionMode === 'scout_draw' && (
                <div className="absolute -top-24 inset-x-0 flex justify-center gap-4 z-30">
                   <div className="bg-purple-700 text-white p-4 rounded-xl shadow-xl flex flex-col items-center gap-2">
                      <span className="font-bold">Scout: Draw {3 - scoutDrawCount} Cards</span>
                      <div className="flex gap-2">
                        <button onClick={() => handleScoutDraw('normal')} className="bg-blue-500 hover:bg-blue-600 px-3 py-1 rounded text-xs flex gap-1 items-center"><Layers size={12}/> Normal</button>
                        <button onClick={() => handleScoutDraw('tactics')} className="bg-orange-500 hover:bg-orange-600 px-3 py-1 rounded text-xs flex gap-1 items-center"><Zap size={12}/> Tactics</button>
                      </div>
                   </div>
                </div>
             )}
             {interactionMode === 'scout_return' && <div className="absolute -top-16 inset-x-0 flex justify-center z-30"><div className="bg-purple-700 text-white px-4 py-2 rounded-full shadow-xl font-bold animate-pulse">Tap {2 - scoutReturnCount} cards to return to deck</div></div>}

             <div className="flex gap-2 sm:gap-3 overflow-x-auto px-2 py-2 sm:justify-center snap-x items-end min-h-[100px] sm:min-h-[120px] touch-pan-x">
               {myHand && myHand.map((card, i) => (
                 <div key={card.id} className="snap-center relative">
                    <Card 
                      card={card} 
                      onClick={() => {
                        if (interactionMode === 'scout_return') handleScoutReturn(i);
                        else if (!isSpectator && isMyTurn && !interactionMode && !game.hasPlayedCard) setSelectedCardIdx(selectedCardIdx === i ? null : i);
                        else if (!interactionMode) setViewingCard(card);
                      }}
                      selected={selectedCardIdx === i}
                      disabled={!isMyTurn && !interactionMode && !isSpectator}
                      className={`shadow-md bg-white ${isSpectator ? 'cursor-default' : 'cursor-pointer'} ${!isMyTurn || (game.hasPlayedCard && !interactionMode) ? 'opacity-50' : ''} ${interactionMode === 'scout_return' ? 'ring-2 ring-purple-500 animate-pulse' : ''}`}
                    />
                    {interactionMode === 'scout_return' && <div className="absolute -top-2 -right-2 bg-purple-600 text-white rounded-full p-1 shadow-sm z-20 pointer-events-none"><Reply size={12}/></div>}
                 </div>
               ))}
               <div className="w-2 flex-shrink-0 sm:hidden"></div>
             </div>
             
             <div className="flex justify-between text-[10px] sm:text-xs text-slate-400 mt-1 px-4">
                <span>Normal Deck: {game.deck.length}</span>
                <span>Tactics Deck: {game.tacticsDeck ? game.tacticsDeck.length : 0}</span>
             </div>
          </div>
        </div>
      </main>
    </div>
  );
}


