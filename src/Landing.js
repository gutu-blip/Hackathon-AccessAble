import React, { useEffect, useMemo, useRef, useState } from 'react';
import AIAssistant from './components/AIAssistant';
import { subscribeOpportunities } from './services/opportunities';
import {
  callGemini,
  parseNaturalLanguageQuery,
  translateEasyRead,
} from './services/gemini';

/* ------------------------------------------------------------------
 * Landing — premium marketing entry for AccessAble.
 * Dark editorial hero + light product sections. No external images:
 * visuals are pure CSS/Tailwind glass cards so the page never depends
 * on live image hosts. Fully responsive + keyboard accessible.
 *
 * PWD-first Gemini layer (this file):
 *  1. AI Discovery Bar (hero) — parseNaturalLanguageQuery converts free
 *     text / voice ("remote jobs with screen reader support") into
 *     structured catalogue filters + a plain-language explanation, then
 *     hands the filters to Home via onExplore(parsed). Voice input uses
 *     the Web Speech API; results are announced via aria-live + optional
 *     speechSynthesis read-back. Navigation intents ("sign up", "post a
 *     job", "read the page") are detected first so voice users can move
 *     without scrolling.
 *  2. AI Access Match (section #ai-match) — one-tap access profile
 *     (blind / deaf / mobility / neurodivergent + work mode) sent to
 *     Gemini (callGemini) for personalized door recommendations. Offline
 *     rule-based fallback keeps it usable without a key/network.
 *  3. Page Guide toolbar — Read page aloud (speechSynthesis), Easy-Read
 *     summary (callGemini, <130 words, Grade-6), and EN <-> Kiswahili
 *     translation (translateEasyRead) for cognitive / low-literacy users.
 *  4. Ask Able floating copilot — chatWithAble (via <AIAssistant/>),
 *     grounded in the live catalogue snapshot from subscribeOpportunities,
 *     with voice input/output and SUGGEST: handoff into the AI bar.
 * ------------------------------------------------------------------ */

// --- Speech helpers (native browser APIs that complement Gemini) ---
function speakText(text, { rate = 1 } = {}) {
  try {
    if (!('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    const clean = String(text || '').slice(0, 1200).trim();
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

function voiceInputSupported() {
  try {
    return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  } catch (e) {
    return false;
  }
}

// Persist AI filters for the catalogue handoff (App/Home consume + clear).
function stashAiFilter(parsed) {
  try {
    if (parsed && typeof parsed === 'object') {
      sessionStorage.setItem('accessable.aiFilter', JSON.stringify(parsed));
    }
  } catch (e) { /* storage best-effort */ }
}

const AI_EXAMPLES = [
  'Remote jobs with screen reader support',
  'ASL events in Nairobi this month',
  'Grants for blind students',
  'Quiet-room trainings, hybrid only',
];

const ACCESS_NEEDS = [
  { key: 'blind', label: 'Blind / low vision', icon: 'visibility' },
  { key: 'deaf', label: 'Deaf / hard of hearing', icon: 'hearing' },
  { key: 'mobility', label: 'Mobility', icon: 'accessible' },
  { key: 'neurodivergent', label: 'Neurodivergent', icon: 'psychology' },
];

const WORK_PREFS = ['Remote Only', 'Hybrid', 'On-site Verified'];

const NEED_TO_DOORS = {
  blind: ['Jobs & Internships', 'Training & Fellowships', 'Grants & Funding'],
  deaf: ['Events & Webinars', 'Training & Fellowships', 'Jobs & Internships'],
  mobility: ['Jobs & Internships', 'Public Programs & Aid', 'Grants & Funding'],
  neurodivergent: ['Training & Fellowships', 'Jobs & Internships', 'Events & Webinars'],
};

const EASY_READ_FALLBACK = [
  'AccessAble is a website for persons with disabilities in Kenya.',
  'You can find jobs, events, grants, trainings, and aid here.',
  'Every post shows access help. For example: screen reader support, sign language, captions, step-free entry, or quiet rooms.',
  'Step 1: Type or speak what you need in the AI bar.',
  'Step 2: Open a card and press View details.',
  'Step 3: Press Apply Now. Ask the access coordinator if you need help.',
].join('\n');

const HERO_PLAIN_EN =
  'AccessAble is built exclusively for persons with disabilities. We curate vetted jobs, events, grants, trainings, public programs and aid where step-free venues, sign-language support, captions and assistive tech are confirmed upfront, not treated as an afterthought.';

const ACCOMMODATION_PILLS = [
  { icon: 'visibility', label: 'Screen Reader Verified' },
  { icon: 'sign_language', label: 'KSL / ASL Support' },
  { icon: 'accessible', label: 'Step-free Access' },
  { icon: 'subtitles', label: 'CART Captions' },
  { icon: 'volume_off', label: 'Quiet Room' },
  { icon: 'home_work', label: '100% Remote' },
];

const CATEGORIES = [
  {
    icon: 'work',
    title: 'Jobs & Internships',
    copy: 'Full-time, contract and paid internships with pay stated up front.',
  },
  {
    icon: 'event',
    title: 'Events & Webinars',
    copy: 'Summits, workshops and community meetups with venue access mapped.',
  },
  {
    icon: 'payments',
    title: 'Grants & Funding',
    copy: 'Bursaries, seed funds and direct aid with award amounts visible.',
  },
  {
    icon: 'school',
    title: 'Training & Fellowships',
    copy: 'Cohorts, bootcamps and upskilling with learning support confirmed.',
  },
  {
    icon: 'campaign',
    title: 'Public Programs & Aid',
    copy: 'Device distribution, affirmative action and community support.',
  },
];

const FEATURES = [
  {
    icon: 'travel_explore',
    title: 'Zero-barrier discovery',
    copy: 'Faceted search by accommodation — screen-reader compatibility, step-free access, ASL / CART, neurodivergent-friendly, remote-only and more.',
    accent: 'bg-blue-600',
  },
  {
    icon: 'verified',
    title: 'Accommodations declared upfront',
    copy: 'Every card shows only the access features the organizer confirmed, plus a named coordinator and notice period. No guesswork, no afterthoughts.',
    accent: 'bg-lime-500',
  },
  {
    icon: 'post_add',
    title: 'Guided posting + verification',
    copy: 'Employers post in ~3 minutes with mandatory accommodation disclosures. Listings enter a review pipeline before they reach the catalogue.',
    accent: 'bg-violet-600',
  },
  {
    icon: 'accessibility_new',
    title: 'Built-in accessibility toolkit',
    copy: 'High-contrast mode, larger text, dyslexia-friendly type, full keyboard flow, skip links and live-region announcements — WCAG 2.1 AA/AAA aligned.',
    accent: 'bg-slate-900',
  },
];

const STEPS = [
  {
    n: '01',
    icon: 'search',
    title: 'Discover without barriers',
    copy: 'Search or filter by the access you need — remote, step-free, captioned, quiet, flexible. Badges are machine-readable, not marketing copy.',
  },
  {
    n: '02',
    icon: 'fact_check',
    title: 'Verify before you invest time',
    copy: 'Open any listing to see venue directions, digital readiness, coordinator contact and alternative application paths (video, voice note, assisted).',
  },
  {
    n: '03',
    icon: 'send',
    title: 'Apply with needs attached',
    copy: 'Apply on the organizer site with your access needs already shared, so adjustments start before you apply — not after.',
  },
];

function LogoMark() {
  return (
    <span
      aria-hidden="true"
      className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-[#1d4ed8] to-[#3b82f6] text-white shadow-md shadow-blue-900/30 lg:h-9 lg:w-9 lg:rounded-xl"
    >
      <span className="material-symbols-outlined text-[18px] lg:text-[20px]">accessible_forward</span>
    </span>
  );
}

function Landing({ onExplore, onPostOpportunity, onSignUp }) {
  const [menuOpen, setMenuOpen] = useState(false);

  // --- AI Discovery Bar state (Gemini parseNaturalLanguageQuery) ---
  const [aiQuery, setAiQuery] = useState('');
  const [aiParsing, setAiParsing] = useState(false);
  const [aiResult, setAiResult] = useState(null); // {searchKeywords, quickFilter, workModes, accommodations, explanation, ai}
  const [aiListening, setAiListening] = useState(false);
  const [aiReadBack, setAiReadBack] = useState(false);
  const aiRecogRef = useRef(null);

  // --- Live catalogue snapshot (grounds Ask Able + live count) ---
  const [opportunities, setOpportunities] = useState([]);
  useEffect(() => {
    let unsub = null;
    try {
      unsub = subscribeOpportunities((items) => setOpportunities(Array.isArray(items) ? items : []), () => {});
    } catch (e) { /* offline — Able falls back to keyword mode */ }
    return () => {
      try { if (typeof unsub === 'function') unsub(); } catch (e) { /* noop */ }
      stopSpeaking();
      try { aiRecogRef.current?.stop(); } catch (e) { /* noop */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const liveCount = opportunities.length;
  const liveTitles = useMemo(
    () => (Array.isArray(opportunities) ? opportunities.slice(0, 5).map((o) => o?.basic?.title).filter(Boolean) : []),
    [opportunities]
  );

  // --- AI Access Match state (Gemini personalized doors) ---
  const [needs, setNeeds] = useState([]);
  const [workPref, setWorkPref] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileResult, setProfileResult] = useState(null); // {text, ai}

  // --- Page Guide state (read aloud / Easy-Read / Kiswahili) ---
  const [isReading, setIsReading] = useState(false);
  const [easyReadOpen, setEasyReadOpen] = useState(false);
  const [easyReadText, setEasyReadText] = useState('');
  const [easyReadLoading, setEasyReadLoading] = useState(false);
  const [easyReadIsAi, setEasyReadIsAi] = useState(true);
  const [swahiliMode, setSwahiliMode] = useState(false);
  const [heroTranslated, setHeroTranslated] = useState('');
  const [translating, setTranslating] = useState(false);

  const goExplore = (e, aiFilter) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    setMenuOpen(false);
    stopSpeaking();
    // Hand filters to App/Home when present; also stash for robustness.
    if (aiFilter && typeof aiFilter === 'object') stashAiFilter(aiFilter);
    if (typeof onExplore === 'function') onExplore(aiFilter || undefined);
  };

  // Voice navigation intents handled locally (no network needed).
  const tryVoiceNavigation = (text) => {
    const q = String(text || '').toLowerCase();
    if (/(sign\s?up|create account|register me|join)/.test(q) && /(sign|join|register|account)/.test(q)) {
      if (typeof onSignUp === 'function') onSignUp();
      return true;
    }
    if (/(post|publish|list|advertise|employer)/.test(q) && /(post|publish|advertise|job.*post)/.test(q)) {
      if (typeof onPostOpportunity === 'function') onPostOpportunity();
      return true;
    }
    if (/(read|aloud|speak|say).*(page|this|hero)/.test(q) || q.trim() === 'read this page') {
      handleReadPage();
      return true;
    }
    if (/(go to|open|show|take me to|browse|explore|find|search).*(opportunit|catalog|jobs|listing)/.test(q)) {
      goExplore(null);
      return true;
    }
    return false;
  };

  const handleAiFind = async (rawText) => {
    const text = String(rawText || aiQuery || '').trim();
    if (!text || aiParsing) return;
    // 1) Navigation commands first — fastest path for voice users.
    if (tryVoiceNavigation(text)) return;
    // 2) Gemini NL -> structured filters (offline rule fallback inside).
    setAiParsing(true);
    try {
      const parsed = await parseNaturalLanguageQuery(text);
      setAiResult(parsed);
      if (aiReadBack) speakText(parsed.explanation || 'I applied matching filters.');
    } catch (e) {
      setAiResult({ searchKeywords: text.slice(0, 120), quickFilter: 'All Opportunities', workModes: [], accommodations: [], explanation: 'AI is unreachable — showing keyword matches instead.', ai: false });
    } finally {
      setAiParsing(false);
    }
  };

  const startAiVoice = () => {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      if (aiListening) {
        try { aiRecogRef.current?.stop(); } catch (e) { /* noop */ }
        setAiListening(false);
        return;
      }
      const recog = new SR();
      aiRecogRef.current = recog;
      recog.lang = 'en-KE';
      recog.interimResults = false;
      recog.maxAlternatives = 1;
      recog.onresult = (ev) => {
        const transcript = ev.results?.[0]?.[0]?.transcript || '';
        setAiListening(false);
        if (transcript.trim()) {
          setAiQuery(transcript);
          handleAiFind(transcript);
        }
      };
      recog.onerror = () => setAiListening(false);
      recog.onend = () => setAiListening(false);
      recog.start();
      setAiListening(true);
    } catch (e) {
      setAiListening(false);
    }
  };

  const handleAbleSuggestion = (suggestion, displayText) => {
    const phrase = String(suggestion || '').trim();
    if (phrase) {
      setAiQuery(phrase.slice(0, 120));
      handleAiFind(phrase);
      try {
        document.getElementById('ai-discovery')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) { /* noop */ }
    } else if (displayText) {
      speakText(displayText);
    }
  };

  const handleReadPage = () => {
    if (isReading) {
      stopSpeaking();
      setIsReading(false);
      return;
    }
    const spoken = swahiliMode && heroTranslated
      ? heroTranslated
      : `${HERO_PLAIN_EN} There are ${liveCount || 'many'} live opportunities. Say or type what you need in the AI bar, for example: remote jobs with screen reader support. Then press Show matching opportunities.`;
    const ok = speakText(spoken, { rate: 0.95 });
    setIsReading(ok);
    try {
      if (ok && 'speechSynthesis' in window) {
        const check = setInterval(() => {
          try {
            if (!window.speechSynthesis.speaking) {
              setIsReading(false);
              clearInterval(check);
            }
          } catch (e) { clearInterval(check); }
        }, 600);
      }
    } catch (e) { /* noop */ }
  };

  const handleEasyRead = async () => {
    const next = !easyReadOpen;
    setEasyReadOpen(next);
    if (!next || easyReadText) return;
    setEasyReadLoading(true);
    try {
      const out = await callGemini(
        `Explain this page in Easy-Read for a person with a disability who is new to the internet:\n${HERO_PLAIN_EN}\nSections: Why AccessAble exists, How it works (Discover, Verify, Apply), Categories (jobs, events, grants, training, aid), Accessibility toolkit, For employers.`,
        { systemInstruction: 'You write Easy-Read summaries. Short sentences (max 12 words), Grade-5 level, warm tone, bullet lines starting with "- ", under 130 words. No jargon.' }
      );
      setEasyReadText(String(out || '').trim() || EASY_READ_FALLBACK);
      setEasyReadIsAi(true);
    } catch (e) {
      setEasyReadText(EASY_READ_FALLBACK);
      setEasyReadIsAi(false);
    } finally {
      setEasyReadLoading(false);
    }
  };

  const handleSwahiliToggle = async () => {
    const next = !swahiliMode;
    setSwahiliMode(next);
    if (!next) {
      stopSpeaking();
      return;
    }
    if (heroTranslated) {
      speakText(heroTranslated);
      return;
    }
    setTranslating(true);
    try {
      const { text } = await translateEasyRead(HERO_PLAIN_EN, 'Kiswahili');
      setHeroTranslated(text);
      speakText(text);
    } catch (e) {
      setHeroTranslated('');
    } finally {
      setTranslating(false);
    }
  };

  const toggleNeed = (key) => {
    setNeeds((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const handleProfileGenerate = async () => {
    if (!needs.length || profileLoading) return;
    setProfileLoading(true);
    try {
      const prompt = `Access needs: ${needs.join(', ') || 'not stated'}. Work mode: ${workPref || 'any'}. Live opportunities: ${liveCount}.\nRecommend the top 2 catalogue doors from [Jobs & Internships, Events & Webinars, Grants & Funding, Training & Fellowships, Public Programs & Aid] and the 2 most useful access filters from [Screen Reader Compatible, Wheelchair / Step-Free, ASL / CART Interpreting, Flexible Hours / Rest Breaks, Neurodivergent Friendly].\nFormat exactly:\nDOORS: <door 1> | <door 2>\nFILTERS: <filter 1> | <filter 2>\nWHY: <one warm plain sentence under 25 words>`;
      const out = await callGemini(prompt, {
        systemInstruction: 'You are Able, a disability-inclusion guide for Kenya. Plain warm language, never invent listings. Keep the exact 3-line format.',
      });
      setProfileResult({ text: String(out || '').trim(), ai: true });
    } catch (e) {
      // Offline fallback: union of door mapping + work-mode hint.
      const doors = [...new Set(needs.flatMap((n) => NEED_TO_DOORS[n] || []))].slice(0, 2);
      const fallbackDoors = doors.length ? doors : ['Jobs & Internships', 'Training & Fellowships'];
      setProfileResult({
        text: `DOORS: ${fallbackDoors.join(' | ')}\nFILTERS: ${workPref || 'Remote Only'} + tailored access filters\nWHY: Start with these doors — every card shows verified access help upfront.`,
        ai: false,
      });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleProfileExplore = () => {
    // Convert profile -> catalogue filter handoff (best-effort mapping).
    const text = String(profileResult?.text || '');
    const doorLine = (text.match(/DOORS:\s*(.+)/i)?.[1] || '').toLowerCase();
    let quickFilter = 'All Opportunities';
    if (/job/.test(doorLine)) quickFilter = 'Job/Internship';
    else if (/event|webinar/.test(doorLine)) quickFilter = 'Event/Webinar';
    else if (/grant|fund/.test(doorLine)) quickFilter = 'Grant/Funding';
    else if (/train|fellow/.test(doorLine)) quickFilter = 'Training/Fellowship';
    const filterLine = (text.match(/FILTERS:\s*(.+)/i)?.[1] || '');
    const accommodations = ['Screen Reader Compatible', 'Wheelchair / Step-Free', 'ASL / CART Interpreting', 'Flexible Hours / Rest Breaks', 'Neurodivergent Friendly'].filter((a) => filterLine.includes(a.split(' ')[0]));
    const parsed = {
      searchKeywords: needs.join(' '),
      quickFilter,
      workModes: workPref ? [workPref] : [],
      accommodations,
      explanation: 'Your access profile is applied in the catalogue.',
      ai: !!profileResult?.ai,
    };
    stashAiFilter(parsed);
    goExplore(null, parsed);
  };

  const goPost = (e) => {
    if (e) e.preventDefault();
    setMenuOpen(false);
    if (typeof onPostOpportunity === 'function') onPostOpportunity();
  };

  const goSignUp = (e) => {
    if (e) e.preventDefault();
    setMenuOpen(false);
    if (typeof onSignUp === 'function') onSignUp();
  };

  return (
    <div className="min-h-screen overflow-x-clip bg-[#060B1F] font-body-md text-slate-100 antialiased">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-slate-900"
      >
        Skip to content
      </a>



      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#060B1F]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:h-16 lg:gap-4 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            <LogoMark />
            <div className="leading-tight">
              <p className="text-[15px] font-extrabold tracking-tight text-white lg:text-[16px]">AccessAble</p>
            </div>
          </div>

          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {[
              ['Why AccessAble', '#why'],
              ['AI Match', '#ai-match'],
              ['How it works', '#how'],
              ['Categories', '#categories'],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="rounded-full px-4 py-2 text-sm font-semibold text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
              >
                {label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-2 lg:flex">
            <button
              type="button"
              onClick={goExplore}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-4 py-2 text-[13px] font-bold text-white transition-all hover:border-white/50 hover:bg-white/10"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                explore
              </span>
              Explore opportunities
            </button>
            <button
              type="button"
              onClick={goSignUp}
              className="inline-flex items-center gap-1.5 rounded-full bg-lime-300 px-4 py-2 text-[13px] font-extrabold text-lime-950 shadow-md shadow-lime-300/20 transition-transform hover:scale-[1.03] hover:bg-lime-200"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                person_add
              </span>
              Sign up
            </button>
          </div>

          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/15 text-white lg:hidden"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="material-symbols-outlined text-[20px]" aria-hidden="true">
              {menuOpen ? 'close' : 'menu'}
            </span>
          </button>
        </div>

        {menuOpen && (
          <nav
            aria-label="Mobile"
            className="border-t border-white/10 bg-[#060B1F] px-4 pb-5 pt-2 lg:hidden"
          >
            {[
              ['Why AccessAble', '#why'],
              ['AI Match', '#ai-match'],
              ['How it works', '#how'],
              ['Categories', '#categories'],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="block rounded-xl px-3 py-2.5 text-[14px] font-semibold text-slate-200 hover:bg-white/10 hover:text-white"
              >
                {label}
              </a>
            ))}
            <div className="mt-3 grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={goSignUp}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-lime-300 px-5 py-2.5 text-[13px] font-extrabold text-lime-950 sm:text-sm"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  person_add
                </span>
                Sign up
              </button>
              <button
                type="button"
                onClick={goExplore}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-extrabold text-slate-900 sm:text-sm"
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                  explore
                </span>
                Explore opportunities
              </button>
            </div>
          </nav>
        )}
      </header>

      <main id="main">
        {/* ============ HERO ============ */}
        <section
          aria-labelledby="hero-heading"
          className="relative overflow-hidden"
          style={{
            background:
              'radial-gradient(640px 340px at 85% -5%, rgba(59,130,246,0.32), transparent 60%), radial-gradient(560px 380px at 8% 10%, rgba(132,204,22,0.14), transparent 60%), linear-gradient(180deg, #060B1F 0%, #0A1330 55%, #060B1F 100%)',
          }}
        >
          {/* grid overlay */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.14]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.35) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
              maskImage: 'radial-gradient(ellipse 90% 70% at 50% 20%, black 30%, transparent 75%)',
              WebkitMaskImage:
                'radial-gradient(ellipse 90% 70% at 50% 20%, black 30%, transparent 75%)',
            }}
          />

          <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-8 px-4 pb-8 pt-8 sm:gap-10 sm:px-6 sm:pb-12 sm:pt-10 lg:grid-cols-12 lg:gap-10 lg:px-8 lg:pb-16 lg:pt-14">
            {/* Copy */}
            <div className="lg:col-span-7">
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-bold tracking-wide text-white backdrop-blur sm:text-[11px]">
                <span className="flex h-1.5 w-1.5 rounded-full bg-lime-300" aria-hidden="true" />
                WCAG 2.2 AA &nbsp;•&nbsp; ADA-ALIGNED &nbsp;•&nbsp; ACCESS-FIRST
              </div>

              <h1
                id="hero-heading"
                className="mt-4 text-balance text-[28px] font-extrabold leading-[1.12] tracking-[-0.02em] text-white sm:mt-5 sm:text-[36px] sm:leading-[1.08] lg:text-[44px]"
              >
                Every opportunity where persons with{' '}
                <span className="bg-gradient-to-r from-lime-200 via-lime-300 to-emerald-300 bg-clip-text text-transparent">
                  disabilities come first.
                </span>
                <br />
                Built exclusively for you.
              </h1>

              <p className="mt-4 max-w-xl text-pretty text-[13px] leading-relaxed text-slate-300 sm:mt-5 sm:text-[14px] lg:text-[15px]">
                {swahiliMode && heroTranslated ? (
                  heroTranslated
                ) : (
                  <>
                    AccessAble is built exclusively for persons with disabilities — not a
                    general jobs board. We curate every kind of opportunity where you are
                    the intended beneficiary: vetted jobs, events, grants, trainings, public
                    programs and aid where{' '}
                    <strong className="font-bold text-white">
                      step-free venues, sign-language support, captions and assistive tech
                    </strong>{' '}
                    are confirmed upfront, not treated as an afterthought.
                  </>
                )}
              </p>

              {/* Page Guide — one-tap AI access toolbar for PWDs */}
              <div className="mt-4 flex flex-wrap items-center gap-2" role="toolbar" aria-label="AI page guide">
                <button
                  type="button"
                  onClick={handleReadPage}
                  aria-pressed={isReading}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[12px] font-bold text-white transition-colors hover:bg-white/10"
                >
                  <span className="material-symbols-outlined text-[16px] text-lime-300" aria-hidden="true">
                    {isReading ? 'stop_circle' : 'volume_up'}
                  </span>
                  {isReading ? 'Stop reading' : 'Read page aloud'}
                </button>
                <button
                  type="button"
                  onClick={handleEasyRead}
                  aria-expanded={easyReadOpen}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[12px] font-bold text-white transition-colors hover:bg-white/10"
                >
                  <span className="material-symbols-outlined text-[16px] text-lime-300" aria-hidden="true">
                    auto_awesome
                  </span>
                  {easyReadOpen ? 'Hide Easy-Read' : 'Easy-Read'}
                </button>
                <button
                  type="button"
                  onClick={handleSwahiliToggle}
                  aria-pressed={swahiliMode}
                  disabled={translating}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[12px] font-bold text-white transition-colors hover:bg-white/10 disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[16px] text-lime-300" aria-hidden="true">
                    translate
                  </span>
                  {translating ? 'Translating…' : swahiliMode ? 'Show English' : 'Soma kwa Kiswahili'}
                </button>
                <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border border-white/20 bg-white/5 px-4 py-2 text-[12px] font-bold text-white transition-colors hover:bg-white/10">
                  <input
                    type="checkbox"
                    checked={aiReadBack}
                    onChange={(e) => setAiReadBack(e.target.checked)}
                    className="h-4 w-4 accent-lime-300"
                  />
                  Speak AI answers
                </label>
              </div>

              {easyReadOpen && (
                <div aria-live="polite" className="mt-3 max-w-xl rounded-2xl border border-lime-300/30 bg-lime-300/[0.07] p-4">
                  <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-lime-300">
                    <span className="material-symbols-outlined text-[15px]" aria-hidden="true">auto_awesome</span>
                    Easy-Read guide {easyReadIsAi ? '• Gemini AI' : '• offline mode'}
                  </p>
                  {easyReadLoading ? (
                    <p className="mt-2 animate-pulse text-[13px] text-slate-200">Able is writing a simple guide…</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {String(easyReadText || EASY_READ_FALLBACK).split('\n').filter(Boolean).map((line, i) => (
                        <li key={i} className="text-[13px] leading-relaxed text-slate-100">{line.replace(/^-\s*/, '• ')}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="mt-5 flex flex-col gap-2 sm:mt-6 sm:gap-2.5 lg:flex-row lg:items-center">
                <button
                  type="button"
                  onClick={goSignUp}
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-lime-300 px-5 py-2.5 text-[13px] font-extrabold text-lime-950 shadow-xl shadow-lime-300/20 transition-all hover:scale-[1.02] hover:bg-lime-200 sm:px-6 sm:py-3 sm:text-[14px]"
                >
                  <span className="material-symbols-outlined text-[16px] sm:text-[18px]" aria-hidden="true">
                    person_add
                  </span>
                  Sign up
                </button>
                <button
                  type="button"
                  onClick={goExplore}
                  className="group inline-flex items-center justify-center gap-2 rounded-full bg-[#1d4ed8] px-5 py-2.5 text-[13px] font-extrabold text-white shadow-xl shadow-blue-600/30 transition-all hover:scale-[1.02] hover:bg-[#2563eb] sm:px-6 sm:py-3 sm:text-[14px]"
                >
                  Browse opportunities
                  <span
                    className="material-symbols-outlined text-[16px] transition-transform group-hover:translate-x-1 sm:text-[18px]"
                    aria-hidden="true"
                  >
                    arrow_forward
                  </span>
                </button>

              </div>

              {/* AI Discovery Bar — Gemini NL -> catalogue filters (text + voice) */}
              <div
                id="ai-discovery"
                role="region"
                aria-label="AI discovery — describe what you need"
                className="mt-5 max-w-xl rounded-2xl border border-white/15 bg-white/[0.07] p-3.5 shadow-xl backdrop-blur-xl sm:mt-6 sm:p-4"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-lime-300 text-lime-950" aria-hidden="true">
                    <span className="material-symbols-outlined text-[18px]">auto_awesome</span>
                  </span>
                  <div className="min-w-0 leading-tight">
                    <p className="text-[13px] font-extrabold text-white">Describe what you need — AI finds it</p>
                    <p className="truncate text-[11px] text-slate-300">
                      {liveCount > 0 ? `${liveCount} live opportunities to search • ` : ''}Powered by Gemini • voice + text
                    </p>
                  </div>
                </div>

                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                  onSubmit={(e) => { e.preventDefault(); handleAiFind(); }}
                >
                  <label htmlFor="landing-ai-search" className="sr-only">
                    Describe the opportunity you need in your own words, or speak it
                  </label>
                  <input
                    id="landing-ai-search"
                    value={aiQuery}
                    onChange={(e) => setAiQuery(e.target.value)}
                    placeholder='Try: "remote jobs with screen reader support" or tap mic…'
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-full border border-white/15 bg-slate-950/60 px-4 py-2.5 text-[13px] text-white placeholder:text-slate-400 outline-none focus:border-lime-300 focus:ring-2 focus:ring-lime-300/40"
                  />
                  <div className="flex gap-2">
                    {voiceInputSupported() && (
                      <button
                        type="button"
                        onClick={startAiVoice}
                        aria-pressed={aiListening}
                        aria-label={aiListening ? 'Stop voice input' : 'Speak your search'}
                        title="Speak your search — you can also say 'sign me up' or 'read this page'"
                        className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2.5 text-[12px] font-bold transition-all ${aiListening ? 'animate-pulse bg-red-500 text-white' : 'bg-white/10 text-white hover:bg-white/20'}`}
                      >
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                          {aiListening ? 'mic_off' : 'mic'}
                        </span>
                        {aiListening ? 'Listening…' : 'Speak'}
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={aiParsing || !String(aiQuery || '').trim()}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full bg-lime-300 px-5 py-2.5 text-[13px] font-extrabold text-lime-950 transition-transform hover:scale-[1.02] disabled:opacity-50 sm:flex-none"
                    >
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">auto_awesome</span>
                      {aiParsing ? 'Understanding…' : 'AI Find'}
                    </button>
                  </div>
                </form>

                <div className="mt-2.5 flex flex-wrap gap-1.5" aria-label="Try an example">
                  {AI_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => { setAiQuery(ex); handleAiFind(ex); }}
                      disabled={aiParsing}
                      className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition-colors hover:border-lime-300/60 hover:text-white disabled:opacity-50"
                    >
                      {ex}
                    </button>
                  ))}
                </div>

                <div aria-live="polite">
                  {aiParsing && (
                    <p className="mt-2.5 flex items-center gap-1.5 text-[12px] text-slate-300">
                      <span className="material-symbols-outlined animate-pulse text-[16px] text-lime-300" aria-hidden="true">progress_activity</span>
                      Able is understanding your request…
                    </p>
                  )}
                  {aiResult && !aiParsing && (
                    <div className="mt-2.5 rounded-xl bg-slate-950/60 p-3">
                      <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-slate-100">
                        <span className="material-symbols-outlined mt-0.5 shrink-0 text-[16px] text-lime-300" aria-hidden="true">check_circle</span>
                        <span>
                          ✨ {aiResult.explanation || 'Filters applied.'}{' '}
                          {!aiResult.ai && <span className="text-slate-400">(offline mode)</span>}
                        </span>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Detected filters">
                        {[aiResult.quickFilter, ...(aiResult.workModes || []), ...(aiResult.accommodations || [])]
                          .filter(Boolean)
                          .filter((v) => v !== 'All Opportunities')
                          .slice(0, 6)
                          .map((chip) => (
                            <span key={chip} className="inline-flex items-center gap-1 rounded-full bg-lime-300/15 px-2.5 py-1 text-[11px] font-bold text-lime-200">
                              <span className="material-symbols-outlined text-[13px]" aria-hidden="true">verified</span>
                              {chip}
                            </span>
                          ))}
                        {aiResult.searchKeywords && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-200">
                            “{aiResult.searchKeywords}”
                          </span>
                        )}
                      </div>
                      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={(e) => goExplore(e, aiResult)}
                          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full bg-lime-300 px-5 py-2.5 text-[13px] font-extrabold text-lime-950 transition-transform hover:scale-[1.02]"
                        >
                          Show matching opportunities
                          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">arrow_forward</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => speakText(`${aiResult.explanation} Press Show matching opportunities to continue.`)}
                          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-white/20 px-4 py-2.5 text-[12px] font-bold text-white hover:bg-white/10"
                        >
                          <span className="material-symbols-outlined text-[16px]" aria-hidden="true">volume_up</span>
                          Hear this
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                  Voice tips: say <em className="text-slate-200">“find remote jobs”</em>, <em className="text-slate-200">“sign me up”</em>, <em className="text-slate-200">“post a job”</em> or <em className="text-slate-200">“read this page”</em> — Able navigates for you.
                </p>
              </div>

              <dl className="mt-5 grid max-w-xl grid-cols-3 gap-2 sm:mt-7 sm:gap-2.5">
                {[
                  ['5', 'Opportunity types'],
                  ['12', 'Access signals'],
                  ['3', 'Work modes'],
                ].map(([value, label]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 backdrop-blur sm:px-3.5 sm:py-2.5"
                  >
                    <dt className="order-2 mt-0.5 text-[11px] font-semibold text-slate-400">{label}</dt>
                    <dd className="text-[18px] font-extrabold leading-none text-white sm:text-[22px]">
                      {value}
                      <span className="text-lime-300">.</span>
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-2 sm:mt-5 sm:gap-2.5">
                <div className="flex -space-x-2" aria-hidden="true">
                  {['JK', 'AM', 'WN', 'OT'].map((initials, i) => (
                    <span
                      key={initials}
                      className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0A1330] text-[9px] font-extrabold sm:h-8 sm:w-8 sm:text-[10px] ${
                        ['bg-blue-600 text-white', 'bg-lime-300 text-lime-950', 'bg-violet-600 text-white', 'bg-slate-200 text-slate-900'][i]
                      }`}
                    >
                      {initials}
                    </span>
                  ))}
                </div>
                <p className="text-[11px] font-medium text-slate-300 sm:text-[12px]">
                  Trusted by employers, DPOs &amp; programs serving persons with disabilities
                </p>
              </div>
            </div>

            {/* Visual */}
            <div className="relative mt-2 lg:col-span-5 lg:mt-0" aria-hidden="true">
              <div className="relative mx-auto w-full max-w-[360px] pb-5">
                {/* glow */}
                <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-tr from-blue-600/25 via-transparent to-lime-300/15 blur-xl" />

                {/* main card */}
                <div className="relative rounded-2xl border border-white/15 bg-white/[0.08] p-4 shadow-xl backdrop-blur-2xl">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 text-[12px] font-extrabold text-white">
                        KI
                      </span>
                      <div className="min-w-0">
                        <p className="flex items-center gap-1 text-[12px] font-bold text-white">
                          <span className="truncate">Kenya Inclusive Tech Trust</span>
                          <span className="material-symbols-outlined shrink-0 text-[14px] text-blue-300">
                            verified
                          </span>
                        </p>
                        <p className="truncate text-[11px] font-medium text-slate-300">
                          Junior Frontend Developer • Remote
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-lime-300 px-2 py-1 text-[10px] font-extrabold text-lime-950">
                      Ksh 75,000/mo
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {ACCOMMODATION_PILLS.slice(0, 4).map((pill) => (
                      <span
                        key={pill.label}
                        className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-[10px] font-bold text-white"
                      >
                        <span className="material-symbols-outlined text-[12px] text-lime-300">
                          {pill.icon}
                        </span>
                        {pill.label}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 rounded-xl bg-slate-950/60 p-2.5 sm:p-3">
                    <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      <span className="material-symbols-outlined text-[13px] text-lime-300">
                        support_agent
                      </span>
                      Accessibility coordinator
                    </p>
                    <p className="mt-1 break-all text-[12px] font-semibold text-white">
                      Wanjiru M. • accommodations@org.or.ke
                    </p>
                    <p className="text-[11px] text-slate-400">Replies within 3 business days</p>
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <span className="flex-1 rounded-full bg-lime-300 py-2 text-center text-[12px] font-extrabold text-lime-950">
                      Apply now
                    </span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white">
                      <span className="material-symbols-outlined text-[16px]">bookmark</span>
                    </span>
                    <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white">
                      <span className="material-symbols-outlined text-[16px]">share</span>
                    </span>
                  </div>
                </div>

                {/* floating chips */}
                <div className="absolute -left-3 top-8 hidden rounded-xl border border-white/15 bg-[#0D1734]/95 px-3 py-2 shadow-lg backdrop-blur sm:block">
                  <p className="flex items-center gap-1.5 text-[11px] font-extrabold text-white">
                    <span className="material-symbols-outlined text-[15px] text-lime-300">
                      subtitles
                    </span>
                    CART + ASL included
                  </p>
                </div>
                <div className="absolute -right-2 bottom-14 hidden rounded-xl border border-white/15 bg-[#0D1734]/95 px-3 py-2 shadow-lg backdrop-blur sm:block">
                  <p className="flex items-center gap-1.5 text-[11px] font-extrabold text-white">
                    <span className="material-symbols-outlined text-[15px] text-blue-300">
                      home_work
                    </span>
                    100% Remote verified
                  </p>
                </div>

              </div>
            </div>
          </div>

          {/* marquee strip */}
          <div className="relative border-t border-white/10 bg-white/[0.03]">
            <div className="mx-auto flex w-full max-w-6xl items-center gap-1.5 overflow-x-auto px-4 py-2.5 sm:px-6 lg:px-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="mr-1 shrink-0 text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-400">
                Filter by what matters
              </span>
              {ACCOMMODATION_PILLS.concat(ACCOMMODATION_PILLS).map((pill, i) => (
                <span
                  key={`${pill.label}-${i}`}
                  aria-hidden={i >= ACCOMMODATION_PILLS.length}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-slate-200"
                >
                  <span className="material-symbols-outlined text-[14px] text-lime-300" aria-hidden="true">
                    {pill.icon}
                  </span>
                  {pill.label}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ============ WHY (light) ============ */}
        <section id="why" aria-labelledby="why-heading" className="bg-slate-50 py-8 text-slate-900 sm:py-12 lg:py-16">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
              <div className="lg:col-span-5">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-blue-700">
                  Why AccessAble exists
                </p>
                <h2
                  id="why-heading"
                  className="mt-2 text-balance text-[22px] font-extrabold leading-tight tracking-tight sm:text-[28px] lg:text-[32px]"
                >
                  Opportunities for persons with disabilities are scattered. Access details are missing.
                </h2>
                <p className="mt-3 text-[13px] leading-relaxed text-slate-600 sm:text-[14px]">
                  Great jobs, events, grants, trainings, public programs and aid meant
                  for you go unnoticed across fragmented boards and group chats. And
                  when they are found, the critical question —{' '}
                  <em className="font-semibold text-slate-900">
                    can I actually participate?
                  </em>{' '}
                  — is left unanswered.
                </p>
                <button
                  type="button"
                  onClick={goExplore}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-[13px] font-extrabold text-white transition-transform hover:scale-[1.02] sm:mt-5 sm:text-[13px]"
                >
                  Explore the catalogue
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                    arrow_forward
                  </span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:col-span-7">
                {[
                  {
                    icon: 'cloud_off',
                    title: 'Scattered & hard to find',
                    copy: 'PWD-targeted openings hide across job boards, corporate sites and community groups.',
                  },
                  {
                    icon: 'question_mark',
                    title: 'Access treated as afterthought',
                    copy: 'Physical access, interpreters and assistive-tech readiness are omitted or vague.',
                  },
                  {
                    icon: 'hourglass_empty',
                    title: 'Wasted applications',
                    copy: 'Candidates invest hours before discovering a venue, format or process excludes them.',
                  },
                  {
                    icon: 'handshake',
                    title: 'The AccessAble fix',
                    copy: 'One engine where every listing carries standardized, verified accommodation specs.',
                    highlight: true,
                  },
                ].map((card) => (
                  <article
                    key={card.title}
                    className={`rounded-2xl border p-4 sm:p-5 ${
                      card.highlight
                        ? 'border-slate-900 bg-slate-900 text-white shadow-xl'
                        : 'border-slate-200 bg-white shadow-sm'
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${
                        card.highlight ? 'bg-lime-300 text-lime-950' : 'bg-blue-50 text-blue-700'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[19px] sm:text-[20px]" aria-hidden="true">
                        {card.icon}
                      </span>
                    </span>
                    <h3 className="mt-2.5 text-[14px] font-extrabold tracking-tight sm:mt-3 sm:text-[15px]">{card.title}</h3>
                    <p
                      className={`mt-1 text-[12px] leading-relaxed sm:text-[13px] ${
                        card.highlight ? 'text-slate-300' : 'text-slate-600'
                      }`}
                    >
                      {card.copy}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            {/* features bento */}
            <div className="mt-6 grid grid-cols-1 gap-2.5 sm:mt-8 sm:gap-3 md:grid-cols-2 xl:grid-cols-4">
              {FEATURES.map((f) => (
                <article
                  key={f.title}
                  className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg sm:p-5"
                >
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-xl text-white sm:h-10 sm:w-10 ${f.accent}`}
                  >
                    <span className="material-symbols-outlined text-[19px] sm:text-[20px]" aria-hidden="true">
                      {f.icon}
                    </span>
                  </span>
                  <h3 className="mt-2.5 text-[14px] font-extrabold tracking-tight sm:mt-3 sm:text-[15px]">{f.title}</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-600 sm:text-[13px]">{f.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ============ HOW ============ */}
        <section id="how" aria-labelledby="how-heading" className="bg-white py-8 sm:py-12 lg:py-16">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-xl text-center">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-blue-700">
                How it works
              </p>
              <h2
                id="how-heading"
                className="mt-2 text-balance text-[22px] font-extrabold tracking-tight text-slate-900 sm:text-[28px] lg:text-[32px]"
              >
                From search to start date, built around your access needs
              </h2>
            </div>

            <ol className="mt-6 grid grid-cols-1 gap-2.5 sm:mt-8 sm:gap-3 md:grid-cols-3">
              {STEPS.map((step) => (
                <li
                  key={step.n}
                  className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"
                >
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute -right-1 -top-2 text-[48px] font-extrabold leading-none text-slate-900/[0.06] sm:text-[56px]"
                  >
                    {step.n}
                  </span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1d4ed8] text-white shadow-md shadow-blue-600/25 sm:h-10 sm:w-10">
                    <span className="material-symbols-outlined text-[19px] sm:text-[20px]" aria-hidden="true">
                      {step.icon}
                    </span>
                  </span>
                  <p className="mt-3 text-[11px] font-extrabold tracking-[0.16em] text-blue-700 sm:mt-4">
                    STEP {step.n}
                  </p>
                  <h3 className="mt-1 text-[15px] font-extrabold tracking-tight text-slate-900 sm:text-[16px]">
                    {step.title}
                  </h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-600 sm:text-[13px]">{step.copy}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ============ AI ACCESS MATCH (Gemini personalizer) ============ */}
        <section id="ai-match" aria-labelledby="ai-match-heading" className="bg-white py-8 sm:py-12 lg:py-16">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-lime-50 p-5 sm:rounded-3xl sm:p-6 lg:p-8">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
                <div className="lg:col-span-6">
                  <p className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-lime-300">
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">auto_awesome</span>
                    AI access match • Gemini
                  </p>
                  <h2 id="ai-match-heading" className="mt-3 text-balance text-[22px] font-extrabold tracking-tight text-slate-900 sm:text-[28px] lg:text-[30px]">
                    Tap your access needs. AI points to the right doors.
                  </h2>
                  <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-slate-600 sm:text-[14px]">
                    No typing needed. Choose how you access the world and how you want to work —
                    Able recommends the 2 catalogue doors most likely to fit, plus the access filters to use.
                    {liveCount > 0 ? ` Grounded in ${liveCount} live opportunities.` : ''}
                  </p>

                  <fieldset className="mt-4">
                    <legend className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-slate-500">
                      1. Your access needs (pick any)
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ACCESS_NEEDS.map((need) => {
                        const active = needs.includes(need.key);
                        return (
                          <button
                            key={need.key}
                            type="button"
                            onClick={() => toggleNeed(need.key)}
                            aria-pressed={active}
                            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-bold transition-all ${active ? 'border-slate-900 bg-slate-900 text-white shadow-md' : 'border-slate-300 bg-white text-slate-700 hover:border-slate-900'}`}
                          >
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{need.icon}</span>
                            {need.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <fieldset className="mt-4">
                    <legend className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-slate-500">
                      2. How do you want to work?
                    </legend>
                    <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Work mode preference">
                      {WORK_PREFS.map((pref) => {
                        const active = workPref === pref;
                        return (
                          <button
                            key={pref}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setWorkPref(active ? '' : pref)}
                            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-bold transition-all ${active ? 'border-blue-700 bg-[#1d4ed8] text-white shadow-md' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-700'}`}
                          >
                            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">
                              {pref === 'Remote Only' ? 'home_work' : pref === 'Hybrid' ? 'sync_alt' : 'location_on'}
                            </span>
                            {pref}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  <button
                    type="button"
                    onClick={handleProfileGenerate}
                    disabled={!needs.length || profileLoading}
                    className="mt-5 inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-lime-300 px-6 py-3 text-[14px] font-extrabold text-lime-950 shadow-lg transition-transform hover:scale-[1.02] disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[19px]" aria-hidden="true">psychology</span>
                    {profileLoading ? 'Able is matching…' : 'Match me with AI'}
                  </button>
                </div>

                <div className="lg:col-span-6">
                  <div aria-live="polite" className="h-full rounded-2xl bg-slate-900 p-5 text-white shadow-xl sm:p-6">
                    {!profileResult ? (
                      <div className="flex h-full min-h-[220px] flex-col items-start justify-center gap-2">
                        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10" aria-hidden="true">
                          <span className="material-symbols-outlined text-[22px] text-lime-300">smart_toy</span>
                        </span>
                        <p className="text-[15px] font-extrabold">Your AI recommendation appears here</p>
                        <p className="text-[13px] leading-relaxed text-slate-300">
                          Example: Blind + Remote Only → Jobs &amp; Internships and Training &amp; Fellowships
                          with Screen Reader Compatible filter. Works offline too.
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-[0.14em] text-lime-300">
                          <span className="material-symbols-outlined text-[15px]" aria-hidden="true">verified</span>
                          Your match {profileResult.ai ? '• Gemini AI' : '• offline mode'}
                        </p>
                        <ul className="mt-3 space-y-2">
                          {String(profileResult.text || '').split('\n').filter(Boolean).map((line, i) => (
                            <li key={i} className="rounded-xl bg-white/[0.07] px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-100">
                              <span className="font-extrabold text-lime-300">{line.split(':')[0]}: </span>
                              {line.split(':').slice(1).join(':').trim()}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                          <button
                            type="button"
                            onClick={handleProfileExplore}
                            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-full bg-lime-300 px-5 py-2.5 text-[13px] font-extrabold text-lime-950 transition-transform hover:scale-[1.02]"
                          >
                            Explore my matches
                            <span className="material-symbols-outlined text-[17px]" aria-hidden="true">arrow_forward</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => speakText(String(profileResult.text || '').replace(/DOORS:|FILTERS:|WHY:/g, ''))}
                            className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-full border border-white/25 px-4 py-2.5 text-[12px] font-bold text-white hover:bg-white/10"
                          >
                            <span className="material-symbols-outlined text-[16px]" aria-hidden="true">volume_up</span>
                            Hear it
                          </button>
                        </div>
                      </div>
                    )}
                    {profileLoading && (
                      <p className="mt-3 animate-pulse text-[12px] text-slate-300">Able is reading your access profile…</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ CATEGORIES ============ */}
        <section
          id="categories"
          aria-labelledby="categories-heading"
          className="bg-slate-50 py-8 text-slate-900 sm:py-12 lg:py-16"
        >
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-xl">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-blue-700">
                  More than jobs — one catalogue, five doors
                </p>
                <h2
                  id="categories-heading"
                  className="mt-2 text-balance text-[22px] font-extrabold tracking-tight sm:text-[28px] lg:text-[32px]"
                >
                  Jobs, events, funding, training and aid — all curated for persons with disabilities
                </h2>
              </div>
              <button
                type="button"
                onClick={goExplore}
                className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-slate-300 bg-white px-4 py-2 text-[12px] font-extrabold text-slate-900 shadow-sm transition-all hover:border-slate-900 sm:self-auto sm:text-[13px]"
              >
                Browse all
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                  arrow_forward
                </span>
              </button>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-2.5 sm:mt-6 sm:gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.title}
                  type="button"
                  onClick={goExplore}
                  className="group rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-600 hover:shadow-lg"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 text-white transition-colors group-hover:bg-[#1d4ed8] sm:h-10 sm:w-10">
                    <span className="material-symbols-outlined text-[19px] sm:text-[20px]" aria-hidden="true">
                      {cat.icon}
                    </span>
                  </span>
                  <span className="mt-2.5 block text-[14px] font-extrabold tracking-tight sm:mt-3 sm:text-[15px]">
                    {cat.title}
                  </span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-slate-600">
                    {cat.copy}
                  </span>
                  <span className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-extrabold text-blue-700 sm:mt-3">
                    Explore
                    <span
                      className="material-symbols-outlined text-[15px] transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    >
                      arrow_forward
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ============ ACCESSIBILITY (dark) ============ */}
        <section
          id="accessibility"
          aria-labelledby="a11y-heading"
          className="relative overflow-hidden bg-[#060B1F] py-8 sm:py-12 lg:py-16"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-24 top-0 h-64 w-64 rounded-full bg-blue-600/20 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 bottom-0 h-64 w-64 rounded-full bg-lime-300/10 blur-3xl"
          />
          <div className="relative mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-4 sm:px-6 lg:grid-cols-12 lg:gap-8 lg:px-8">
            <div className="lg:col-span-5">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-lime-300">
                Accessibility is the product
              </p>
              <h2
                id="a11y-heading"
                className="mt-2 text-balance text-[22px] font-extrabold tracking-tight text-white sm:text-[28px] lg:text-[32px]"
              >
                Designed with disabled users, not just for them
              </h2>
              <p className="mt-3 text-[13px] leading-relaxed text-slate-300 sm:text-[14px]">
                Semantic landmarks, visible focus, live announcements and strict contrast —
                architected toward WCAG 2.1 AA/AAA and ADA-aligned practice.
              </p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {['WCAG 2.2 AA', 'ADA-aligned', 'Keyboard-first', 'Screen-reader tested'].map(
                  (badge) => (
                    <span
                      key={badge}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-white"
                    >
                      <span className="material-symbols-outlined text-[14px] text-lime-300" aria-hidden="true">
                        check_circle
                      </span>
                      {badge}
                    </span>
                  )
                )}
              </div>
            </div>
            <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:col-span-7">
              {[
                {
                  icon: 'contrast',
                  title: 'High-contrast mode',
                  copy: 'One tap boosts contrast across the whole app — saved on your device.',
                },
                {
                  icon: 'format_letter_spacing',
                  title: 'Dyslexia-friendly type',
                  copy: 'Lexend-spaced letterforms plus larger text scaling on demand.',
                },
                {
                  icon: 'keyboard',
                  title: 'Full keyboard flow',
                  copy: 'Logical tab order, skip links, visible focus and no keyboard traps.',
                },
                {
                  icon: 'record_voice_over',
                  title: 'Screen-reader announcements',
                  copy: 'Live regions narrate results, filters, bookmarks and dialogs.',
                },
              ].map((item) => (
                <li
                  key={item.title}
                  className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur sm:p-5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-lime-300 text-lime-950">
                    <span className="material-symbols-outlined text-[19px]" aria-hidden="true">
                      {item.icon}
                    </span>
                  </span>
                  <h3 className="mt-2.5 text-[14px] font-extrabold text-white sm:mt-3 sm:text-[15px]">{item.title}</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-slate-300">{item.copy}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ============ EMPLOYERS ============ */}
        <section id="employers" aria-labelledby="employers-heading" className="bg-slate-50 py-8 sm:py-12 lg:py-16">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-2xl bg-lime-300 p-5 text-lime-950 sm:rounded-3xl sm:p-6 lg:p-8">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/40 blur-3xl"
              />
              <div className="relative grid grid-cols-1 items-center gap-6 lg:grid-cols-12 lg:gap-8">
                <div className="lg:col-span-7">
                  <p className="inline-flex items-center gap-1.5 rounded-full bg-lime-950 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-lime-300">
                    <span className="material-symbols-outlined text-[14px]" aria-hidden="true">
                      business
                    </span>
                    For employers &amp; organizers
                  </p>
                  <h2
                    id="employers-heading"
                    className="mt-3 text-balance text-[22px] font-extrabold leading-tight tracking-tight sm:text-[28px] lg:text-[32px]"
                  >
                    Post once. Prove you&apos;re truly inclusive.
                  </h2>
                  <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-lime-950/80 sm:text-[14px]">
                    A guided flow with mandatory accommodation disclosures, a named
                    coordinator and multimodal application options — screened for clarity
                    before publishing.
                  </p>
                  <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:mt-4 sm:grid-cols-2">
                    {[
                      'Takes ~3 minutes',
                      'Coordinator + notice period required',
                      'Video / voice-note applications welcome',
                      'True-Inclusion pledge on every post',
                    ].map((point) => (
                      <li key={point} className="flex items-start gap-1.5 text-[12px] font-bold sm:text-[13px]">
                        <span className="material-symbols-outlined text-[16px]" aria-hidden="true">
                          check_circle
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="lg:col-span-5">
                  <div className="rounded-2xl bg-lime-950 p-5 text-white shadow-xl">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-lime-300">
                      Start now
                    </p>
                    <p className="mt-1.5 text-[17px] font-extrabold leading-snug sm:text-[19px]">
                      Your next great hire is a person with a disability waiting for access.
                    </p>
                    <button
                      type="button"
                      onClick={goPost}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-lime-300 px-5 py-2.5 text-[13px] font-extrabold text-lime-950 transition-transform hover:scale-[1.02] sm:text-[14px]"
                    >
                      <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
                        post_add
                      </span>
                      Post an opportunity
                    </button>
                    <button
                      type="button"
                      onClick={goExplore}
                      className="mt-2 flex w-full items-center justify-center gap-2 rounded-full border border-white/25 px-5 py-2.5 text-[12px] font-bold text-white transition-colors hover:bg-white/10 sm:text-[13px]"
                    >
                      See live listings first
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ FINAL CTA ============ */}
        <section aria-labelledby="final-heading" className="bg-[#060B1F] pb-10 pt-2 sm:pb-14">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
            <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#12245e] via-[#1d4ed8] to-[#0A1330] p-5 text-center sm:rounded-3xl sm:p-6 lg:p-8">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.5) 1px, transparent 1px), radial-gradient(circle at 80% 60%, rgba(255,255,255,0.4) 1px, transparent 1px)',
                  backgroundSize: '36px 36px',
                }}
              />
              <div className="relative mx-auto max-w-xl">
                <h2
                  id="final-heading"
                  className="text-balance text-[22px] font-extrabold tracking-tight text-white sm:text-[28px] lg:text-[32px]"
                >
                  Stop guessing. Start belonging.
                </h2>
                <p className="mt-2 text-[13px] leading-relaxed text-blue-100 sm:text-[14px]">
                  Join the platform built exclusively for persons with disabilities —
                  where every job, event, grant, training and aid lists you as the
                  beneficiary, and accommodations are promised, published and kept.
                </p>
                <div className="mt-4 flex flex-col justify-center gap-2 sm:mt-5 lg:flex-row">
                  <button
                    type="button"
                    onClick={goSignUp}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-lime-300 px-5 py-2.5 text-[13px] font-extrabold text-lime-950 shadow-xl transition-transform hover:scale-[1.03] hover:bg-lime-200 sm:px-6 sm:py-3 sm:text-[14px]"
                  >
                    <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
                      person_add
                    </span>
                    Sign up
                  </button>
                  <button
                    type="button"
                    onClick={goExplore}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-[13px] font-extrabold text-slate-900 shadow-xl transition-transform hover:scale-[1.03] sm:px-6 sm:py-3 sm:text-[14px]"
                  >
                    <span className="material-symbols-outlined text-[17px]" aria-hidden="true">
                      explore
                    </span>
                    Explore opportunities
                  </button>
                  <button
                    type="button"
                    onClick={goPost}
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-white/30 px-5 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-white/10 sm:px-6 sm:py-3 sm:text-[14px]"
                  >
                    Post opportunity
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-[#04071A] py-6 text-slate-300 sm:py-8">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-4 sm:gap-8 sm:px-6 md:grid-cols-4 lg:px-8">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5">
              <LogoMark />
              <div className="leading-tight">
                <p className="text-[15px] font-extrabold text-white">AccessAble</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-lime-300">
                  Built for persons with disabilities
                </p>
              </div>
            </div>
            <p className="mt-3 max-w-md text-[12px] leading-relaxed text-slate-400 sm:text-[13px]">
              A discovery engine built exclusively for persons with disabilities —
              curating vetted jobs, events, grants, trainings, public programs and aid
              where you are the intended beneficiary — with accommodations confirmed upfront.
            </p>
            <p className="mt-3 text-[12px] text-slate-400">
              Report a barrier:{' '}
              <a
                href="mailto:accessibility@accessable.org"
                className="font-bold text-white underline underline-offset-2 hover:text-lime-300"
              >
                accessibility@accessable.org
              </a>
            </p>
          </div>
          <nav aria-label="Product">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
              Product
            </p>
            <ul className="mt-2.5 space-y-1.5 text-[13px] font-semibold">
              <li>
                <button type="button" onClick={goSignUp} className="font-extrabold text-lime-300 hover:text-white">
                  Sign up
                </button>
              </li>
              <li>
                <button type="button" onClick={goExplore} className="hover:text-white">
                  Browse opportunities
                </button>
              </li>
              <li>
                <button type="button" onClick={goPost} className="hover:text-white">
                  Post an opportunity
                </button>
              </li>
              <li>
                <a href="#categories" className="hover:text-white">
                  Categories
                </a>
              </li>
              <li>
                <a href="#how" className="hover:text-white">
                  How it works
                </a>
              </li>
            </ul>
          </nav>
          <nav aria-label="Commitments">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-slate-500">
              Commitments
            </p>
            <ul className="mt-2.5 space-y-1.5 text-[13px] font-semibold">
              <li>
                <a href="#accessibility" className="hover:text-white">
                  Accessibility statement
                </a>
              </li>
              <li>
                <a href="#why" className="hover:text-white">
                  True-Inclusion pledge
                </a>
              </li>
              <li>
                <a href="#employers" className="hover:text-white">
                  Employer guide
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="mx-auto mt-6 flex w-full max-w-6xl flex-col gap-2 border-t border-white/10 px-4 pt-4 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pt-5 lg:px-8">
          <p>© {new Date().getFullYear()} AccessAble. Distributed under the MIT License.</p>
          <p className="inline-flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-lime-300" aria-hidden="true">
              verified
            </span>
            WCAG 2.1 AA/AAA aligned • ADA-aware • Gemini AI-assisted
          </p>
        </div>
      </footer>

      {/* Ask Able — floating voice-first Gemini copilot, grounded in live catalogue */}
      <AIAssistant
        opportunities={opportunities}
        visibleCount={liveCount}
        visibleTitles={liveTitles}
        onApplySuggestion={handleAbleSuggestion}
      />
      {/* Polite live region so screen readers hear AI handoffs */}
      <div aria-live="polite" className="sr-only">
        {aiParsing ? 'Able is understanding your request.' : aiResult ? aiResult.explanation : ''}
      </div>
    </div>
  );
}

export default Landing;
