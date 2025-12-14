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
  initializeFirestore // 追加: 設定付き初期化のため
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
  Info
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

// 【修正箇所】Codespaces等での接続エラー（Load failed / transport errored）を回避するため、
// WebSocketではなくLong Pollingを強制的に使用する設定で初期化します。
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
    // 士気高揚 (Morale)
    { id: 't-leader-1', type: 'tactics', subType: 'morale', name: 'Alexander', description: '【リーダー】ワイルドカード（色・数を自由に指定）。1人1枚まで。' },
    { id: 't-leader-2', type: 'tactics', subType: 'morale', name: 'Darius', description: '【リーダー】ワイルドカード（色・数を自由に指定）。1人1枚まで。' },
    { id: 't-cavalry', type: 'tactics', subType: 'morale', name: 'Companion Cavalry', description: '【援軍騎兵】好きな色の「8」として使用。' },
    { id: 't-shield', type: 'tactics', subType: 'morale', name: 'Shield Bearers', description: '【盾】好きな色の「1, 2, 3」のいずれかとして使用。' },
    
    // 気象 (Environment)
    { id: 't-fog', type: 'tactics', subType: 'environment', name: 'Fog', description: '【霧】このフラッグは役が無効になり、合計値勝負になる。' },
    { id: 't-mud', type: 'tactics', subType: 'environment', name: 'Mud', description: '【泥濘】このフラッグは4枚のカードでフォーメーションを作る。' },
    
    // 謀略 (Guile)
    { id: 't-scout', type: 'tactics', subType: 'guile', name: 'Scout', description: '【偵察】山札から3枚引き、2枚を戻す。（未実装）' },
    { id: 't-redeploy', type: 'tactics', subType: 'guile', name: 'Redeploy', description: '【配置転換】自分のカードを移動または破棄。（未実装）' },
    { id: 't-deserter', type: 'tactics', subType: 'guile', name: 'Deserter', description: '【脱走】相手のカードを破棄。（未実装）' },
    { id: 't-traitor', type: 'tactics', subType: 'guile', name: 'Traitor', description: '【裏切り】相手のカードを奪う。（未実装）' },
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
    if (isFog) {
      return { tier: 0, sum: score.sum };
    }
    return score;
  }

  const card = currentCards[index];

  if (!card.type || card.type === 'number') {
    return resolveBestFormation(currentCards, index + 1, isFog);
  }

  let bestResult = { tier: -1, sum: -1 };
  let possibilities = [];

  if (card.name === 'Alexander' || card.name === 'Darius') {
    COLORS.forEach(c => {
      VALUES.forEach(v => possibilities.push({ color: c, value: v }));
    });
  }
  else if (card.name === 'Companion Cavalry') {
    COLORS.forEach(c => possibilities.push({ color: c, value: 8 }));
  }
  else if (card.name === 'Shield Bearers') {
    COLORS.forEach(c => {
      [1, 2, 3].forEach(v => possibilities.push({ color: c, value: v }));
    });
  } else {
    possibilities.push({ color: 'gray', value: 0 });
  }

  for (const p of possibilities) {
    const nextCards = [...currentCards];
    nextCards[index] = { ...card, ...p, isResolved: true };
    
    const res = resolveBestFormation(nextCards, index + 1, isFog);
    
    if (res.tier > bestResult.tier) {
      bestResult = res;
    } else if (res.tier === bestResult.tier) {
      if (res.sum > bestResult.sum) {
        bestResult = res;
      }
    }
  }
  
  return bestResult;
};

const evaluateFormation = (cards, environment) => {
  const isMud = environment?.name === 'Mud';
  const isFog = environment?.name === 'Fog';
  const requiredCount = isMud ? 4 : 3;

  if (cards.length !== requiredCount) return { tier: 0, sum: 0 };

  return resolveBestFormation(cards, 0, isFog);
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

// --- Components ---

const Card = ({ card, hidden, onClick, selected, className = "" }) => {
  if (!card) return <div className={`w-12 h-16 sm:w-16 sm:h-24 border-2 border-dashed border-gray-300 rounded-lg flex-shrink-0 ${className}`}></div>;
  
  if (hidden) {
    return (
      <div className={`w-12 h-16 sm:w-16 sm:h-24 bg-slate-700 rounded-lg border-2 border-slate-600 shadow-sm flex items-center justify-center flex-shrink-0 ${className}`}>
        <div className="w-8 h-12 bg-slate-600 rounded-sm opacity-50"></div>
      </div>
    );
  }

  if (card.type === 'tactics') {
    let typeColor = "bg-slate-200 border-slate-400 text-slate-700";
    let TypeIcon = Zap;
    if (card.subType === 'environment') { typeColor = "bg-emerald-100 border-emerald-400 text-emerald-700"; TypeIcon = Cloud; }
    if (card.subType === 'guile') { typeColor = "bg-purple-100 border-purple-400 text-purple-700"; TypeIcon = Scroll; }
    if (card.subType === 'morale') { typeColor = "bg-orange-100 border-orange-400 text-orange-700"; TypeIcon = Zap; }

    return (
      <div 
        onClick={onClick}
        className={`
          relative w-12 h-16 sm:w-16 sm:h-24 rounded-lg border-2 shadow-sm flex flex-col items-center justify-center p-1 cursor-pointer transition-all duration-200 flex-shrink-0 select-none
          ${typeColor}
          ${selected ? 'ring-4 ring-slate-800 -translate-y-4 z-10' : 'active:scale-95'}
          ${className}
        `}
      >
        <TypeIcon size={20} />
        <span className="text-[10px] sm:text-xs font-bold text-center leading-tight mt-1 line-clamp-2">{card.name}</span>
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
    <div 
      onClick={onClick}
      className={`
        relative w-12 h-16 sm:w-16 sm:h-24 rounded-lg border-2 shadow-sm flex flex-col items-center justify-between p-1 cursor-pointer transition-all duration-200 flex-shrink-0 select-none
        ${colorMap[card.color]}
        ${selected ? 'ring-4 ring-slate-800 -translate-y-4 z-10' : 'active:scale-95'}
        ${className}
      `}
    >
      <span className="text-xs sm:text-sm font-bold self-start leading-none">{card.value}</span>
      <div className={`w-3 h-3 sm:w-4 sm:h-4 rounded-full opacity-50 bg-current`} />
      <span className="text-xs sm:text-sm font-bold self-end leading-none rotate-180">{card.value}</span>
    </div>
  );
};

const FlagSpot = ({ index, data, isHost, onPlayToFlag, onClaim, onConcede, onDeny, onCancelClaim, onEnvironmentClick, canPlay, isSpectator, isMyTurn }) => {
  const isOwner = data.owner === (isHost ? 'host' : 'guest');
  
  let statusColor = "bg-gray-200 border-gray-300";
  let Icon = Shield;
  
  if (data.owner === 'host') {
    statusColor = "bg-blue-100 border-blue-400";
    Icon = isHost ? Trophy : AlertCircle;
  } else if (data.owner === 'guest') {
    statusColor = "bg-red-100 border-red-400";
    Icon = !isHost ? Trophy : AlertCircle;
  }

  const myRole = isHost ? 'host' : 'guest';
  const hasClaim = data.proofClaim && data.proofClaim.claimant;
  const isMyClaim = hasClaim === myRole;
  
  const showActions = !isSpectator && !data.owner;
  
  const isMud = data.environment?.name === 'Mud';
  const maxSlots = isMud ? 4 : 3;
  const hostFull = data.hostCards.length >= maxSlots;
  const guestFull = data.guestCards.length >= maxSlots;

  return (
    <div className="flex flex-col items-center gap-1 sm:gap-2 snap-center flex-shrink-0 px-1 relative">
      
      {data.environment ? (
         <button 
           onClick={(e) => { e.stopPropagation(); onEnvironmentClick(data.environment); }}
           className="absolute -top-7 bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-1 rounded-full text-[10px] flex items-center gap-1 whitespace-nowrap shadow-sm z-10 hover:bg-emerald-200 active:scale-95"
         >
           <Cloud size={10} /> 
           <span className="max-w-[60px] truncate">{data.environment.name}</span>
           <Info size={10} className="opacity-50"/>
         </button>
      ) : null}

      <div className="flex flex-col gap-1">
        {Array.from({ length: maxSlots }).map((_, i) => (
          <div key={`opp-${i}`} className="w-12 h-8 sm:w-16 sm:h-12 flex justify-center">
             {isHost ? (
                data.guestCards[i] ? <Card card={data.guestCards[i]} /> : <div className="w-12 h-16 sm:w-16 sm:h-24 border border-dashed border-gray-300 rounded opacity-50 scale-75 origin-top" />
             ) : (
                data.hostCards[i] ? <Card card={data.hostCards[i]} /> : <div className="w-12 h-16 sm:w-16 sm:h-24 border border-dashed border-gray-300 rounded opacity-50 scale-75 origin-top" />
             )}
          </div>
        ))}
      </div>

      <div className="relative z-10">
        <button 
          disabled={!canPlay || data.owner || (isHost ? hostFull : guestFull)}
          onClick={() => onPlayToFlag(index)}
          className={`
            w-10 h-10 sm:w-12 sm:h-12 rounded-full border-4 flex items-center justify-center shadow-inner transition-all flex-shrink-0 touch-manipulation
            ${statusColor}
            ${canPlay && !data.owner && (isHost ? !hostFull : !guestFull) ? 'animate-pulse hover:scale-110 ring-2 ring-yellow-400 cursor-pointer' : ''}
            ${hasClaim ? 'ring-2 ring-purple-500 animate-bounce' : ''}
          `}
        >
          {data.owner ? (
             <Icon className={`w-5 h-5 sm:w-6 sm:h-6 ${data.owner === 'host' ? 'text-blue-600' : 'text-red-600'}`} />
          ) : hasClaim ? (
             <Gavel className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />
          ) : (
             <span className="text-gray-400 text-xs font-bold">{index + 1}</span>
          )}
        </button>

        {showActions && (
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex gap-1 z-20">
            {!hasClaim ? (
              isMyTurn && (
                <button 
                  onClick={(e) => { e.stopPropagation(); onClaim(index); }}
                  className="bg-white border border-slate-300 rounded-full p-1 shadow-sm hover:bg-slate-50 text-slate-500"
                  title="勝利を証明する"
                >
                  <Gavel size={12} />
                </button>
              )
            ) : isMyClaim ? (
              <button 
                onClick={(e) => { e.stopPropagation(); onCancelClaim(index); }}
                className="bg-white border border-red-200 rounded-full p-1 shadow-sm hover:bg-red-50 text-red-500"
                title="証明を取り消す"
              >
                <XCircle size={12} />
              </button>
            ) : (
              <>
                <button 
                  onClick={(e) => { e.stopPropagation(); onConcede(index); }}
                  className="bg-green-500 border border-green-600 rounded-full p-1 shadow-sm hover:bg-green-600 text-white animate-pulse"
                  title="認める"
                >
                  <CheckCircle2 size={12} />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); onDeny(index); }}
                  className="bg-white border border-slate-300 rounded-full p-1 shadow-sm hover:bg-slate-100 text-slate-500"
                  title="否認する"
                >
                  <Ban size={12} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-1 mt-6 sm:mt-8">
        {Array.from({ length: maxSlots }).map((_, i) => (
          <div key={`my-${i}`} className="w-12 h-8 sm:w-16 sm:h-12 flex justify-center">
             {isHost ? (
                data.hostCards[i] ? <Card card={data.hostCards[i]} /> : <div className="w-12 h-16 sm:w-16 sm:h-24 border border-dashed border-gray-300 rounded opacity-50 scale-75 origin-bottom" />
             ) : (
                data.guestCards[i] ? <Card card={data.guestCards[i]} /> : <div className="w-12 h-16 sm:w-16 sm:h-24 border border-dashed border-gray-300 rounded opacity-50 scale-75 origin-bottom" />
             )}
          </div>
        ))}
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
  const [chatMessage, setChatMessage] = useState("");
  const [unreadCount, setUnreadCount] = useState(0);
  const [viewingEnvironment, setViewingEnvironment] = useState(null);
  
  const chatEndRef = useRef(null);
  const lastReadCountRef = useRef(0);

  // --- CRITICAL FIX: Unregister Service Worker ---
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (let registration of registrations) {
          console.log('Unregistering SW:', registration);
          registration.unregister();
        }
      });
    }
  }, []);

  // --- PWA & Mobile Setup ---
  useEffect(() => {
    const metaTags = [
      { name: 'apple-mobile-web-app-capable', content: 'yes' },
      { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' },
      { name: 'theme-color', content: '#f1f5f9' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover' }
    ];

    metaTags.forEach(tag => {
      let el = document.querySelector(`meta[name="${tag.name}"]`);
      if (!el) {
        el = document.createElement('meta');
        el.name = tag.name;
        document.head.appendChild(el);
      }
      el.content = tag.content;
    });

    const handleContext = (e) => e.preventDefault();
    document.addEventListener('contextmenu', handleContext);

    const handleInstall = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
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
    if (outcome === 'accepted') {
      setInstallPrompt(null);
    }
  };

  // --- Auth ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        await signInAnonymously(auth);
      } catch (e) {
        console.error("Auth failed", e);
      }
    };
    initAuth();
    return onAuthStateChanged(auth, (u) => setUser(u));
  }, []);

  // --- Game Listener ---
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
      createdAt: serverTimestamp(),
      lastMove: serverTimestamp()
    };

    try {
      await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'games', newGameId), gameData);
      setGameId(newGameId);
    } catch (e) {
      console.error(e);
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
      if (!gameSnap.exists()) {
        setError("ゲームが見つかりません。");
        setLoading(false);
        return;
      }
      const gameData = gameSnap.data();
      if (!gameData.guest) {
        await updateDoc(gameRef, { guest: user.uid });
      } else if (gameData.guest !== user.uid && gameData.host !== user.uid) {
        console.log("観戦モードで参加します");
      }
      setGameId(code);
    } catch (e) {
        console.error(e);
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
    
    let updateData = {};

    if (cardToPlay.type === 'tactics' && cardToPlay.subType === 'environment') {
       if (flag.environment) return;
       flag.environment = cardToPlay;
       hand.splice(selectedCardIdx, 1);
       newFlags[flagIndex] = flag;
       updateData.flags = newFlags;
       updateData[myHandKey] = hand;
    }
    else if (cardToPlay.type === 'tactics' && cardToPlay.subType === 'guile') {
       hand.splice(selectedCardIdx, 1);
       updateData[myHandKey] = hand;
       updateData[myGuileKey] = arrayUnion(cardToPlay);
    }
    else {
       const isMud = flag.environment?.name === 'Mud';
       const maxSlots = isMud ? 4 : 3;

       if (cardToPlay.name === 'Alexander' || cardToPlay.name === 'Darius') {
         const alreadyUsedLeader = game.flags.some(f => 
           f[myCardsKey].some(c => c.name === 'Alexander' || c.name === 'Darius')
         );
         if (alreadyUsedLeader) {
           return; 
         }
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
    }

    updateData.hasPlayedCard = true;
    updateData.winner = checkWinner(newFlags) || null;

    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    try {
      await updateDoc(gameRef, updateData);
    } catch (e) {
      console.error("Network Error:", e);
      setError("通信エラーが発生しました。再読み込みしてください。");
    }
    
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
      console.error("Network Error:", e);
      setError("通信エラーが発生しました。再読み込みしてください。");
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
    newFlags[flagIndex] = {
      ...newFlags[flagIndex],
      owner: winnerRole,
      proofClaim: null
    };
    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, { 
      flags: newFlags,
      winner: checkWinner(newFlags) || null
    });
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
            <button 
              onClick={createGame} 
              disabled={loading}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow transition-all flex items-center justify-center gap-2 active:scale-95 touch-manipulation"
            >
              {loading ? 'Creating...' : <><Play size={20} /> New Game</>}
            </button>
            <form onSubmit={(e) => { e.preventDefault(); joinGame(e.target.code.value); }} className="flex gap-2">
              <input 
                name="code"
                placeholder="Game Code" 
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase text-sm sm:text-base touch-manipulation"
              />
              <button 
                type="submit" 
                disabled={loading}
                className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg transition-colors text-sm sm:text-base active:scale-95 touch-manipulation"
              >
                Join
              </button>
            </form>
            {installPrompt && (
               <button 
                 onClick={triggerInstall}
                 className="w-full py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg shadow flex items-center justify-center gap-2 active:scale-95 touch-manipulation"
               >
                 <Download size={18} /> Install App
               </button>
            )}
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

  const selectedDetails = selectedCardIdx !== null && myHand[selectedCardIdx] && myHand[selectedCardIdx].type === 'tactics' 
    ? myHand[selectedCardIdx] 
    : null;
  
  return (
    <div className="h-[100dvh] w-full bg-slate-100 flex flex-col overflow-hidden overscroll-y-none select-none touch-manipulation">
      <header className="bg-white shadow-sm px-3 py-2 flex justify-between items-center z-20 flex-shrink-0 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2">
          <Shield className="text-blue-600 w-6 h-6" />
          <span className="font-bold text-slate-800 text-lg hidden sm:inline">Battle Line</span>
        </div>
        
        {isSpectator ? (
           <div className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full text-xs sm:text-sm font-bold flex items-center gap-1">
             <Eye size={16} /> 観戦中
           </div>
        ) : (
          <div className="flex items-center gap-2">
             <button 
                onClick={() => setIsChatOpen(!isChatOpen)}
                className="relative p-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 mr-2"
             >
                <MessageCircle size={20} />
                {unreadCount > 0 && (
                   <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border border-white"></span>
                )}
             </button>
             <div className="flex items-center gap-2 sm:gap-4 bg-slate-100 px-3 py-1 rounded-full text-xs sm:text-sm">
               <div className={`flex items-center gap-1 ${game.turn === 'host' ? 'text-blue-600 font-bold' : 'text-slate-400'}`}>
                  <Users size={14} /> <span className="hidden xs:inline">Host</span>
               </div>
               <div className="text-slate-300">|</div>
               <div className={`flex items-center gap-1 ${game.turn === 'guest' ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
                  <Users size={14} /> <span className="hidden xs:inline">Guest</span>
               </div>
             </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <div className="bg-slate-100 px-2 py-1 rounded text-xs sm:text-sm font-mono flex items-center gap-2">
            {gameId}
            <button onClick={() => { navigator.clipboard.writeText(gameId); }} className="active:text-blue-600">
              <Copy size={12} />
            </button>
          </div>
        </div>
      </header>

      {isChatOpen && (
        <div 
          className="absolute inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/20"
          onClick={() => setIsChatOpen(false)}
        >
          <div 
            className="w-full sm:w-96 h-[60vh] sm:h-[500px] bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 bg-slate-800 text-white flex justify-between items-center shrink-0">
               <span className="font-bold flex items-center gap-2"><MessageCircle size={16}/> Game Chat</span>
               <button onClick={() => setIsChatOpen(false)}><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
               {game.chat && game.chat.length > 0 ? (
                 game.chat.map((msg, i) => (
                   <div key={i} className={`flex flex-col ${(isHost && msg.sender === 'host') || (isGuest && msg.sender === 'guest') ? 'items-end' : 'items-start'}`}>
                       <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                         (isHost && msg.sender === 'host') || (isGuest && msg.sender === 'guest') ? 'bg-blue-600 text-white rounded-br-none' : 
                         msg.sender === 'host' ? 'bg-blue-100 text-blue-900 rounded-bl-none' : 
                         'bg-red-100 text-red-900 rounded-bl-none'
                       }`}>
                         {msg.text}
                       </div>
                   </div>
                 ))
               ) : (
                 <div className="text-center text-slate-400 text-sm mt-10">No messages yet.</div>
               )}
               <div ref={chatEndRef}></div>
            </div>
            {!isSpectator && (
              <form onSubmit={sendMessage} className="p-3 border-t bg-white flex gap-2 shrink-0">
                <input 
                   className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                   value={chatMessage}
                   onChange={(e) => setChatMessage(e.target.value)}
                />
                <button type="submit" className="bg-slate-800 text-white p-2 rounded-lg hover:bg-slate-900"><Send size={18} /></button>
              </form>
            )}
          </div>
        </div>
      )}

      {viewingEnvironment && (
        <div 
           className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-in fade-in"
           onClick={() => setViewingEnvironment(null)}
        >
           <div className="bg-white p-6 rounded-xl shadow-2xl max-w-xs w-full text-center" onClick={(e) => e.stopPropagation()}>
              <Cloud className="w-12 h-12 mx-auto text-emerald-500 mb-2" />
              <h3 className="text-xl font-bold text-slate-800 mb-2">{viewingEnvironment.name}</h3>
              <p className="text-slate-600 mb-6">{viewingEnvironment.description}</p>
              <button 
                onClick={() => setViewingEnvironment(null)}
                className="bg-slate-800 text-white px-6 py-2 rounded-lg hover:bg-slate-900 w-full"
              >
                Close
              </button>
           </div>
        </div>
      )}

      <main className="flex-1 relative flex flex-col items-center justify-between overflow-hidden pb-[env(safe-area-inset-bottom)]">
        
        {/* Game Over Overlay */}
        {game.winner && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl text-center w-full max-w-sm">
              <Crown className="w-16 h-16 sm:w-20 sm:h-20 mx-auto text-yellow-500 mb-4 animate-bounce" />
              <h2 className="text-3xl font-black text-slate-800 mb-2">
                {game.winner === (isHost ? 'host' : 'guest') ? "VICTORY!" : "DEFEAT"}
              </h2>
              {isSpectator && <p className="text-slate-500 mb-4">{game.winner.toUpperCase()} WON!</p>}
              <button 
                onClick={() => {
                   setGameId("");
                   setGame(null);
                }} 
                className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 flex items-center justify-center gap-2 mt-6 active:scale-95"
              >
                <RotateCcw size={18} /> Return to Lobby
              </button>
            </div>
          </div>
        )}

        {/* Opponent Area */}
        <div className="w-full flex justify-between items-end py-2 bg-slate-100/50 flex-shrink-0 min-h-[60px] sm:min-h-[80px] px-2">
           <div className="flex gap-1 overflow-x-auto px-4 no-scrollbar items-end h-full flex-1 justify-center">
             {opponentHand && opponentHand.map((_, i) => (
               <Card key={`enemy-${i}`} hidden className="scale-75 origin-bottom" />
             ))}
           </div>
           
           <div className="w-24 h-full border-l border-slate-300 pl-2 flex flex-col justify-end items-center opacity-70">
              <span className="text-[10px] text-slate-500 font-bold mb-1">Played Guile</span>
              <div className="flex flex-wrap gap-1 justify-center">
                {opponentGuile.length > 0 ? opponentGuile.map((c, i) => (
                  <div key={i} className="w-5 h-7 bg-purple-100 border border-purple-400 rounded flex items-center justify-center shadow-sm">
                      <Scroll size={10} className="text-purple-700" />
                  </div>
                )) : <div className="text-[10px] text-slate-400">-</div>}
              </div>
           </div>
        </div>

        {/* Board Area */}
        <div 
           ref={flagsContainerRef}
           className="w-full flex-1 overflow-x-auto overflow-y-hidden snap-x snap-mandatory flex items-center py-2 sm:py-4 px-4 sm:px-0 no-scrollbar touch-pan-x"
        >
          <div className="flex gap-2 sm:gap-4 justify-start sm:justify-center min-w-[max-content] mx-auto">
            {game.flags.map((flag, idx) => (
              <FlagSpot 
                key={idx} 
                index={idx} 
                data={flag} 
                isHost={viewAsHost} 
                onPlayToFlag={playCard}
                onClaim={claimFlag}
                onConcede={concedeFlag}
                onDeny={denyFlag}
                onCancelClaim={cancelClaim}
                onEnvironmentClick={setViewingEnvironment} 
                canPlay={isMyTurn && selectedCardIdx !== null}
                isSpectator={isSpectator}
                isMyTurn={isMyTurn}
              />
            ))}
          </div>
        </div>

        {/* Player Area */}
        <div className="w-full bg-white border-t border-slate-200 p-2 pb-2 sm:p-4 z-10 flex-shrink-0">
          <div className="relative w-full max-w-4xl mx-auto">
             {/* My Guile Zone */}
             <div className="absolute -top-24 right-2 w-24 flex flex-col items-end opacity-90 z-10 pointer-events-none">
                <span className="text-[10px] text-slate-500 font-bold mb-1 bg-white/80 px-1 rounded shadow-sm">My Guile</span>
                <div className="flex flex-wrap gap-1 justify-end content-start">
                  {myGuile.length > 0 ? myGuile.map((c, i) => (
                    <div key={i} className="w-6 h-9 bg-purple-100 border border-purple-400 rounded flex items-center justify-center shadow-sm">
                        <Scroll size={12} className="text-purple-700" />
                    </div>
                  )) : <div className="text-[10px] text-slate-400 bg-white/50 px-1 rounded">-</div>}
                </div>
             </div>

             {isMyTurn && (
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold bg-blue-100 text-blue-700 px-3 py-1 rounded-full shadow-sm animate-bounce z-20 whitespace-nowrap pointer-events-none">
                   YOUR TURN
                </div>
             )}

             {selectedDetails && (
               <div className="absolute -top-24 left-1/2 -translate-x-1/2 bg-slate-800/90 text-white p-3 rounded-lg shadow-lg w-64 z-30 text-center backdrop-blur-sm animate-in fade-in slide-in-from-bottom-2 pointer-events-none">
                 <h4 className="font-bold text-yellow-400 flex items-center justify-center gap-2">
                   {selectedDetails.name}
                 </h4>
                 <p className="text-xs mt-1 leading-snug">{selectedDetails.description}</p>
               </div>
             )}
             
             {isMyTurn && game.hasPlayedCard && (
               <div className="absolute -top-16 inset-x-0 flex justify-center gap-4 z-20 pointer-events-auto">
                 <button 
                   onClick={() => drawAndEndTurn('normal')}
                   className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl shadow-lg flex flex-col items-center gap-1 active:scale-95 transition-all"
                 >
                   <span className="text-xs opacity-80">通常ドロー</span>
                   <span className="flex items-center gap-1"><Layers size={16}/> 終了</span>
                 </button>

                 <button 
                   onClick={() => drawAndEndTurn('tactics')}
                   disabled={!game.tacticsDeck || game.tacticsDeck.length === 0}
                   className="bg-orange-600 hover:bg-orange-700 disabled:bg-slate-400 text-white font-bold py-2 px-4 rounded-xl shadow-lg flex flex-col items-center gap-1 active:scale-95 transition-all"
                 >
                   <span className="text-xs opacity-80">戦術ドロー</span>
                   <span className="flex items-center gap-1"><Zap size={16}/> 終了</span>
                 </button>
               </div>
             )}

             <div className="flex gap-2 sm:gap-3 overflow-x-auto px-2 py-2 sm:justify-center snap-x items-end min-h-[100px] sm:min-h-[120px] touch-pan-x">
               {myHand && myHand.map((card, i) => (
                 <div key={card.id} className="snap-center">
                    <Card 
                      card={card} 
                      onClick={() => !isSpectator && isMyTurn && setSelectedCardIdx(selectedCardIdx === i ? null : i)}
                      selected={selectedCardIdx === i}
                      className={`shadow-md bg-white ${isSpectator ? 'cursor-default' : 'cursor-pointer'} ${!isMyTurn || game.hasPlayedCard ? 'opacity-50' : ''}`}
                    />
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


