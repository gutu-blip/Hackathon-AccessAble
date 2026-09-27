import React, { useEffect, useRef, useState } from 'react';
import { chatWithAble, extractSuggestion } from '../services/gemini';

/**
 * Ask Able — floating, voice-first Gemini assistant for persons with disabilities.
 *
 * PWD-first features:
 * - Text + voice input (Web Speech API where available)
 * - Spoken replies via speechSynthesis ("Read aloud" toggle)
 * - One-tap accessible prompts ("Find remote jobs…", "Explain this page")
 * - "Read results aloud" reads the current catalogue count + top titles
 * - Model can emit `SUGGEST: <phrase>` which auto-fills the catalogue search
 * - Fully keyboard operable, aria-live announcements, large touch targets
 */

const QUICK_PROMPTS = [
  { label: 'Remote screen-reader jobs', prompt: 'Find remote jobs with screen reader support' },
  { label: 'ASL events', prompt: 'Show me events with ASL or captions' },
  { label: 'Wheelchair access', prompt: 'Which opportunities have wheelchair or step-free access?' },
  { label: 'Explain this page', prompt: 'Explain in simple steps how to use this page to find and apply for an opportunity' },
];

function speak(text, { rate = 1 } = {}) {
  try {
    if (!('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    const clean = String(text || '').replace(/SUGGEST:.*$/i, '').trim().slice(0, 900);
    if (!clean) return false;
    const utter = new SpeechSynthesisUtterance(clean);
    utter.rate = rate;
    window.speechSynthesis.speak(utter);
    return true;
  } catch (e) {
    return false;
  }
}

function stopSpeaking() {
  try {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  } catch (e) { /* noop */ }
}

export default function AIAssistant({ opportunities = [], visibleCount = 0, visibleTitles = [], onApplySuggestion }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: 'able',
      text: 'Hi, I am Able — your AI guide. Ask me in your own words, or by voice. Try: "Find remote jobs I can do with a screen reader." I can also read results aloud or explain this page step by step.',
    },
  ]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [listening, setListening] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [voiceSupported] = useState(() => {
    try {
      return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    } catch (e) {
      return false;
    }
  });
  const scrollRef = useRef(null);
  const recogRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open, thinking]);

  useEffect(() => () => {
    stopSpeaking();
    try { recogRef.current?.stop(); } catch (e) { /* noop */ }
  }, []);

  const send = async (rawText) => {
    const text = String(rawText || '').trim();
    if (!text || thinking) return;
    const nextHistory = [...messages, { role: 'user', text }];
    setMessages(nextHistory);
    setInput('');
    setThinking(true);
    try {
      const historyForApi = nextHistory.slice(-10).map((m) => ({
        role: m.role === 'user' ? 'user' : 'model',
        text: m.text,
      }));
      const { text: reply } = await chatWithAble(historyForApi, opportunities);
      const suggestion = extractSuggestion(reply);
      const display = String(reply || '').replace(/SUGGEST:.*$/i, '').trim() || 'Sorry, I did not catch that. Try asking for remote jobs, ASL events, or grants.';
      setMessages((prev) => [...prev, { role: 'able', text: display }]);
      if (readAloud) speak(display);
      if (suggestion && typeof onApplySuggestion === 'function') {
        onApplySuggestion(suggestion, display);
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'able', text: 'Sorry — my AI is unreachable right now. You can still use the search bar, quick pills, and filters above. Want me to read the visible results aloud?' }]);
    } finally {
      setThinking(false);
    }
  };

  const startListening = () => {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      if (listening) {
        recogRef.current?.stop();
        return;
      }
      const recog = new SR();
      recogRef.current = recog;
      recog.lang = 'en-KE';
      recog.interimResults = false;
      recog.maxAlternatives = 1;
      recog.onresult = (e) => {
        const transcript = e.results?.[0]?.[0]?.transcript || '';
        setInput(transcript);
        setListening(false);
        if (transcript.trim()) send(transcript);
      };
      recog.onerror = () => setListening(false);
      recog.onend = () => setListening(false);
      recog.start();
      setListening(true);
    } catch (e) {
      setListening(false);
    }
  };

  const readResultsAloud = () => {
    if (!visibleTitles.length) {
      const msg = visibleCount === 0 ? 'No opportunities match your current filters. Try clearing the filters.' : 'Results are loading.';
      setMessages((prev) => [...prev, { role: 'able', text: msg }]);
      speak(msg);
      return;
    }
    const top = visibleTitles.slice(0, 5);
    const msg = `I found ${visibleCount} ${visibleCount === 1 ? 'opportunity' : 'opportunities'}. The top ones are: ${top.map((t, i) => `${i + 1}. ${t}`).join('. ')}. Open any card and press View details, then Apply Now.`;
    setMessages((prev) => [...prev, { role: 'able', text: msg }]);
    speak(msg);
  };

  return (
    <>
      {/* Floating entry — large target, always visible on both shells */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? 'Close AI assistant' : 'Open AI assistant Able'}
        className="fixed bottom-24 lg:bottom-8 right-4 z-[90] flex items-center gap-2 rounded-full bg-primary px-5 py-3.5 font-label-md text-label-md font-bold text-on-primary shadow-2xl hover:bg-primary-container transition-all hover:scale-[1.03] active:scale-95 min-h-[52px]"
      >
        <span className="material-symbols-outlined text-[22px]" aria-hidden="true">smart_toy</span>
        {open ? 'Close Able' : 'Ask Able ✨'}
      </button>

      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="Able AI assistant — ask in words or by voice"
          className="fixed bottom-40 lg:bottom-24 right-4 z-[95] flex w-[calc(100vw-2rem)] max-w-sm flex-col overflow-hidden rounded-3xl border border-outline-variant/40 bg-surface-container-lowest shadow-2xl"
        >
          <header className="flex items-center justify-between gap-2 bg-primary px-4 py-3 text-on-primary">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[22px]" aria-hidden="true">smart_toy</span>
              <div className="leading-tight">
                <p className="font-label-md text-label-md font-bold">Able — AI guide</p>
                <p className="text-[11px] opacity-90">Voice + text · powered by Gemini</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const next = !readAloud;
                  setReadAloud(next);
                  if (!next) stopSpeaking();
                }}
                aria-pressed={readAloud}
                title={readAloud ? 'Turn off spoken replies' : 'Read replies aloud'}
                aria-label={readAloud ? 'Turn off spoken replies' : 'Read replies aloud'}
                className={`rounded-full p-2 transition-colors ${readAloud ? 'bg-white/25' : 'hover:bg-white/15'}`}
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{readAloud ? 'volume_up' : 'volume_off'}</span>
              </button>
              <button
                type="button"
                onClick={() => { setOpen(false); stopSpeaking(); }}
                aria-label="Close assistant"
                className="rounded-full p-2 hover:bg-white/15 transition-colors"
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">close</span>
              </button>
            </div>
          </header>

          <div ref={scrollRef} aria-live="polite" className="flex max-h-80 min-h-[240px] flex-col gap-2 overflow-y-auto px-3.5 py-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <p
                  className={
                    m.role === 'user'
                      ? 'max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-[13px] leading-[19px] text-on-primary'
                      : 'max-w-[90%] rounded-2xl rounded-bl-md bg-surface-container-low px-3.5 py-2.5 text-[13px] leading-[19px] text-on-surface'
                  }
                >
                  {m.text}
                </p>
              </div>
            ))}
            {thinking && (
              <div className="flex justify-start" aria-label="Able is thinking">
                <p className="animate-pulse rounded-2xl rounded-bl-md bg-surface-container-low px-3.5 py-2.5 text-[13px] text-on-surface-variant">Able is thinking…</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 px-3.5 pb-2">
            {QUICK_PROMPTS.map((q) => (
              <button
                key={q.label}
                type="button"
                onClick={() => send(q.prompt)}
                disabled={thinking}
                className="rounded-full bg-surface-container px-3 py-1.5 text-[12px] font-semibold text-on-surface hover:bg-secondary-container hover:text-on-secondary-fixed transition-colors disabled:opacity-50"
              >
                {q.label}
              </button>
            ))}
            <button
              type="button"
              onClick={readResultsAloud}
              className="inline-flex items-center gap-1 rounded-full bg-secondary-container/50 px-3 py-1.5 text-[12px] font-bold text-on-secondary-fixed hover:bg-secondary-container transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">volume_up</span>
              Read results aloud
            </button>
          </div>

          <form
            className="flex items-center gap-1.5 border-t border-surface-container bg-surface-container-lowest px-3 py-2.5"
            onSubmit={(e) => { e.preventDefault(); send(input); }}
          >
            <label htmlFor="able-input" className="sr-only">Ask Able anything about opportunities</label>
            <input
              id="able-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={voiceSupported ? 'Ask or tap mic to speak…' : 'Ask about jobs, events, access…'}
              className="min-w-0 flex-1 rounded-full bg-surface-container-low px-4 py-2.5 text-[13px] text-on-surface placeholder:text-outline outline-none focus:ring-2 focus:ring-primary"
              autoComplete="off"
            />
            {voiceSupported && (
              <button
                type="button"
                onClick={startListening}
                aria-label={listening ? 'Stop listening' : 'Speak your question'}
                aria-pressed={listening}
                title={listening ? 'Stop listening' : 'Speak your question'}
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all ${listening ? 'animate-pulse bg-error text-on-error' : 'bg-surface-container text-primary hover:bg-primary-fixed'}`}
              >
                <span className="material-symbols-outlined text-[20px]" aria-hidden="true">{listening ? 'mic_off' : 'mic'}</span>
              </button>
            )}
            <button
              type="submit"
              disabled={thinking || !input.trim()}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary shadow-sm hover:bg-primary-container transition-colors disabled:opacity-40"
            >
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">send</span>
            </button>
          </form>
        </section>
      )}
    </>
  );
}
