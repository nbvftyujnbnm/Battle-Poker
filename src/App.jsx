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
  serverTimestamp
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
  Ban,         // 追加: 否認アイコン
  ArrowRight   // 追加: ターン終了アイコン
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
const db = getFirestore(app);

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
      deck.push({ id: `${color}-${value}`, color, value });
    });
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const evaluateFormation = (cards) => {
  if (cards.length !== 3) return { tier: 0, sum: 0 };

  const sorted = [...cards].sort((a, b) => a.value - b.value);
  const values = sorted.map(c => c.value);
  const colors = sorted.map(c => c.color);
  const sum = values.reduce((a, b) => a + b, 0);

  const isFlush = colors.every(c => c === colors[0]);
  const isStraight = (values[1] === values[0] + 1) && (values[2] === values[1] + 1);
  const isThreeOfAKind = values[0] === values[1] && values[1] === values[2];

  if (isFlush && isStraight) return { tier: 5, sum }; // Wedge
  if (isThreeOfAKind) return { tier: 4, sum };        // Phalanx
  if (isFlush) return { tier: 3, sum };               // Battalion
  if (isStraight) return { tier: 2, sum };            // Skirmish
  return { tier: 1, sum };                            // Host
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

// Update: onDeny追加
const FlagSpot = ({ index, data, isHost, onPlayToFlag, onClaim, onConcede, onDeny, onCancelClaim, canPlay, isSpectator, isMyTurn }) => {
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

  return (
    <div className="flex flex-col items-center gap-1 sm:gap-2 snap-center flex-shrink-0 px-1 relative">
      <div className="flex flex-col gap-1">
        {[0, 1, 2].map(i => (
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
          disabled={!canPlay || data.owner || (isHost ? data.hostCards.length >= 3 : data.guestCards.length >= 3)}
          onClick={() => onPlayToFlag(index)}
          className={`
            w-10 h-10 sm:w-12 sm:h-12 rounded-full border-4 flex items-center justify-center shadow-inner transition-all flex-shrink-0 touch-manipulation
            ${statusColor}
            ${canPlay && !data.owner && (isHost ? data.hostCards.length < 3 : data.guestCards.length < 3) ? 'animate-pulse hover:scale-110 ring-2 ring-yellow-400 cursor-pointer' : ''}
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
              // 相手が請求中: 承認 or 否認
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
        {[0, 1, 2].map(i => (
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
  const chatEndRef = useRef(null);
  const lastReadCountRef = useRef(0);

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
        setError("Connection lost.");
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
    const hostHand = newDeck.splice(0, HAND_SIZE);
    const guestHand = newDeck.splice(0, HAND_SIZE);

    const initialFlags = Array(FLAGS_COUNT).fill(null).map(() => ({
      hostCards: [], guestCards: [], owner: null, completedAt: null, proofClaim: null 
    }));

    const newGameId = Math.random().toString(36).substring(2, 8).toUpperCase();
    const gameData = {
      id: newGameId,
      host: user.uid,
      guest: null,
      turn: 'host',
      hasPlayedCard: false, // 追加: カードを出したか
      winner: null,
      deck: newDeck,
      hostHand,
      guestHand,
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
    if (game.hasPlayedCard) return; // 既にカードを出していたらプレイ不可

    const newFlags = [...game.flags];
    const flag = { ...newFlags[flagIndex] };
    const myHandKey = isHost ? 'hostHand' : 'guestHand';
    const myCardsKey = isHost ? 'hostCards' : 'guestCards';
    const hand = [...game[myHandKey]];
    const cardToPlay = hand[selectedCardIdx];

    if (flag.owner || flag[myCardsKey].length >= 3) return;

    hand.splice(selectedCardIdx, 1);
    flag[myCardsKey] = [...flag[myCardsKey], cardToPlay];

    // Check simple full resolution
    if (flag.hostCards.length === 3 && flag.guestCards.length === 3) {
      const hostScore = evaluateFormation(flag.hostCards);
      const guestScore = evaluateFormation(flag.guestCards);
      
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
    const deck = [...game.deck];
    if (deck.length > 0) hand.push(deck.shift());

    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, {
      flags: newFlags,
      [myHandKey]: hand,
      deck: deck,
      hasPlayedCard: true, // カードプレイ済みにする（ターンはまだ変えない）
      winner: checkWinner(newFlags) || null
      // lastMoveはターン終了時に更新
    });
    setSelectedCardIdx(null);
  };

  const endTurn = async () => {
    if (!game || !user) return;
    const isHost = user.uid === game.host;
    if (game.turn !== (isHost ? 'host' : 'guest')) return;
    if (!game.hasPlayedCard) return; // カードを出すまで終了不可

    const myRole = isHost ? 'host' : 'guest';
    
    // 自動否認ロジック: 自分が請求したまま残っているフラッグを取り消す
    const newFlags = game.flags.map(flag => {
      if (flag.proofClaim && flag.proofClaim.claimant === myRole) {
        return { ...flag, proofClaim: null };
      }
      return flag;
    });

    const gameRef = doc(db, 'artifacts', appId, 'public', 'data', 'games', gameId);
    await updateDoc(gameRef, {
      flags: newFlags,
      turn: isHost ? 'guest' : 'host',
      hasPlayedCard: false,
      lastMove: serverTimestamp()
    });
  };

  // --- Proof & Chat Actions ---

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
    // 否認（取り消しと同じ処理だが、相手のアクション）
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

  // --- Renders ---

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
  const isMyTurn = !isSpectator && (game.turn === (isHost ? 'host' : 'guest'));
  
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
                 game.chat.map((msg, i) => {
                   const isMe = (isHost && msg.sender === 'host') || (isGuest && msg.sender === 'guest');
                   return (
                     <div key={i} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                       <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${
                         isMe ? 'bg-blue-600 text-white rounded-br-none' : 
                         msg.sender === 'host' ? 'bg-blue-100 text-blue-900 rounded-bl-none' : 
                         'bg-red-100 text-red-900 rounded-bl-none'
                       }`}>
                         {msg.text}
                       </div>
                       <span className="text-[10px] text-slate-400 mt-1">
                         {msg.sender === 'host' ? 'Host' : 'Guest'}
                       </span>
                     </div>
                   );
                 })
               ) : (
                 <div className="text-center text-slate-400 text-sm mt-10">
                   No messages yet.<br/>Use chat to explain proofs.
                 </div>
               )}
               <div ref={chatEndRef}></div>
            </div>
            {!isSpectator && (
              <form onSubmit={sendMessage} className="p-3 border-t bg-white flex gap-2 shrink-0">
                <input 
                   className="flex-1 border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                   placeholder="Type a message..."
                   value={chatMessage}
                   onChange={(e) => setChatMessage(e.target.value)}
                />
                <button type="submit" className="bg-slate-800 text-white p-2 rounded-lg hover:bg-slate-900">
                  <Send size={18} />
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 relative flex flex-col items-center justify-between overflow-hidden pb-[env(safe-area-inset-bottom)]">
        
        {/* Game Over */}
        {game.winner && (
          <div className="absolute inset-0 z-50 bg-black/50 flex items-center justify-center backdrop-blur-sm p-4">
            <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-2xl text-center w-full max-w-sm">
              <Crown className="w-16 h-16 sm:w-20 sm:h-20 mx-auto text-yellow-500 mb-4" />
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

        {!game.guest && (
          <div className="absolute top-4 z-40 w-full flex justify-center">
            <div className="bg-blue-50 border border-blue-200 px-4 py-2 rounded-full flex items-center gap-2 animate-pulse shadow-lg mx-4 text-center">
               <Share2 className="w-4 h-4 text-blue-500" />
               <span className="text-blue-700 text-xs sm:text-sm font-medium">Waiting for opponent... Code: <b>{gameId}</b></span>
            </div>
          </div>
        )}

        <div className="w-full flex justify-center py-2 bg-slate-100/50 flex-shrink-0 min-h-[60px] sm:min-h-[80px]">
           <div className="flex gap-1 overflow-x-auto px-4 no-scrollbar items-end h-full">
             {opponentHand && opponentHand.map((_, i) => (
               <Card key={`enemy-${i}`} hidden className="scale-75 origin-bottom" />
             ))}
           </div>
        </div>

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
                onDeny={denyFlag} // Added
                onCancelClaim={cancelClaim}
                canPlay={isMyTurn && selectedCardIdx !== null}
                isSpectator={isSpectator}
                isMyTurn={isMyTurn}
              />
            ))}
          </div>
        </div>

        <div className="w-full bg-white border-t border-slate-200 p-2 pb-2 sm:p-4 z-10 flex-shrink-0">
          <div className="relative w-full max-w-4xl mx-auto">
             {isMyTurn && (
                <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-bold bg-blue-100 text-blue-700 px-3 py-1 rounded-full shadow-sm animate-bounce z-20 whitespace-nowrap pointer-events-none">
                   YOUR TURN
                </div>
             )}
             
             {/* Turn End Button */}
             {isMyTurn && game.hasPlayedCard && (
               <div className="absolute -top-14 right-4 z-20">
                 <button 
                   onClick={endTurn}
                   className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-full shadow-lg flex items-center gap-2 animate-bounce"
                 >
                   End Turn <ArrowRight size={16} />
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
             
             <div className="text-center text-[10px] sm:text-xs text-slate-400 mt-1">
                Deck: {game.deck.length} remaining
             </div>
          </div>
        </div>

      </main>
    </div>
  );
}


