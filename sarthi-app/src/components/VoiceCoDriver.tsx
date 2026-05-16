import { useEffect, useRef, useState } from 'react';
import { useSarthi } from '../store/useSarthi';
import { voiceIntent, voiceReply } from '../agent/tools';
import type { VoiceParse } from '../agent/tools';

interface Turn {
  who: 'driver' | 'sarthi';
  text: string;
  parse?: VoiceParse;
}

const PROMPTS = [
  'Plan 3 hours, weekend',
  'I just paid school fees S$120',
  'How am I doing?',
  'I am tired, can I rest?',
  'Customer says the gate is locked',
];

type AnyWindow = Window & {
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  SpeechRecognition?: new () => SpeechRecognitionLike;
};

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}

function getRecognizer(): SpeechRecognitionLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as AnyWindow;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = 'en-SG';
  r.interimResults = false;
  r.continuous = false;
  return r;
}

function speak(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-SG';
  u.rate = 1.0;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export default function VoiceCoDriver() {
  const { go } = useSarthi();
  const [turns, setTurns] = useState<Turn[]>([
    {
      who: 'sarthi',
      text:
        "Hands on the wheel. Tell me what you need — 'plan 3 hours', 'I paid school fees S$120', 'how am I doing?'",
    },
  ]);
  const [listening, setListening] = useState(false);
  const [text, setText] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = typeof window !== 'undefined' && (
    'webkitSpeechRecognition' in window || 'SpeechRecognition' in window
  );

  useEffect(() => {
    return () => {
      if (recRef.current) recRef.current.stop();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  function handle(raw: string) {
    if (!raw.trim()) return;
    const parse = voiceIntent(raw);
    const reply = voiceReply(parse);
    setTurns((t) => [
      ...t,
      { who: 'driver', text: raw, parse },
      { who: 'sarthi', text: reply },
    ]);
    speak(reply);
  }

  function startListening() {
    if (!supported) {
      handle(text || 'How am I doing?');
      setText('');
      return;
    }
    const r = getRecognizer();
    if (!r) return;
    recRef.current = r;
    r.onresult = (event) => {
      const said = event.results[0][0].transcript;
      handle(said);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    setListening(true);
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }

  return (
    <main className="scroll" aria-labelledby="voice-h">
      <button
        className="link-edit"
        onClick={() => go('dashboard')}
        style={{ alignSelf: 'flex-start' }}
      >
        ← Dashboard
      </button>
      <p className="chip" style={{ alignSelf: 'flex-start' }}>
        Voice Co-Driver — hands-free
      </p>
      <h1 className="lede" id="voice-h">
        Hands on the wheel. <span className="g">Eyes on the road</span>.
      </h1>
      <p className="muted-p">
        A voice-first surface for the same agent. Sarthi listens, parses the
        intent deterministically, replies in plain language, and speaks the
        reply out loud. Voice is rebuilt to be hands-busy aware — no menus,
        no dashboards, no fine print.
      </p>

      <section className="card voice-mic-card">
        <button
          className={`voice-mic ${listening ? 'on' : ''}`}
          onClick={() => (listening ? recRef.current?.stop() : startListening())}
          aria-label="Speak to Sarthi"
        >
          {listening ? '●' : '🎙'}
        </button>
        <p className="goal-sub">
          {supported
            ? listening
              ? 'Listening — speak now.'
              : 'Tap and speak. Or type below.'
            : 'Speech recognition is not available in this browser. Type below.'}
        </p>
        <div className="voice-typebox">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Or type a command..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handle(text);
                setText('');
              }
            }}
          />
          <button
            className="btn go"
            onClick={() => {
              handle(text);
              setText('');
            }}
          >
            Send
          </button>
        </div>
      </section>

      <div className="section-label">Try a prompt</div>
      <div className="voice-prompts">
        {PROMPTS.map((p) => (
          <button key={p} className="voice-prompt" onClick={() => handle(p)}>
            {p}
          </button>
        ))}
      </div>

      <div className="section-label">Conversation</div>
      <section className="card voice-thread" aria-live="polite">
        {turns.map((t, i) => (
          <div key={i} className={`voice-turn ${t.who}`}>
            <span className="voice-who">{t.who === 'driver' ? 'You' : 'Sarthi'}</span>
            <p>{t.text}</p>
          </div>
        ))}
      </section>

      <p className="note">
        Voice only prepares the action — you confirm on screen. Sarthi never
        moves money by voice.
      </p>
    </main>
  );
}
