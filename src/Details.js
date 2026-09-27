/* eslint-disable jsx-a11y/anchor-is-valid -- href="#" anchors kept verbatim from Details.html for 1:1 UI fidelity */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SubmissionForm from './SubmissionForm';
import MobileBottomNav from './components/MobileBottomNav';
import AIAssistant from './components/AIAssistant';
import { subscribeOpportunities } from './services/opportunities';
import {
  askAboutOpportunity,
  explainMatch,
  parseNaturalLanguageQuery,
  planAccessibleApplication,
  summarizeOpportunity,
  translateEasyRead,
} from './services/gemini';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref as dbRef, remove as dbRemove, set as dbSet } from 'firebase/database';
import { auth, db } from './firebase';

/* ------------------------------------------------------------------
 * Details — React port of src/Details.html, now data-driven.
 *
 * - Left feed lists live opportunities from RTDB `/opportunities`.
 * - Right "opportunity details card" adapts to all 5 categories:
 *     Job (job) | Event (event) | Funding (grant) |
 *     Training (training) | Beneficiary Program (public + legacy aid)
 *   Field labels, icons, CTA text and info grids switch per category
 *   using CATEGORY_CONFIG below. Field mapping was derived from
 *   `accessablebyhex-default-rtdb-opportunities-export.json`:
 *     basic.title / basic.organization.{name,website,logo} /
 *     basic.category / logistics.{deliveryMode,venueAddress,
 *     applicationDeadline,startDate,compensation} /
 *     accessibility.{features,notes,coordinator} /
 *     details.{descriptionMarkdown,applicationUrl,multimodalSupport}.
 * - Clicking "View details" on any Home card navigates here via
 *   App.js (selected opportunity passed as `opportunity` /
 *   `opportunityId` props) and is rendered in the details card.
 * ------------------------------------------------------------------ */

const FIDELITY_STYLES = `
  @layer base {
    html, body {
      margin: 0;
      padding: 0;
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
    body {
      overscroll-behavior: none;
    }
  }
  ::-webkit-scrollbar {
    width: 6px;
    height: 6px;
  }
  ::-webkit-scrollbar-track {
    background: transparent;
  }
  ::-webkit-scrollbar-thumb {
    background: #cbd5e1;
    border-radius: 9999px;
  }
  ::-webkit-scrollbar-thumb:hover {
    background: #94a3b8;
  }
  .scrollbar-none {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-none::-webkit-scrollbar {
    display: none;
  }
  .shadow-soft { box-shadow: 0 8px 30px rgba(15, 23, 42, 0.05); }
  .shadow-float { box-shadow: 0 14px 40px rgba(29, 78, 216, 0.12); }
  .shadow-subtle { box-shadow: 0 2px 10px rgba(0, 0, 0, 0.03); }
  .shadow-xs { box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06); }
  .shadow-2xs { box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04); }
  .py-0\\.2 { padding-top: 0.05rem; padding-bottom: 0.05rem; }
  /* Mobile-only utilities ported from DetailsMobile.html tailwind.config */
  .shadow-card { box-shadow: 0 8px 24px -4px rgba(15, 23, 42, 0.06), 0 2px 6px -1px rgba(15, 23, 42, 0.04); }
  .shadow-float-blue { box-shadow: 0 12px 28px -4px rgba(29, 78, 216, 0.35); }
  .shadow-nav { box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.12), 0 4px 12px -2px rgba(0, 0, 0, 0.06); }
  .shadow-pill { box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04); }
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
`;

// Category catalogue. `grant` is displayed as "Funding" and both
// `public` (current rules) and `aid` (legacy export) are displayed as
// "Beneficiary Program".
const CATEGORY_CONFIG = {
  job: {
    label: 'Job',
    icon: 'work',
    cta: 'Apply Now',
    ctaNote: '',
    compensationLabel: 'Salary',
    compensationIcon: 'payments',
    deadlineLabel: 'Deadline',
    startLabel: 'Starts',
    typeLabel: 'Opportunity',
    typeIcon: 'business_center',
    venueLabel: 'Work location',
    detailsHeading: 'Job Details',
    emptyCta: 'Browse jobs',
  },
  event: {
    label: 'Event',
    icon: 'event',
    cta: 'Register Now',
    ctaNote: '⚡ Access needs shared with the event organizers on registration',
    compensationLabel: 'Entry fee',
    compensationIcon: 'confirmation_number',
    deadlineLabel: 'Deadline',
    startLabel: 'Starts',
    typeLabel: 'Format',
    typeIcon: 'event',
    venueLabel: 'Venue',
    detailsHeading: 'Event Details',
    emptyCta: 'Browse events',
  },
  grant: {
    label: 'Funding',
    icon: 'payments',
    cta: 'Apply for Funding',
    ctaNote: '⚡ Accessibility support included with your funding application',
    compensationLabel: 'Award amount',
    compensationIcon: 'payments',
    deadlineLabel: 'Deadline',
    startLabel: 'Starts',
    typeLabel: 'Funding',
    typeIcon: 'volunteer_activism',
    venueLabel: 'Location',
    detailsHeading: 'Funding Details',
    emptyCta: 'Browse funding',
  },
  training: {
    label: 'Training',
    icon: 'school',
    cta: 'Enroll Now',
    ctaNote: '⚡ Learning accommodations confirmed before the cohort starts',
    compensationLabel: 'Cost',
    compensationIcon: 'school',
    deadlineLabel: 'Deadline',
    startLabel: 'Starts',
    typeLabel: 'Training',
    typeIcon: 'school',
    venueLabel: 'Training venue',
    detailsHeading: 'Training Details',
    emptyCta: 'Browse trainings',
  },
  public: {
    label: 'Beneficiary Program',
    icon: 'campaign',
    cta: 'Request Support',
    ctaNote: '⚡ Support needs shared confidentially with the program team',
    compensationLabel: 'Benefit',
    compensationIcon: 'volunteer_activism',
    deadlineLabel: 'Deadline',
    startLabel: 'Starts',
    typeLabel: 'Program',
    typeIcon: 'campaign',
    venueLabel: 'Collection point',
    detailsHeading: 'Program Details',
    emptyCta: 'Browse programs',
  },
};

CATEGORY_CONFIG.aid = { ...CATEGORY_CONFIG.public };

// Sort options mirror Home.js so the related feed sorts identically.
const SORT_OPTIONS = ['Most Relevant', 'Newest', 'Highest Accommodation'];

const FEATURE_META = {
  mobility_restrooms: { label: 'Step-free Restrooms', icon: 'accessible' },
  mobility_stepfree: { label: 'Step-free Access', icon: 'accessible' },
  mobility_parking: { label: 'Accessible Parking', icon: 'local_parking' },
  sli_support: { label: 'KSL / ASL Support', icon: 'sign_language' },
  cart_captions: { label: 'CART Captions', icon: 'subtitles' },
  hearing_loop: { label: 'Hearing Loop', icon: 'hearing' },
  screen_reader_docs: { label: 'Screen Reader Verified', icon: 'visibility' },
  braille_materials: { label: 'Braille Materials', icon: 'touch_app' },
  audio_descriptions: { label: 'Audio Descriptions', icon: 'audiotrack' },
  quiet_room: { label: 'Quiet Room', icon: 'volume_off' },
  pre_agenda: { label: 'Agenda in Advance', icon: 'event_note' },
  camera_optional: { label: 'Camera Optional', icon: 'videocam_off' },
};
const FEATURE_ORDER = Object.keys(FEATURE_META);

const AVATAR_STYLES = [
  'bg-blue-50 text-blue-700 border border-blue-100',
  'bg-lime-100 text-lime-900',
  'bg-indigo-50 text-indigo-700',
  'bg-amber-50 text-amber-800',
  'bg-teal-50 text-teal-800',
  'bg-lime-200 text-lime-900',
];

const SAVED_RTDB_PATH = 'saved';

/* ------------------------------------------------------------------
 * PWD-first AI helpers (Gemini + on-device speech).
 * - speakText / stopSpeaking: Web Speech API so blind, low-vision and
 *   low-literacy users can listen to any AI output.
 * - OpportunityAiPanel: one reusable Gemini copilot rendered inside BOTH
 *   the desktop and mobile detail cards (same state, same access).
 *   Gemini APIs used (see services/gemini.js):
 *     1. summarizeOpportunity  -> Easy-Read summary (cognitive / SR users)
 *     2. translateEasyRead     -> English <-> Kiswahili toggle
 *     3. explainMatch          -> "Does it fit my access need?"
 *     4. planAccessibleApplication -> step-by-step apply plan + message draft
 *     5. askAboutOpportunity   -> scoped Q&A ("Is the venue step-free?")
 *     6. parseNaturalLanguageQuery -> AI smart search over related feed
 *     7. chatWithAble (floating Ask Able) -> whole-catalogue voice guide
 * ------------------------------------------------------------------ */

function speakText(text) {
  try {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    const clean = String(text || '')
      .replace(/^STEPS:\s*/i, 'Steps. ')
      .replace(/^ASK:\s*/gim, 'Ask. ')
      .replace(/^MESSAGE:\s*/gim, 'Message draft. ')
      .replace(/^>\s*/gm, '')
      .slice(0, 1400);
    if (!clean.trim()) return false;
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(clean));
    return true;
  } catch (e) {
    return false;
  }
}

function stopSpeaking() {
  try {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  } catch (e) { /* noop */ }
}

function renderAiLines(text) {
  return String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      if (/^steps:?$/i.test(line)) {
        return <p key={i} className="text-xs font-extrabold text-slate-900 uppercase tracking-wide mt-1">Steps</p>;
      }
      if (/^ask:?$/i.test(line)) {
        return <p key={i} className="text-xs font-extrabold text-slate-900 uppercase tracking-wide mt-1">Ask the coordinator</p>;
      }
      if (/^message:?$/i.test(line)) {
        return <p key={i} className="text-xs font-extrabold text-slate-900 uppercase tracking-wide mt-1">Message draft</p>;
      }
      if (/^\d+[.)]\s+/.test(line)) {
        return <p key={i} className="text-xs leading-relaxed text-slate-700 flex gap-1.5"><span className="font-extrabold text-blue-700 shrink-0">{line.match(/^\d+/)[0]}.</span><span>{line.replace(/^\d+[.)]\s+/, '')}</span></p>;
      }
      if (/^[-•]\s+/.test(line) || line.startsWith('>')) {
        return <p key={i} className="text-xs leading-relaxed text-slate-700 flex gap-1.5"><span aria-hidden="true" className="text-blue-600 font-bold">•</span><span>{line.replace(/^[-•>]\s*/, '')}</span></p>;
      }
      return <p key={i} className="text-xs leading-relaxed text-slate-700">{line.replace(/^-\s*/, '')}</p>;
    });
}

/**
 * OpportunityAiPanel — Gemini copilot for ONE listing.
 * Compact variant is used on the mobile card; same props/state both shells.
 */
function OpportunityAiPanel({
  compact = false,
  aiSummary, aiSummaryLoading, aiSummaryIsAi, aiSummaryLang,
  onSimplify, onToggleLang, onListenSummary,
  userNeed, setUserNeed,
  fitText, fitLoading, fitIsAi, onCheckFit, onListenFit,
  stepsText, stepsLoading, stepsIsAi, onPlanSteps, onListenSteps,
  qaHistory, qaInput, setQaInput, qaLoading, onAsk, onListenQa,
  onCopy,
}) {
  const pad = compact ? 'p-3' : 'p-4';
  const titleSize = compact ? 'text-[12px]' : 'text-sm';
  return (
    <section aria-label="AI access guide for this opportunity" className={`rounded-2xl border border-blue-200/70 bg-gradient-to-b from-blue-50/70 to-white ${pad} flex flex-col gap-3`}>
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-[#1d4ed8] text-white flex items-center justify-center shrink-0" aria-hidden="true">
          <span className="material-symbols-outlined text-[16px]">smart_toy</span>
        </span>
        <div className="min-w-0">
          <h3 className={`${titleSize} font-extrabold text-slate-900 leading-tight`}>Able AI guide <span className="font-semibold text-slate-500">· for this opportunity</span></h3>
          <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-500 leading-snug`}>Easy-Read · Kiswahili · voice · fit check · apply steps</p>
        </div>
      </div>

      {/* 1+2) Easy-Read summary with EN/SW + listen */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className={`${compact ? 'text-[11px]' : 'text-xs'} font-bold text-slate-900 flex items-center gap-1.5`}>
            <span className="material-symbols-outlined text-[16px] text-blue-600" aria-hidden="true">auto_awesome</span>
            Easy-Read summary
            <span className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-semibold text-slate-400`}>{aiSummaryIsAi ? '· Gemini AI' : aiSummary ? '· offline' : ''}{aiSummaryLang === 'Kiswahili' ? ' · Kiswahili' : ''}</span>
          </p>
          {aiSummary && (
            <button type="button" onClick={onToggleLang} className="shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full bg-slate-100 hover:bg-blue-100 hover:text-blue-700 text-slate-600 transition-colors" aria-label={aiSummaryLang === 'Kiswahili' ? 'Show summary in English' : 'Show summary in Kiswahili'}>
              {aiSummaryLang === 'Kiswahili' ? 'EN' : 'SW'} ⇄
            </button>
          )}
        </div>
        <div aria-live="polite" className="flex flex-col gap-1 min-h-[20px]">
          {!aiSummary && !aiSummaryLoading && (
            <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-500`}>Tap Simplify — Gemini rewrites this listing in short, plain sentences.</p>
          )}
          {aiSummaryLoading && <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-slate-500 animate-pulse`}>Simplifying with Gemini…</p>}
          {aiSummary && !aiSummaryLoading && renderAiLines(aiSummary)}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onSimplify} disabled={aiSummaryLoading} className="inline-flex items-center gap-1 text-[11px] font-bold bg-[#1d4ed8] hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-full transition-colors min-h-[32px]">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">auto_awesome</span>
            {aiSummaryLoading ? 'Simplifying…' : aiSummary ? 'Re-simplify' : 'Simplify ✨'}
          </button>
          {aiSummary && (
            <button type="button" onClick={onListenSummary} className="inline-flex items-center gap-1 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-full transition-colors min-h-[32px]">
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">volume_up</span> Listen
            </button>
          )}
        </div>
      </div>

      {/* 3) "Does it fit me?" — explainMatch grounded in verified accommodations */}
      <div className="rounded-xl border border-lime-200/80 bg-lime-50/50 p-3 flex flex-col gap-2">
        <p className={`${compact ? 'text-[11px]' : 'text-xs'} font-bold text-slate-900 flex items-center gap-1.5`}>
          <span className="material-symbols-outlined text-[16px] text-lime-700" aria-hidden="true">verified</span>
          Does it fit my access need?
        </p>
        <label htmlFor={compact ? 'ai-need-mobile' : 'ai-need-desktop'} className="sr-only">Describe your access need</label>
        <input
          id={compact ? 'ai-need-mobile' : 'ai-need-desktop'}
          value={userNeed}
          onChange={(e) => setUserNeed(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onCheckFit(); } }}
          placeholder='E.g. "I use a screen reader" or "I need step-free + quiet room"'
          className="w-full rounded-full bg-white border border-slate-200 px-3.5 py-2 text-[12px] text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-lime-500"
        />
        <div aria-live="polite" className="flex flex-col gap-1 min-h-[20px]">
          {!fitText && !fitLoading && <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-500`}>Gemini checks your need against the verified accommodations only — never invents.</p>}
          {fitLoading && <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-slate-500 animate-pulse`}>Checking fit with Gemini…</p>}
          {fitText && !fitLoading && renderAiLines(fitText)}
          {fitText && !fitLoading && <p className="text-[10px] text-slate-400 font-medium">{fitIsAi ? '· Gemini AI' : '· offline check'}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onCheckFit} disabled={fitLoading} className="inline-flex items-center gap-1 text-[11px] font-bold bg-lime-600 hover:bg-lime-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-full transition-colors min-h-[32px]">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">accessibility_new</span>
            {fitLoading ? 'Checking…' : 'Check my fit ✨'}
          </button>
          {fitText && (
            <button type="button" onClick={onListenFit} className="inline-flex items-center gap-1 text-[11px] font-bold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-full transition-colors min-h-[32px]">
              <span className="material-symbols-outlined text-[14px]" aria-hidden="true">volume_up</span> Listen
            </button>
          )}
        </div>
      </div>

      {/* 4) Accessible application plan */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3 flex flex-col gap-2">
        <p className={`${compact ? 'text-[11px]' : 'text-xs'} font-bold text-slate-900 flex items-center gap-1.5`}>
          <span className="material-symbols-outlined text-[16px] text-blue-600" aria-hidden="true">checklist</span>
          Apply with confidence — my steps
        </p>
        <div aria-live="polite" className="flex flex-col gap-1 min-h-[20px]">
          {!stepsText && !stepsLoading && <p className={`${compact ? 'text-[10px]' : 'text-[11px]'} text-slate-500`}>Gemini builds numbered steps + a message you can copy to the coordinator.</p>}
          {stepsLoading && <p className={`${compact ? 'text-[11px]' : 'text-xs'} text-slate-500 animate-pulse`}>Planning your application…</p>}
          {stepsText && !stepsLoading && renderAiLines(stepsText)}
          {stepsText && !stepsLoading && <p className="text-[10px] text-slate-400 font-medium">{stepsIsAi ? '· Gemini AI' : '· offline plan'}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={onPlanSteps} disabled={stepsLoading} className="inline-flex items-center gap-1 text-[11px] font-bold bg-slate-900 hover:bg-slate-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-full transition-colors min-h-[32px]">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">route</span>
            {stepsLoading ? 'Planning…' : stepsText ? 'Re-plan' : 'Make my plan ✨'}
          </button>
          {stepsText && (
            <>
              <button type="button" onClick={onListenSteps} className="inline-flex items-center gap-1 text-[11px] font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-full transition-colors min-h-[32px]">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">volume_up</span> Listen
              </button>
              <button type="button" onClick={() => onCopy && onCopy(stepsText, 'Application plan copied. Paste it into your notes or message.')} className="inline-flex items-center gap-1 text-[11px] font-bold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-full transition-colors min-h-[32px]">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">content_copy</span> Copy
              </button>
            </>
          )}
        </div>
      </div>

      {/* 5) Scoped Q&A — ask about THIS listing */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-3 flex flex-col gap-2">
        <p className={`${compact ? 'text-[11px]' : 'text-xs'} font-bold text-slate-900 flex items-center gap-1.5`}>
          <span className="material-symbols-outlined text-[16px] text-blue-600" aria-hidden="true">chat</span>
          Ask about this opportunity
        </p>
        {qaHistory.length > 0 && (
          <div aria-live="polite" className="flex flex-col gap-1.5 max-h-44 overflow-y-auto pr-0.5">
            {qaHistory.slice(-4).map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <p className={m.role === 'user'
                  ? 'max-w-[90%] rounded-2xl rounded-br-md bg-[#1d4ed8] px-3 py-2 text-[11px] leading-relaxed text-white'
                  : 'max-w-[95%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-[11px] leading-relaxed text-slate-800'}>
                  {m.text}
                </p>
              </div>
            ))}
            {qaLoading && <p className="text-[11px] text-slate-500 animate-pulse">Able is thinking…</p>}
          </div>
        )}
        <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onAsk(); }}>
          <label htmlFor={compact ? 'ai-qa-mobile' : 'ai-qa-desktop'} className="sr-only">Ask a question about this opportunity</label>
          <input
            id={compact ? 'ai-qa-mobile' : 'ai-qa-desktop'}
            value={qaInput}
            onChange={(e) => setQaInput(e.target.value)}
            placeholder='Try: "Is the venue step-free?"'
            autoComplete="off"
            className="min-w-0 flex-1 rounded-full bg-slate-100 px-3.5 py-2 text-[12px] text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button type="submit" disabled={qaLoading || !qaInput.trim()} aria-label="Ask Able" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1d4ed8] text-white hover:bg-blue-700 transition-colors disabled:opacity-40">
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">send</span>
          </button>
          {qaHistory.length > 0 && qaHistory[qaHistory.length - 1]?.role === 'able' && (
            <button type="button" onClick={onListenQa} aria-label="Listen to last answer" title="Listen to last answer" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">volume_up</span>
            </button>
          )}
        </form>
        <div className="flex flex-wrap gap-1.5">
          {['Is it step-free?', 'How do I apply?', 'What is the deadline?'].map((s) => (
            <button key={s} type="button" onClick={() => { setQaInput(s); }} className="rounded-full bg-slate-100 hover:bg-blue-100 hover:text-blue-700 px-2.5 py-1 text-[10px] font-semibold text-slate-600 transition-colors">
              {s}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function ToastStack({ toasts, onDismiss }) {
  const toneStyles = {
    success: 'bg-secondary-container text-on-secondary-fixed',
    error: 'bg-error-container text-on-error-container',
    info: 'bg-primary-fixed text-on-primary-fixed',
  };
  const toneIcons = { success: 'check_circle', error: 'error', info: 'info' };
  return (
    <div aria-live="polite" className="fixed bottom-4 right-4 z-[110] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`flex items-start gap-2.5 rounded-2xl px-4 py-3 shadow-xl ${toneStyles[toast.tone] || toneStyles.info}`}
        >
          <span className="material-symbols-outlined text-[20px] shrink-0" aria-hidden="true">
            {toneIcons[toast.tone] || toneIcons.info}
          </span>
          <p className="flex-1 font-body-sm text-body-sm font-medium">{toast.message}</p>
          <button
            aria-label="Dismiss notification"
            className="rounded-full p-1 hover:bg-black/10 transition-colors shrink-0"
            onClick={() => onDismiss(toast.id)}
            type="button"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">close</span>
          </button>
        </div>
      ))}
    </div>
  );
}

function getCategoryConfig(category) {
  if (category && CATEGORY_CONFIG[category]) return CATEGORY_CONFIG[category];
  return CATEGORY_CONFIG.job;
}

function getInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'OP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getTimestamp(opportunity) {
  const created = Number(opportunity?.meta?.createdAt);
  if (Number.isFinite(created) && created > 0) return created;
  const submitted = Date.parse(opportunity?.meta?.submittedAt || '');
  return Number.isFinite(submitted) ? submitted : 0;
}

function formatPostedAgo(opportunity) {
  const ts = getTimestamp(opportunity);
  if (!ts) return 'Recently posted';
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return 'Just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `Posted ${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Posted ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Posted yesterday';
  if (days < 7) return `Posted ${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `Posted ${weeks} week${weeks === 1 ? '' : 's'} ago`;
  const date = new Date(ts);
  return `Posted ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function formatReadableDate(isoDate) {
  if (!isoDate) return null;
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDeliveryLabel(deliveryMode) {
  if (deliveryMode === 'remote') return '100% Remote';
  if (deliveryMode === 'hybrid') return 'Hybrid';
  if (deliveryMode === 'onsite') return 'On-site';
  return deliveryMode ? String(deliveryMode) : 'Location TBD';
}

function formatLocation(opportunity) {
  const mode = opportunity?.logistics?.deliveryMode;
  const venue = String(opportunity?.logistics?.venueAddress || '').trim();
  if (mode === 'remote') return '100% Remote';
  if (mode === 'hybrid') return venue ? `Hybrid • ${venue.length > 42 ? `${venue.slice(0, 41).trimEnd()}…` : venue}` : 'Hybrid';
  if (mode === 'onsite') return venue ? (venue.length > 48 ? `${venue.slice(0, 47).trimEnd()}…` : venue) : 'On-site';
  return venue ? (venue.length > 48 ? `${venue.slice(0, 47).trimEnd()}…` : venue) : 'Location TBD';
}

function getAccommodationPills(opportunity) {
  const features = opportunity?.accessibility?.features || {};
  return FEATURE_ORDER.filter((key) => features[key] === true).map((key) => ({
    key,
    ...FEATURE_META[key],
  }));
}

function countAccommodations(opportunity) {
  const features = opportunity?.accessibility?.features || {};
  return FEATURE_ORDER.reduce((n, key) => n + (features[key] === true ? 1 : 0), 0);
}

// Numeric value for "Salary (High to Low)" sorting — mirrors Home.js.
// "Free" -> 0, missing/unparseable -> -1 so it sorts last.
function parseCompensationValue(compensation) {
  const text = String(compensation || '').trim().toLowerCase();
  if (!text) return -1;
  if (text === 'free') return 0;
  const matches = text.replace(/,/g, '').match(/\d+(\.\d+)?/g);
  if (!matches) return -1;
  return Math.max(...matches.map(Number));
}

function buildTagHaystack(opportunity) {
  const features = opportunity?.accessibility?.features || {};
  const parts = [
    opportunity?.basic?.title,
    opportunity?.basic?.organization?.name,
    opportunity?.basic?.category,
    opportunity?.logistics?.deliveryMode,
    opportunity?.logistics?.venueAddress,
    opportunity?.logistics?.compensation,
    Object.entries(features)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => `${key.replace(/_/g, ' ')} ${FEATURE_META[key]?.label || ''}`)
      .join(' '),
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function renderDescriptionBlocks(markdown) {
  const lines = String(markdown || '').split('\n');
  const blocks = [];
  let list = [];
  const flushList = () => {
    if (list.length) {
      blocks.push({ type: 'list', items: list });
      list = [];
    }
  };
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) {
      flushList();
      blocks.push({ type: 'heading', text: trimmed.replace(/^#{1,6}\s+/, '') });
    } else if (/^[-*+]\s+/.test(trimmed)) {
      list.push(trimmed.replace(/^[-*+]\s+/, ''));
    } else if (/^\d+\.\s+/.test(trimmed)) {
      list.push(trimmed.replace(/^\d+\.\s+/, ''));
    } else if (trimmed === '') {
      flushList();
    } else {
      flushList();
      blocks.push({ type: 'para', text: trimmed });
    }
  });
  flushList();
  return blocks.length ? blocks : [{ type: 'para', text: 'No description provided.' }];
}

function matchesCategoryPill(opportunity, pillValue) {
  if (pillValue === 'all') return true;
  if (pillValue === 'public') {
    return opportunity?.basic?.category === 'public' || opportunity?.basic?.category === 'aid';
  }
  return opportunity?.basic?.category === pillValue;
}

function Details({
  opportunity: initialOpportunity,
  opportunityId: initialOpportunityId,
  onBack,
  onPostOpportunity,
  onSelectOpportunity,
  onBrowse,
  onSaved,
  onEditProfile,
}) {
  const [activeChip, setActiveChip] = useState(null);
  const [activeCategory] = useState('all');
  const [activeTab, setActiveTab] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState(SORT_OPTIONS[0]);
  const [mobileSortOpen, setMobileSortOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [opportunities, setOpportunities] = useState(
    initialOpportunity ? [initialOpportunity] : []
  );
  const [isLoading, setIsLoading] = useState(!initialOpportunity);
  const [loadError, setLoadError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  const [selectedId, setSelectedId] = useState(
    initialOpportunityId || initialOpportunity?.id || null
  );
  const [bookmarked, setBookmarked] = useState([]);
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);
  // --- Gemini PWD-first AI state (Details copilot) ---
  const [aiParsing, setAiParsing] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [aiListening, setAiListening] = useState(false);
  const [aiSummary, setAiSummary] = useState('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryIsAi, setAiSummaryIsAi] = useState(true);
  const [aiSummaryLang, setAiSummaryLang] = useState('English');
  const [aiSummaryEn, setAiSummaryEn] = useState('');
  const [userNeed, setUserNeed] = useState('');
  const [fitText, setFitText] = useState('');
  const [fitLoading, setFitLoading] = useState(false);
  const [fitIsAi, setFitIsAi] = useState(true);
  const [stepsText, setStepsText] = useState('');
  const [stepsLoading, setStepsLoading] = useState(false);
  const [stepsIsAi, setStepsIsAi] = useState(true);
  const [qaHistory, setQaHistory] = useState([]);
  const [qaInput, setQaInput] = useState('');
  const [qaLoading, setQaLoading] = useState(false);
  const recogRef = useRef(null);

  // Keep selection in sync when App navigates with a newly clicked card.
  useEffect(() => {
    const nextId = initialOpportunityId || initialOpportunity?.id || null;
    if (nextId) setSelectedId(nextId);
    if (initialOpportunity && initialOpportunity.id) {
      setOpportunities((prev) => {
        if (prev.some((item) => item.id === initialOpportunity.id)) {
          return prev.map((item) => (item.id === initialOpportunity.id ? initialOpportunity : item));
        }
        return [initialOpportunity, ...prev];
      });
      setIsLoading(false);
    }
  }, [initialOpportunity, initialOpportunityId]);

  // Live list powers the left feed + resolves the selected id.
  useEffect(() => {
    setIsLoading((prev) => (opportunities.length > 0 ? prev : true));
    setLoadError(null);
    const unsubscribe = subscribeOpportunities(
      (items) => {
        setOpportunities((prev) => {
          // Preserve a navigated-in opportunity even if RTDB read is empty.
          if (items.length === 0 && initialOpportunity) return prev.length ? prev : [initialOpportunity];
          return items;
        });
        setIsLoading(false);
      },
      (error) => {
        console.error('Failed to load opportunities in Details:', error);
        if (!initialOpportunity) {
          setLoadError(error);
          setIsLoading(false);
        } else {
          setIsLoading(false);
        }
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryTick]);

  // Google signed-in user — drives the header avatar next to Post button.
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => setCurrentUser(user || null));
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const pushToast = useCallback((message, tone = 'success') => {
    const id = `toast-${Date.now()}-${toastIdRef.current++}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, tone }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 4500);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const currentUid = currentUser?.uid || null;
  const savedPath = currentUid ? `${SAVED_RTDB_PATH}/${currentUid}` : null;

  // Saved bookmarks live in Firebase RTDB scoped to the signed-in user:
  // `/saved/{uid}/{opportunityId}: true` — same logic as Home.js.
  useEffect(() => {
    if (!savedPath) {
      setBookmarked([]);
      return undefined;
    }
    const savedRef = dbRef(db, savedPath);
    const unsubscribe = onValue(
      savedRef,
      (snapshot) => {
        const value = snapshot.exists() ? snapshot.val() : null;
        if (!value || typeof value !== 'object') {
          setBookmarked([]);
          return;
        }
        const ids = Object.entries(value)
          .filter(([, v]) => v === true || typeof v === 'string' || (v && typeof v === 'object'))
          .map(([key, v]) => (typeof v === 'string' && v ? v : key))
          .filter((id) => typeof id === 'string' && id.length > 0);
        setBookmarked(ids);
      },
      (error) => {
        console.error('Failed to load saved bookmarks:', error);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [savedPath]);

  // Reset tab + read-more + related tag whenever a different card is selected.
  useEffect(() => {
    setActiveTab('overview');
    setExpanded(false);
    setActiveChip(null);
  }, [selectedId]);

  // Reset per-listing AI outputs so Able never shows a stale answer on a new card.
  // The user's own access need is kept (it is their profile, not the listing).
  useEffect(() => {
    stopSpeaking();
    setAiSummary('');
    setAiSummaryEn('');
    setAiSummaryLang('English');
    setFitText('');
    setStepsText('');
    setQaHistory([]);
    setQaInput('');
    setAiNote('');
  }, [selectedId]);

  useEffect(() => () => {
    stopSpeaking();
    try { recogRef.current?.stop(); } catch (e) { /* noop */ }
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeCategory, activeChip, sortBy, opportunities.length]);

  // Mobile sort dropdown: close on outside click / Escape (mirrors Home.js).
  useEffect(() => {
    if (!mobileSortOpen) return undefined;
    const onPointerDown = (e) => {
      if (e.target.closest('[data-mobile-sort-root]')) return;
      setMobileSortOpen(false);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') setMobileSortOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [mobileSortOpen]);

  const selected =
    opportunities.find((item) => item.id === selectedId) ||
    (initialOpportunity && (initialOpportunity.id === selectedId || !selectedId) ? initialOpportunity : null) ||
    opportunities[0] ||
    null;

  const selectedConfig = getCategoryConfig(selected?.basic?.category);

  const profilePhoto =
    currentUser?.photoURL ||
    'https://lh3.googleusercontent.com/aida-public/AB6AXuD0E56Ep7QQ2RWEOr7wwZZFbbCebGpKXC7Ch0UasYNbRkQYe3LuQFvyB2FFrLinDcsrvpS-zRTTguJ44PBRsX3BAZNWMqHdNx6Ke9sTQmZzkxVVS7MGU5VoDmjSJIEY8_-wp9GpnAJKPYN_xji0CJ5S_Ed5iCnIckMYrUzWvkVXW6AWAdeH1hhiMx-VEi21Ygb1j-yrDJ55taKxFTTLDdoHtw01DCC7xA31A-jeFAH8d4WAtcF9boi41e7SnW7pNvxKJ2I';
  const profileName = currentUser?.displayName || 'My AccessAble';

  // Tags related to the opportunity currently being viewed — replaces the
  // previous generic hardcoded chips. Derived from the selected card:
  // category + delivery mode + confirmed accommodation labels.
  const relatedTags = useMemo(() => {
    if (!selected) return [];
    const tags = [];
    if (selectedConfig?.label) tags.push(selectedConfig.label);
    const delivery = formatDeliveryLabel(selected?.logistics?.deliveryMode);
    if (delivery) tags.push(delivery);
    const pills = getAccommodationPills(selected);
    pills.slice(0, 4).forEach((pill) => {
      if (pill?.label) tags.push(pill.label);
    });
    // Deduplicate (case-insensitive) while preserving order.
    const seen = new Set();
    return tags.filter((tag) => {
      const key = String(tag).trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }, [selected, selectedConfig]);

  const filteredFeed = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const chipQuery = String(activeChip || '').trim().toLowerCase();
    const chipTokens = chipQuery.split(/[^a-z0-9]+/).filter((t) => t.length > 2);
    const matchesChip = (haystack) => {
      if (!chipQuery) return true;
      if (haystack.includes(chipQuery)) return true;
      // Delivery labels are formatted ("100% Remote") while stored values are
      // raw ("remote") — match on significant tokens so related tags filter.
      return chipTokens.some((token) => haystack.includes(token));
    };
    const filtered = opportunities.filter((opp) => {
      if (!matchesCategoryPill(opp, activeCategory)) return false;
      const haystack = buildTagHaystack(opp);
      if (query && !haystack.includes(query)) return false;
      if (!matchesChip(haystack)) return false;
      return true;
    });
    // Same sort logic + options as Home.js.
    const sorted = [...filtered];
    const normalizedSort = String(sortBy || '').trim();
    if (normalizedSort === 'Newest') {
      sorted.sort((a, b) => getTimestamp(b) - getTimestamp(a));
    } else if (normalizedSort === 'Highest Accommodation Match' || normalizedSort === 'Highest Accommodation') {
      sorted.sort((a, b) => countAccommodations(b) - countAccommodations(a) || getTimestamp(b) - getTimestamp(a));
    }
    return sorted;
  }, [opportunities, searchQuery, activeCategory, activeChip, sortBy]);

  const PAGE_SIZE = 5;
  const totalPages = Math.max(1, Math.ceil(filteredFeed.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const pagedFeed = filteredFeed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handlePostOpportunity = (event) => {
    if (event) event.preventDefault();
    if (typeof onPostOpportunity === 'function') {
      onPostOpportunity();
    } else {
      setShowSubmissionForm(true);
    }
  };

  const handleBack = (event) => {
    if (event) event.preventDefault();
    if (typeof onBack === 'function') {
      onBack();
    } else if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back();
    }
  };

  const handleSelect = (opp) => {
    if (!opp) return;
    setSelectedId(opp.id);
    if (typeof onSelectOpportunity === 'function') onSelectOpportunity(opp);
    if (typeof document !== 'undefined') {
      // Prefer the card visible at the current breakpoint (mobile card below lg,
      // desktop card at lg+). Both share the same state/selection logic.
      const isMobileViewport = typeof window !== 'undefined' && window.innerWidth < 1024;
      const mobileCard = document.getElementById('opportunity-detail-card-mobile');
      const desktopCard = document.getElementById('opportunity-detail-card');
      const target = isMobileViewport && mobileCard ? mobileCard : desktopCard || mobileCard;
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const toggleBookmark = useCallback(
    async (id) => {
      if (!id) return;
      const saved = bookmarked.includes(id);
      if (!currentUid || !savedPath) {
        setBookmarked((prev) => (saved ? prev.filter((v) => v !== id) : [...prev, id]));
        pushToast(
          saved ? 'Removed from saved bookmarks.' : 'Saved locally. Sign in with Google to sync across devices.',
          saved ? 'info' : 'success'
        );
        return;
      }
      try {
        if (saved) {
          await dbRemove(dbRef(db, `${savedPath}/${id}`));
          pushToast('Removed from saved bookmarks.', 'info');
        } else {
          await dbSet(dbRef(db, `${savedPath}/${id}`), true);
          pushToast('Saved to bookmarks.');
        }
      } catch (error) {
        console.error('Failed to update saved bookmark:', error);
        pushToast('Could not update saved bookmarks. Check your connection and try again.', 'error');
      }
    },
    [bookmarked, currentUid, savedPath, pushToast]
  );

  const selectedPills = selected ? getAccommodationPills(selected) : [];
  const selectedNotes = selected?.accessibility?.notes || {};
  const selectedCoordinator = selected?.accessibility?.coordinator || {};
  const selectedOrg = selected?.basic?.organization || {};
  const selectedTitle = selected?.basic?.title || 'Untitled opportunity';
  const selectedOrgName = selectedOrg?.name || 'Inclusive Employer';
  const selectedLogo = selectedOrg?.logo?.downloadURL || null;
  const selectedCompensation = String(selected?.logistics?.compensation || '').trim();
  const selectedVenue = String(selected?.logistics?.venueAddress || '').trim();
  const selectedDeadline = formatReadableDate(selected?.logistics?.applicationDeadline);
  const selectedStart = formatReadableDate(selected?.logistics?.startDate);
  const selectedDelivery = formatDeliveryLabel(selected?.logistics?.deliveryMode);
  const selectedApplyUrl = selected?.details?.applicationUrl || '#';
  const selectedBlocks = renderDescriptionBlocks(selected?.details?.descriptionMarkdown);
  const selectedContact = String(selectedCoordinator.contact || '').trim();
  const selectedContactHref = selectedContact.includes('@')
    ? `mailto:${selectedContact}`
    : selectedContact
      ? `tel:${selectedContact.replace(/\\s+/g, '')}`
      : null;
  const noteEntries = [
    ['Mobility', selectedNotes.mobility],
    ['Hearing', selectedNotes.hearing],
    ['Vision', selectedNotes.vision],
    ['Sensory', selectedNotes.sensory],
  ].filter(([, value]) => String(value || '').trim() !== '');
  const isBookmarked = selected ? bookmarked.includes(selected.id) : false;
  const collapsedText = String(selected?.details?.descriptionMarkdown || '').slice(0, 220);

  /* ---------------- Gemini PWD copilot handlers (Details page) ---------------- */
  const copyAiText = useCallback(async (text, okMsg = 'Copied to clipboard.') => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(text || ''));
        pushToast(okMsg);
      } else if (typeof window !== 'undefined' && window.prompt) {
        window.prompt('Copy:', String(text || ''));
      }
    } catch (e) {
      pushToast('Copy failed. Long-press to copy manually.', 'error');
    }
  }, [pushToast]);

  // 6) AI smart search: "remote jobs with screen reader support" -> related feed.
  const handleAiFind = useCallback(async (rawText) => {
    const text = String(rawText ?? searchQuery).trim();
    if (!text || aiParsing) return;
    setAiParsing(true);
    setAiNote('Able is understanding your request…');
    try {
      const parsed = await parseNaturalLanguageQuery(text);
      setSearchQuery(parsed.searchKeywords || '');
      // Map the parsed accommodation back onto a related-tag chip when possible.
      if (Array.isArray(parsed.accommodations) && parsed.accommodations.length > 0) {
        setActiveChip(parsed.accommodations[0]);
      } else if (Array.isArray(parsed.workModes) && parsed.workModes.length > 0) {
        const modeLabel = parsed.workModes[0] === 'Remote Only' ? '100% Remote' : parsed.workModes[0];
        setActiveChip(modeLabel);
      } else {
        setActiveChip(null);
      }
      if (parsed.quickFilter && /job|event|grant|training/i.test(parsed.quickFilter)) {
        setSortBy('Highest Accommodation');
      }
      setCurrentPage(1);
      setAiNote(`✨ ${parsed.explanation || 'Filters applied.'}${parsed.ai ? '' : ' (offline keyword mode)'}`);
    } catch (e) {
      setAiNote('AI is unreachable — try keywords like "remote", "ASL", or "grant".');
    } finally {
      setAiParsing(false);
    }
  }, [searchQuery, aiParsing]);

  const handleVoiceSearch = useCallback(() => {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        pushToast('Voice search is not supported in this browser. Type your request instead.', 'info');
        return;
      }
      if (aiListening) {
        try { recogRef.current?.stop(); } catch (e) { /* noop */ }
        setAiListening(false);
        return;
      }
      const recog = new SR();
      recogRef.current = recog;
      recog.lang = 'en-KE';
      recog.interimResults = false;
      recog.maxAlternatives = 1;
      recog.onresult = (e) => {
        const transcript = e.results?.[0]?.[0]?.transcript || '';
        setAiListening(false);
        if (transcript.trim()) {
          setSearchQuery(transcript);
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
  }, [aiListening, handleAiFind, pushToast]);

  const voiceAvailable = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // 1+2) Easy-Read summary (+ Kiswahili toggle).
  const handleSimplify = useCallback(async () => {
    if (!selected || aiSummaryLoading) return;
    setAiSummaryLoading(true);
    try {
      const { text, ai } = await summarizeOpportunity(selected);
      setAiSummaryEn(text);
      setAiSummary(text);
      setAiSummaryLang('English');
      setAiSummaryIsAi(ai);
    } catch (e) {
      pushToast('Summary failed. Check your connection and try again.', 'error');
    } finally {
      setAiSummaryLoading(false);
    }
  }, [selected, aiSummaryLoading, pushToast]);

  const handleToggleLang = useCallback(async () => {
    if (!aiSummary || aiSummaryLoading) return;
    if (aiSummaryLang === 'Kiswahili') {
      setAiSummary(aiSummaryEn || aiSummary);
      setAiSummaryLang('English');
      return;
    }
    setAiSummaryLoading(true);
    try {
      const source = aiSummaryEn || aiSummary;
      const { text, ai, lang } = await translateEasyRead(source, 'Kiswahili');
      setAiSummary(text);
      setAiSummaryLang(lang === 'Kiswahili' ? 'Kiswahili' : 'English');
      if (!ai) pushToast('Translation is offline — showing the English version.', 'info');
      else setAiSummaryIsAi(true);
    } catch (e) {
      pushToast('Translation failed. Showing English instead.', 'error');
    } finally {
      setAiSummaryLoading(false);
    }
  }, [aiSummary, aiSummaryEn, aiSummaryLang, aiSummaryLoading, pushToast]);

  // 3) Fit check against verified accommodations.
  const handleCheckFit = useCallback(async () => {
    if (!selected || fitLoading) return;
    setFitLoading(true);
    try {
      const { text, ai } = await explainMatch(selected, userNeed);
      setFitText(text);
      setFitIsAi(ai);
    } catch (e) {
      pushToast('Fit check failed. Try again.', 'error');
    } finally {
      setFitLoading(false);
    }
  }, [selected, userNeed, fitLoading, pushToast]);

  // 4) Accessible application plan.
  const handlePlanSteps = useCallback(async () => {
    if (!selected || stepsLoading) return;
    setStepsLoading(true);
    try {
      const { text, ai } = await planAccessibleApplication(selected, userNeed);
      setStepsText(text);
      setStepsIsAi(ai);
    } catch (e) {
      pushToast('Planning failed. Try again.', 'error');
    } finally {
      setStepsLoading(false);
    }
  }, [selected, userNeed, stepsLoading, pushToast]);

  // 5) Scoped Q&A about this listing.
  const handleAsk = useCallback(async (preset) => {
    const question = String(preset ?? qaInput).trim();
    if (!question || !selected || qaLoading) return;
    const nextHistory = [...qaHistory, { role: 'user', text: question }];
    setQaHistory(nextHistory);
    setQaInput('');
    setQaLoading(true);
    try {
      const historyForApi = nextHistory.slice(-6).map((m) => ({ role: m.role, text: m.text }));
      const { text } = await askAboutOpportunity(selected, question, historyForApi);
      const display = String(text || '').trim() || 'Sorry, I did not catch that. Ask about deadline, pay, venue, access, or how to apply.';
      setQaHistory((prev) => [...prev, { role: 'able', text: display }]);
    } catch (e) {
      setQaHistory((prev) => [...prev, { role: 'able', text: 'Sorry — my AI is unreachable. Try the Easy-Read summary or contact the coordinator directly.' }]);
    } finally {
      setQaLoading(false);
    }
  }, [qaInput, qaHistory, selected, qaLoading]);

  const aiPanelProps = {
    aiSummary, aiSummaryLoading, aiSummaryIsAi, aiSummaryLang,
    onSimplify: handleSimplify, onToggleLang: handleToggleLang,
    onListenSummary: () => { if (!speakText(aiSummary)) pushToast('Spoken audio is not available in this browser.', 'info'); },
    userNeed, setUserNeed,
    fitText, fitLoading, fitIsAi, onCheckFit: handleCheckFit,
    onListenFit: () => { if (!speakText(fitText)) pushToast('Spoken audio is not available in this browser.', 'info'); },
    stepsText, stepsLoading, stepsIsAi, onPlanSteps: handlePlanSteps,
    onListenSteps: () => { if (!speakText(stepsText)) pushToast('Spoken audio is not available in this browser.', 'info'); },
    qaHistory, qaInput, setQaInput, qaLoading, onAsk: () => handleAsk(),
    onListenQa: () => {
      const last = [...qaHistory].reverse().find((m) => m.role === 'able');
      if (last && !speakText(last.text)) pushToast('Spoken audio is not available in this browser.', 'info');
    },
    onCopy: copyAiText,
  };

  const tabButton = (value, icon, label) => {
    const isActive = activeTab === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setActiveTab(value)}
        aria-pressed={isActive}
        className={
          isActive
            ? 'py-1.5 lg:py-2 px-1 rounded-lg lg:rounded-xl text-[11px] lg:text-xs font-bold text-slate-900 bg-white shadow-xs flex items-center justify-center gap-1 whitespace-nowrap truncate'
            : 'py-1.5 lg:py-2 px-1 rounded-lg lg:rounded-xl text-[11px] lg:text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center justify-center gap-1 transition-colors whitespace-nowrap truncate'
        }
      >
        <span className="material-symbols-outlined text-[13px] lg:text-[15px] shrink-0">{icon}</span>
        {label}
      </button>
    );
  };

  if (showSubmissionForm && typeof onPostOpportunity !== 'function') {
    return <SubmissionForm />;
  }

  return (
    <div
      className="bg-[#f8fafc] text-slate-800 antialiased min-h-screen flex flex-col selection:bg-blue-100 selection:text-blue-900"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      <style>{FIDELITY_STYLES}</style>
      {/* Floating Modern Header Bar matching Reference Structure — desktop / large devices only */}
      <header className="hidden lg:block sticky top-0 z-50 px-4 sm:px-6 lg:px-8 pt-4 pb-2 backdrop-blur-md bg-[#f8fafc]/80 transition-all">
      <div className="max-w-[1580px] mx-auto bg-white/95 rounded-3xl lg:rounded-full px-5 py-3 shadow-soft border border-slate-200/70 flex flex-wrap items-center justify-between gap-4">
      {/* Brand + Back (matching Home.js) */}
      <div className="flex items-center gap-2.5 shrink-0">
      <button type="button" onClick={handleBack} className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center transition-colors shrink-0" aria-label="Go back to previous page" title="Back">
      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">arrow_back</span>
      </button>
      <div className="flex items-center gap-2.5 p-1" aria-label="AccessAble brand">
      <img alt="AccessAble Logo" className="h-10 w-auto object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBCDjVcBc3SNANVDT_ft-chQPXJCLOQGldM-AKBAD84S97xfkIkmjOznYOtxgWiW5Dbv2hTdSkGJo8eDJF1uCwzv-W-Ghj0kM_grRYiD-0zFLledBnQ9udNAAE2K36tqe-gOPhRfYoS38KIQ3At2QtkO6UFAKvlJja-KOoArAyMH27rewac-QfhWctu8fNbtWxq40lHIyPqF-yjA0mQbO0CWxR1-sKK_GV4uKF8obS2ONVis9Nykdf-Oqp7fqxZegFIOvE" />
      <div className="flex flex-col">
      <span className="font-headline-sm text-headline-sm text-primary tracking-tight font-extrabold">AccessAble</span>
      </div>
      </div>
      </div>
      {/* Search navigates the related feed */}
      <div className="flex-1 max-w-xl mx-auto order-3 lg:order-2 w-full lg:w-auto">
      <div className="relative flex items-center bg-slate-100/80 focus-within:bg-white focus-within:outline-none focus-within:ring-0 focus-within:border-transparent rounded-full border border-slate-200 transition-all px-4 py-2">
      <span className="material-symbols-outlined text-slate-400 text-[20px] mr-2">search</span>
      <input
        className="w-full bg-transparent border-none outline-none text-xs sm:text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 focus:border-transparent p-0" style={{ outline: 'none', boxShadow: 'none' }}
        placeholder="Search related opportunities..."
        type="text"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        aria-label="Search related opportunities"
      />
      </div>
      </div>
      {/* Action Nav & Profile Elements */}
      <div className="flex items-center gap-2.5 sm:gap-3 order-2 lg:order-3 shrink-0">
      {/* Accessibility Suite Quick Controls */}
      <div className="hidden sm:flex items-center bg-slate-100/90 rounded-full p-1 gap-1">
      <button className="p-1.5 rounded-full hover:bg-white hover:shadow-xs text-slate-600 hover:text-blue-700 transition-all" title="High Contrast Mode">
      <span className="material-symbols-outlined text-[18px]">contrast</span>
      </button>
      <button className="p-1.5 rounded-full hover:bg-white hover:shadow-xs text-slate-600 hover:text-blue-700 transition-all" title="Adjust Text Scaling">
      <span className="material-symbols-outlined text-[18px]">text_fields</span>
      </button>
      <button className="p-1.5 rounded-full hover:bg-white hover:shadow-xs text-slate-600 hover:text-blue-700 transition-all" title="Universal Accessibility Guide">
      <span className="material-symbols-outlined text-[18px]">accessibility_new</span>
      </button>
      </div>
      {/* Post an Opportunity Button */}
      <a className="hidden md:inline-flex items-center gap-1.5 bg-[#1d4ed8] hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm px-4 py-2.5 rounded-full shadow-sm hover:shadow transition-all" href="#" onClick={handlePostOpportunity}>
      <span className="material-symbols-outlined text-[18px]">add_circle</span>
                Post Opportunity
              </a>
      {/* User Profile Pill / Avatar with Verified Emblem */}
      <div className="flex items-center gap-2 pl-1 border-l border-slate-200">
      <div className="relative cursor-pointer">
      <img alt={profileName} title={profileName} referrerPolicy="no-referrer" className="w-10 h-10 rounded-full object-cover ring-2 ring-lime-400 p-0.5 bg-white" src={profilePhoto} />
      <span className="absolute -bottom-0.5 -right-0.5 bg-lime-500 w-3.5 h-3.5 rounded-full border-2 border-white"></span>
      </div>
      </div>
      </div>
      </div>
      </header>
      {/* MAIN SPLIT WORKSPACE: Left/Center Listing Feed + Right Detail Preview (Unified 2-Screen Reference Model) — desktop only */}
      <main className="hidden lg:block flex-1 max-w-[1580px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-5">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* LEFT & CENTER REGION (Cols 1-7 on desktop): Features, Reminders, and Feed Cards */}
      <div className="lg:col-span-7 xl:col-span-7 flex flex-col gap-6">
      {/* AI Smart Search — PWD-first discovery: type or speak in your own words,
          Gemini (parseNaturalLanguageQuery) converts it into related-feed filters.
          e.g. "remote jobs with screen reader support". */}
      <div className="rounded-3xl border border-blue-200/70 bg-gradient-to-r from-blue-50/80 to-white p-4 flex flex-col gap-2" role="region" aria-label="AI smart search for related opportunities">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-700 text-[20px]" aria-hidden="true">auto_awesome</span>
          <p className="text-sm font-extrabold text-slate-900">Describe what you need — AI finds it</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <label htmlFor="details-ai-search" className="sr-only">Describe the opportunity you need in your own words</label>
          <input
            id="details-ai-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAiFind(); } }}
            placeholder='Try: "remote jobs with screen reader support" or tap Speak…'
            className="min-w-0 flex-1 rounded-full bg-white px-4 py-2.5 text-[13px] text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-blue-500 border border-slate-200"
          />
          <div className="flex gap-2">
            {voiceAvailable && (
              <button
                type="button"
                onClick={handleVoiceSearch}
                aria-pressed={aiListening}
                aria-label={aiListening ? 'Stop voice input' : 'Speak your search'}
                title="Speak your search"
                className={`inline-flex min-h-[42px] items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-all ${aiListening ? 'animate-pulse bg-red-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{aiListening ? 'mic_off' : 'mic'}</span>
                {aiListening ? 'Listening…' : 'Speak'}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleAiFind()}
              disabled={aiParsing || !String(searchQuery || '').trim()}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-full bg-[#1d4ed8] px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">auto_awesome</span>
              {aiParsing ? 'Understanding…' : 'AI Find'}
            </button>
          </div>
        </div>
        {aiNote && (
          <p aria-live="polite" className="text-xs text-slate-600 flex items-start gap-1.5">
            <span className="material-symbols-outlined text-[16px] text-blue-600 shrink-0 mt-0.5" aria-hidden="true">info</span>
            {aiNote}
          </p>
        )}
      </div>
      {/* 3. Main Feed Section Header & Filter Quick Tags (from Reference Screen 3) */}
      <div className="pt-2">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-2">
      <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">
                      Related opportunities
                    </h2>
      </div>
      {/* Sort By Selector — same options + logic as Home.js */}
      <div className="flex items-center gap-2">
      <label className="text-xs text-slate-500 font-medium" htmlFor="details-sort-select">Sort:</label>
      <div className="relative">
      <select
        id="details-sort-select"
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value)}
        className="appearance-none bg-white border border-slate-200 text-slate-700 text-xs font-semibold pl-3 pr-8 py-1.5 rounded-full shadow-2xs hover:bg-slate-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
      <span className="material-symbols-outlined text-[14px] text-slate-400 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">expand_more</span>
      </div>
      </div>
      </div>
      {/* Related tags derived from the opportunity currently being viewed */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
                  {relatedTags.length === 0 ? (
                    <span className="text-xs text-slate-400">Tags appear once an opportunity is selected.</span>
                  ) : relatedTags.map((chip) => {
                    const isActive = activeChip === chip;
                    return (
                      <button
                        key={chip}
                        type="button"
                        onClick={() => setActiveChip(isActive ? null : chip)}
                        aria-pressed={isActive}
                        className={
                          isActive
                            ? 'px-3.5 py-1.5 rounded-full text-xs font-bold bg-blue-100 text-blue-700 flex items-center gap-1 shrink-0'
                            : 'px-3.5 py-1.5 rounded-full text-xs font-semibold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 shrink-0'
                        }
                      >
                        {chip}
                        {isActive && <span className="material-symbols-outlined text-[14px]">close</span>}
                      </button>
                    );
                  })}
                </div>
      </div>
      {/* 4. Opportunity Feed: live cards — View details loads the right preview */}
      <div className="space-y-4">
      {isLoading ? (
        [0, 1, 2].map((skeleton) => (
          <article key={`skeleton-${skeleton}`} aria-busy="true" className="bg-white border border-slate-200/80 rounded-3xl p-5 shadow-subtle animate-pulse">
            <div className="h-4 w-32 rounded-full bg-slate-100" />
            <div className="mt-3 h-6 w-3/4 rounded bg-slate-100" />
            <div className="mt-3 flex gap-2">
              <div className="h-6 w-24 rounded-full bg-slate-100" />
              <div className="h-6 w-28 rounded-full bg-slate-100" />
            </div>
          </article>
        ))
      ) : loadError ? (
        <div className="bg-white border border-red-200 rounded-3xl p-6 text-center flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-[32px] text-red-500">cloud_off</span>
          <h3 className="text-base font-bold text-slate-900">Couldn&apos;t load opportunities</h3>
          <p className="text-xs text-slate-500">Check your connection and Firebase rules, then try again.</p>
          <button
            type="button"
            onClick={() => setRetryTick((t) => t + 1)}
            className="bg-[#1d4ed8] text-white font-semibold text-xs px-4 py-2 rounded-full"
          >
            Retry
          </button>
        </div>
      ) : pagedFeed.length === 0 ? (
        <div className="bg-white border border-slate-200/80 rounded-3xl p-6 text-center flex flex-col items-center gap-3">
          <span className="material-symbols-outlined text-[32px] text-slate-300">search_off</span>
          <h3 className="text-base font-bold text-slate-900">No related opportunities</h3>
          <p className="text-xs text-slate-500">
            {opportunities.length === 0
              ? 'No opportunities have been published yet.'
              : 'Try a different search term or category.'}
          </p>
        </div>
      ) : (
        pagedFeed.map((opp, index) => {
          const config = getCategoryConfig(opp?.basic?.category);
          const orgName = opp?.basic?.organization?.name || 'Inclusive Employer';
          const title = opp?.basic?.title || 'Untitled opportunity';
          const logoUrl = opp?.basic?.organization?.logo?.downloadURL || null;
          const compensation = String(opp?.logistics?.compensation || '').trim();
          const pills = getAccommodationPills(opp);
          const isActive = selected && opp.id === selected.id;
          const avatarStyle = AVATAR_STYLES[index % AVATAR_STYLES.length];
          return (
            <article
              key={opp.id}
              className={
                isActive
                  ? 'bg-white border-2 border-blue-500/80 rounded-3xl p-5 shadow-soft transition-all relative cursor-pointer ring-4 ring-blue-50'
                  : 'bg-white border border-slate-200/80 hover:border-blue-300 rounded-3xl p-5 shadow-subtle hover:shadow-soft transition-all cursor-pointer'
              }
              onClick={() => handleSelect(opp)}
            >
            <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3.5">
            {logoUrl ? (
              <img src={logoUrl} alt={`${orgName} logo`} className="w-12 h-12 rounded-2xl object-cover bg-slate-50 border border-slate-200/80 shrink-0" loading="lazy" />
            ) : (
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-lg shrink-0 ${avatarStyle}`}>
                {getInitials(orgName)}
              </div>
            )}
            <div>
            <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wide">{orgName}</span>
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
            <span className="material-symbols-outlined text-[12px]">verified</span> Trusted
            </span>
            <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
            <span className="material-symbols-outlined text-[12px]">{config.icon}</span> {config.label}
            </span>
            </div>
            <h3 className="text-base sm:text-lg font-bold text-slate-900 hover:text-blue-600 transition-colors mt-0.5">
              {title}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-2">
            {compensation && (
              <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full">{compensation}</span>
            )}
            <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">{formatLocation(opp)}</span>
            </div>
            </div>
            </div>
            <button
              type="button"
              aria-label={`Save ${title}`}
              aria-pressed={bookmarked.includes(opp.id)}
              onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleBookmark(opp.id); }}
              className={
                bookmarked.includes(opp.id)
                  ? 'p-2 rounded-full bg-secondary-container text-on-secondary-fixed transition-colors'
                  : 'p-2 rounded-full text-slate-400 hover:text-blue-600 hover:bg-slate-100 transition-colors'
              }
            >
            <span className="material-symbols-outlined text-[20px]">{bookmarked.includes(opp.id) ? 'bookmark' : 'bookmark_border'}</span>
            </button>
            </div>
            {/* Accommodations Pill Row */}
            {pills.length > 0 && (
              <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
              {pills.slice(0, 3).map((pill, pillIndex) => (
                <span
                  key={pill.key}
                  className={
                    pillIndex === 0
                      ? 'text-[11px] font-bold text-lime-700 bg-lime-50 border border-lime-200/80 px-2.5 py-1 rounded-full flex items-center gap-1'
                      : 'text-[11px] font-medium text-slate-700 bg-slate-100 px-2.5 py-1 rounded-full flex items-center gap-1'
                  }
                >
                <span className="material-symbols-outlined text-[14px]">{pill.icon}</span> {pill.label}
                </span>
              ))}
              {pills.length > 3 && (
                <span className="text-[11px] font-semibold text-slate-500">+{pills.length - 3} more</span>
              )}
              </div>
            )}
            {/* Card Bottom Bar: Applicants + Timestamp + Action */}
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
            <span className="text-xs text-slate-400">{formatPostedAgo(opp)}{formatReadableDate(opp?.logistics?.applicationDeadline) ? ` • ${config.deadlineLabel} ${formatReadableDate(opp.logistics.applicationDeadline)}` : ''}</span>
            <div className="flex items-center gap-2">
            {isActive && <span className="hidden sm:inline text-xs font-bold text-blue-600">Selected Preview</span>}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); handleSelect(opp); }}
              className={
                isActive
                  ? 'bg-[#1d4ed8] hover:bg-blue-700 text-white font-semibold text-xs px-4 py-2 rounded-full shadow-xs transition-transform hover:scale-105'
                  : 'bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 font-semibold text-xs px-4 py-2 rounded-full transition-colors'
              }
            >
              View details
            </button>
            </div>
            </div>
            </article>
          );
        })
      )}
      </div>
      {/* Pagination Controls */}
      <nav aria-label="Pagination" className="flex items-center justify-center gap-2 pt-4 pb-4">
      <button
        type="button"
        disabled={safePage === 1}
        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
        className="px-4 py-2 rounded-full text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 transition-colors disabled:opacity-50"
      >
      <span className="material-symbols-outlined text-[16px]">chevron_left</span>
                  Previous
                </button>
      <div className="flex items-center gap-1">
      {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 5).map((page) => (
        <button
          key={page}
          type="button"
          aria-current={safePage === page ? 'page' : undefined}
          onClick={() => setCurrentPage(page)}
          className={
            safePage === page
              ? 'w-8 h-8 rounded-full text-xs font-bold bg-[#1d4ed8] text-white'
              : 'w-8 h-8 rounded-full text-xs font-semibold text-slate-600 hover:bg-slate-200'
          }
        >
          {page}
        </button>
      ))}
      {totalPages > 5 && <span className="px-1 text-slate-400 text-xs">...</span>}
      </div>
      <button
        type="button"
        disabled={safePage === totalPages}
        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
        className="px-4 py-2 rounded-full text-xs font-bold bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1 transition-colors disabled:opacity-50"
      >
                  Next
                  <span className="material-symbols-outlined text-[16px]">chevron_right</span>
      </button>
      </nav>

      </div>
      {/* RIGHT REGION: adaptive opportunity details card */}
      <div className="lg:col-span-5 xl:col-span-5">
      <aside id="opportunity-detail-card" className="sticky top-28 bg-white border border-slate-200/90 rounded-3xl shadow-soft p-6 flex flex-col gap-5 overflow-hidden">
      {!selected ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <span className="material-symbols-outlined text-[40px] text-slate-300">search_off</span>
          <h2 className="text-lg font-bold text-slate-900">No opportunity selected</h2>
          <p className="text-xs text-slate-500 max-w-xs">
            {isLoading ? 'Loading opportunities…' : 'Select a card on the left to preview it here.'}
          </p>
        </div>
      ) : (
        <>
        {/* Top Back / Share / Bookmark Bar */}
        <div className="flex items-center justify-between">
        <button onClick={handleBack} className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors" title="Back to opportunities" type="button">
        <span className="material-symbols-outlined text-[20px]">arrow_back</span>
        </button>
        <div className="flex items-center gap-1.5 font-bold text-sm text-slate-800">
        <span className="">{selectedOrgName}</span>
        <span className="material-symbols-outlined text-blue-600 text-[18px]">verified</span>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleBookmark(selected.id); }}
          className={isBookmarked ? 'w-9 h-9 rounded-full bg-secondary-container text-on-secondary-fixed flex items-center justify-center transition-colors' : 'w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors'}
          title={isBookmarked ? 'Saved' : 'Bookmark'}
          type="button"
          aria-pressed={isBookmarked}
        >
        <span className="material-symbols-outlined text-[20px]">{isBookmarked ? 'bookmark' : 'bookmark_border'}</span>
        </button>
        </div>
        {/* Hero Company Avatar & Role Summary */}
        <div className="flex flex-col items-center text-center pt-2">
        {selectedLogo ? (
          <img src={selectedLogo} alt={`${selectedOrgName} logo`} className="w-20 h-20 rounded-full object-cover shadow-md ring-4 ring-blue-50 bg-white" />
        ) : (
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-blue-600 to-blue-400 text-white flex items-center justify-center text-2xl font-extrabold shadow-md ring-4 ring-blue-50">
            {getInitials(selectedOrgName)}
          </div>
        )}
        <h2 className="text-xl font-bold text-slate-900 mt-2 tracking-tight">
          {selectedTitle}
        </h2>
        {selectedCompensation && (
          <p className="text-sm font-bold text-blue-700 mt-0.5">
            {selectedCompensation}
          </p>
        )}
        {/* Role Chips: category + delivery + accommodation count */}
        <div className="flex flex-wrap justify-center items-center gap-2 mt-3">
        <span className="px-3.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">{selectedConfig.label}</span>
        <span className="px-3.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">{selectedDelivery}</span>
        <span className="px-3.5 py-1 rounded-full text-xs font-semibold bg-lime-100 text-lime-800 font-bold">{selectedPills.length} Accommodations</span>
        </div>
        </div>
        {/* Segmented Tab Switcher (Overview | Company | Barrier-Free) */}
        <div className="grid grid-cols-3 bg-slate-100 p-1.5 rounded-2xl gap-1">
        {tabButton('overview', 'description', 'Overview')}
        {tabButton('company', 'domain', 'Company')}
        {tabButton('barrier', 'verified', 'Barrier-Free')}
        </div>

        {activeTab === 'overview' && (
          <>
          {/* Key Quick Info Grid — labels adapt per category */}
          <div className="grid grid-cols-3 gap-2.5 bg-slate-50/80 rounded-2xl p-3 border border-slate-100">
          <div className="flex flex-col text-left">
          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 uppercase">
          <span className="material-symbols-outlined text-[14px] text-amber-700">{selectedConfig.typeIcon}</span>
            {selectedConfig.typeLabel}
          </div>
          <span className="text-xs font-bold text-slate-800 mt-1">{selectedConfig.label}</span>
          </div>
          <div className="flex flex-col text-left">
          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 uppercase">
          <span className="material-symbols-outlined text-[14px] text-blue-600">alarm</span>
            {selectedConfig.deadlineLabel}
          </div>
          <span className="text-xs font-bold text-slate-800 mt-1">{selectedDeadline || 'Rolling'}</span>
          </div>
          <div className="flex flex-col text-left">
          <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 uppercase">
          <span className="material-symbols-outlined text-[14px] text-teal-600">home</span>
            {selectedConfig.startLabel}
          </div>
          <span className="text-xs font-bold text-slate-800 mt-1">{selectedStart || 'TBD'}</span>
          </div>
          </div>
          {/* Compensation Secondary Info */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-[18px]">{selectedConfig.compensationIcon}</span>
          </div>
          <div className="flex flex-col">
          <span className="text-[10px] font-bold text-slate-400 uppercase">{selectedConfig.compensationLabel}</span>
          <span className="text-xs font-bold text-slate-800">{selectedCompensation || 'Not specified'}</span>
          </div>
          </div>
          {selectedVenue && (
            <div className="bg-slate-50/80 border border-slate-100 rounded-2xl p-3 flex items-start gap-2.5">
              <span className="material-symbols-outlined text-[18px] text-slate-500 shrink-0">location_on</span>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{selectedConfig.venueLabel}</span>
                <span className="text-xs text-slate-700 mt-0.5">{selectedVenue}</span>
              </div>
            </div>
          )}
          {/* Details Copy with Read More */}
          <div>
          <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">{selectedConfig.detailsHeading}</h3>
          <button className="text-slate-400 hover:text-slate-600" type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <span className="material-symbols-outlined text-[16px]">more_horiz</span>
          </button>
          </div>
          {!expanded ? (
            <p className="text-xs leading-relaxed text-slate-600">
              {collapsedText.length > 219 ? `${collapsedText}…` : collapsedText || 'No description provided.'}{' '}
              <button type="button" onClick={() => setExpanded(true)} className="text-blue-600 font-bold hover:underline">Read More</button>
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {selectedBlocks.map((block, index) => {
                if (block.type === 'heading') {
                  return <h4 key={index} className="text-xs font-bold text-slate-900">{block.text}</h4>;
                }
                if (block.type === 'list') {
                  return (
                    <ul key={index} className="list-disc pl-4 space-y-1 text-xs text-slate-600">
                      {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
                    </ul>
                  );
                }
                return <p key={index} className="text-xs leading-relaxed text-slate-600">{block.text}</p>;
              })}
              <button type="button" onClick={() => setExpanded(false)} className="self-start text-blue-600 font-bold hover:underline text-xs">Show less</button>
            </div>
          )}
          </div>
          </>
        )}

        {activeTab === 'company' && (
          <div className="flex flex-col gap-2.5">
            <div className="bg-slate-50/80 border border-slate-100 rounded-2xl p-4 flex items-start gap-3">
              {selectedLogo ? (
                <img src={selectedLogo} alt={`${selectedOrgName} logo`} className="w-11 h-11 rounded-2xl object-cover border border-slate-200 bg-white shrink-0" />
              ) : (
                <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold shrink-0">
                  {getInitials(selectedOrgName)}
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold text-slate-900">{selectedOrgName}</span>
                {selectedOrg?.website ? (
                  <a href={selectedOrg.website} target="_blank" rel="noreferrer" className="text-xs font-bold text-blue-600 hover:underline break-all">
                    {selectedOrg.website}
                  </a>
                ) : (
                  <span className="text-xs text-slate-500">Website not provided</span>
                )}
                <span className="inline-flex w-fit items-center gap-1 text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                  <span className="material-symbols-outlined text-[12px]">verified</span> Trusted organizer
                </span>
              </div>
            </div>
            {(selectedCoordinator.name || selectedContact) && (
              <div className="border border-slate-200/80 rounded-2xl p-4">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-blue-600">support_agent</span>
                  Accessibility coordinator
                </h3>
                {selectedCoordinator.name && <p className="text-xs font-bold text-slate-800 mt-2">{selectedCoordinator.name}</p>}
                {selectedContactHref ? (
                  <a href={selectedContactHref} className="text-xs font-bold text-blue-600 hover:underline break-all">{selectedContact}</a>
                ) : selectedContact ? (
                  <p className="text-xs text-slate-700">{selectedContact}</p>
                ) : null}
                {selectedCoordinator.noticePeriod && (
                  <p className="text-[11px] text-slate-500 mt-1">Notice: {selectedCoordinator.noticePeriod}</p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="bg-white border border-slate-200/80 rounded-2xl p-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{selectedConfig.deadlineLabel}</span>
                <p className="text-xs font-bold text-slate-800 mt-1">{selectedDeadline || 'Rolling'}</p>
              </div>
              <div className="bg-white border border-slate-200/80 rounded-2xl p-3">
                <span className="text-[10px] font-bold text-slate-400 uppercase">{selectedConfig.startLabel}</span>
                <p className="text-xs font-bold text-slate-800 mt-1">{selectedStart || 'TBD'}</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'barrier' && (
          <div className="flex flex-col gap-3">
          {/* Verified Accommodations Deep-Dive Section */}
          <div className="border border-lime-200/70 bg-lime-50/40 rounded-2xl p-4">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-lime-200/60">
          <span className="text-xs font-bold text-lime-900 uppercase tracking-wider flex items-center gap-1.5">
          <span className="material-symbols-outlined text-lime-600 text-[18px]">verified_user</span>
            Pre-Audited Accommodations
          </span>
          <span className="text-[10px] font-extrabold bg-lime-200 text-lime-900 px-2 py-0.5 rounded-full">{selectedPills.length} Verified</span>
          </div>
          {selectedPills.length > 0 ? (
            <ul className="space-y-2 text-xs text-slate-700">
            {selectedPills.map((pill) => (
              <li key={pill.key} className="flex items-start gap-2">
              <span className="material-symbols-outlined text-lime-600 text-[16px] shrink-0 mt-0.5">check_circle</span>
              <span className=""><strong>{pill.label}</strong></span>
              </li>
            ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-600">Contact the coordinator for tailored accommodations.</p>
          )}
          </div>
          {noteEntries.length > 0 && (
            <div className="flex flex-col gap-2">
              {noteEntries.map(([area, value]) => (
                <p key={area} className="text-xs leading-relaxed text-slate-600">
                  <strong className="text-slate-800">{area}: </strong>{value}
                </p>
              ))}
            </div>
          )}
          {selected?.details?.multimodalSupport && (
            <p className="text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-200/80 px-2.5 py-1.5 rounded-xl flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">videocam</span>
              Multimodal application supported (video, voice note, or assisted application)
            </p>
          )}
          {(selectedCoordinator.name || selectedContact) && (
            <div className="border border-slate-200/80 rounded-2xl p-3">
              <span className="text-[10px] font-bold text-slate-400 uppercase">Coordinator</span>
              <p className="text-xs font-bold text-slate-800 mt-0.5">
                {selectedCoordinator.name || 'Access coordinator'}
                {selectedCoordinator.noticePeriod ? <span className="font-medium text-slate-500"> • {selectedCoordinator.noticePeriod}</span> : ''}
              </p>
              {selectedContactHref ? (
                <a href={selectedContactHref} className="text-xs font-bold text-blue-600 hover:underline break-all">{selectedContact}</a>
              ) : null}
            </div>
          )}
          </div>
        )}

        {/* Gemini PWD copilot for THIS listing (desktop) — Easy-Read, fit check, plan, Q&A */}
        <OpportunityAiPanel {...aiPanelProps} />

        {/* Sticky CTA — label adapts per category */}
        <div className="pt-2">
        <a
          href={selectedApplyUrl}
          target={selectedApplyUrl === '#' ? undefined : '_blank'}
          rel={selectedApplyUrl === '#' ? undefined : 'noreferrer'}
          className="w-full bg-[#1d4ed8] hover:bg-blue-700 text-white rounded-full py-3.5 px-6 font-bold text-sm shadow-float flex items-center justify-between group transition-all"
        >
        <span className="pl-2">{selectedConfig.cta}</span>
        <div className="flex items-center gap-0.5 text-blue-200 group-hover:translate-x-1 transition-transform">
        <span className="material-symbols-outlined text-[18px]">chevron_right</span>
        <span className="material-symbols-outlined text-[18px] -ml-2">chevron_right</span>
        <span className="material-symbols-outlined text-[18px] -ml-2">chevron_right</span>
        <span className="material-symbols-outlined text-[18px] -ml-2 text-white">chevron_right</span>
        </div>
        </a>
        {selectedConfig.ctaNote ? (
          <p className="text-center text-[11px] text-slate-400 mt-2 font-medium">
            {selectedConfig.ctaNote}
          </p>
        ) : null}
        </div>
        </>
      )}
      </aside>
      </div>
      </div>
      </main>
      {/* Clean Minimal Footer matching Brand Spec — desktop only */}
      <footer className="hidden lg:block mt-auto border-t border-slate-200/80 bg-white">
      <div className="max-w-[1580px] mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
      <div className="flex items-center gap-3">
      <img alt="AccessAble Logo" className="h-6 w-auto object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDr5881s4MY59MfVF4TM8OXqJ8RABAUG7jHO6uGql_63-aO3pE_UAwsGXnbYKvZj-uE4bnniuPNPTQafrlwKBJco7x3d4jjiEEl33NIBulca-xw7LDWZHrrl91isRVVRwKo-GNPeV2rkLzDqXRbsyvAHvVCrlbWwYYiKMDaapesVmJJmpm0zREBQKqUCK584JTat7QnFAEqqFCJ2AczHG-qpHbPmnGDpie-wkQQYvB976m2E0RsF0FLIMZkv38B5n6-uUQ" />
      <span className="text-xs text-slate-500">© 2025 AccessAble. Universal accessibility &amp; zero-barrier employment standard.</span>
      </div>
      <div className="flex flex-wrap items-center gap-6 text-xs font-semibold text-slate-600">
      <a className="hover:text-blue-600 transition-colors" href="#">Employer Accommodation Guide</a>
      <a className="hover:text-blue-600 transition-colors" href="#">Universal Statement</a>
      <a className="hover:text-blue-600 transition-colors" href="#">WCAG 2.2 AAA Audit</a>
      <a className="hover:text-blue-600 transition-colors" href="#">Privacy &amp; Security</a>
      </div>
      </div>
      </footer>
      {/* ------------------------------------------------------------------
        * Mobile UI — React port of src/DetailsMobile.html.
        * Visible only below lg (desktop header/main/footer above are
        * `hidden lg:block`). Shares ALL logic/state with desktop:
        * searchQuery, activeCategory, activeChip, activeTab, expanded,
        * pagedFeed, selected, bookmarks, pagination, handlers.
        * ------------------------------------------------------------------ */}
      <div className="lg:hidden w-full max-w-[420px] mx-auto bg-[#f8fafc] min-h-screen flex flex-col relative shadow-lg border-x border-slate-200/60">
        {/* BEGIN: AppHeader (mobile adaptation of floating desktop header) */}
        <header className="sticky top-0 z-50 px-3 pt-2 pb-1.5 backdrop-blur-md bg-[#f8fafc]/90">
          <div className="bg-white/95 rounded-2xl px-3 py-2.5 shadow-card border border-slate-200/70 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div aria-label="AccessAble brand" className="flex items-center gap-1.5 flex-1 min-w-0">
                <img
                  alt="AccessAble Logo"
                  className="h-7 w-auto object-contain"
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuBCDjVcBc3SNANVDT_ft-chQPXJCLOQGldM-AKBAD84S97xfkIkmjOznYOtxgWiW5Dbv2hTdSkGJo8eDJF1uCwzv-W-Ghj0kM_grRYiD-0zFLledBnQ9udNAAE2K36tqe-gOPhRfYoS38KIQ3At2QtkO6UFAKvlJja-KOoArAyMH27rewac-QfhWctu8fNbtWxq40lHIyPqF-yjA0mQbO0CWxR1-sKK_GV4uKF8obS2ONVis9Nykdf-Oqp7fqxZegFIOvE"
                />
                <span className="font-extrabold text-[13px] text-slate-900 tracking-tight truncate">AccessAble</span>
              </div>
              <div className="relative shrink-0">
                <img
                  alt={profileName}
                  title={profileName}
                  referrerPolicy="no-referrer"
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-lime-400 p-0.5 bg-white"
                  src={profilePhoto}
                />
                <span className="absolute -bottom-0.5 -right-0.5 bg-lime-500 w-2.5 h-2.5 rounded-full border-2 border-white"></span>
              </div>
            </div>
            <div className="relative flex items-center bg-slate-100/80 focus-within:bg-white focus-within:outline-none focus-within:ring-0 focus-within:border-transparent rounded-full border border-slate-200 px-3 py-1.5">
              <span className="material-symbols-outlined text-slate-400 text-[16px] mr-1.5">search</span>
              <input
                className="w-full bg-transparent border-none outline-none text-xs text-slate-800 placeholder:text-slate-400 p-0 focus:outline-none focus:ring-0 focus:border-transparent" style={{ outline: 'none', boxShadow: 'none' }}
                placeholder='Ask AI: "remote jobs with screen reader support"…'
                type="text"
                aria-label="AI smart search related opportunities"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAiFind(); } }}
              />
              {voiceAvailable && (
                <button
                  type="button"
                  onClick={handleVoiceSearch}
                  aria-label={aiListening ? 'Stop voice input' : 'Speak your search'}
                  aria-pressed={aiListening}
                  className={`ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors ${aiListening ? 'animate-pulse bg-red-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}
                >
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{aiListening ? 'mic_off' : 'mic'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleAiFind()}
                disabled={aiParsing || !String(searchQuery || '').trim()}
                aria-label="AI find related opportunities"
                title="AI find"
                className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1d4ed8] text-white disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-[16px]" aria-hidden="true">auto_awesome</span>
              </button>
            </div>
            {aiNote && (
              <p aria-live="polite" className="text-[10px] text-slate-600 flex items-start gap-1 px-0.5">
                <span className="material-symbols-outlined text-[13px] text-blue-600 shrink-0" aria-hidden="true">info</span>
                {aiNote}
              </p>
            )}
          </div>
        </header>
        {/* END: AppHeader */}
        <main className="flex-1 px-3 py-3 flex flex-col gap-3">
          {/* BEGIN: OpportunityDetailCard (mobile adaptation of right REGION) */}
          <aside id="opportunity-detail-card-mobile" className="bg-white border border-slate-200/90 rounded-2xl shadow-card p-3.5 flex flex-col gap-3">
            {!selected ? (
              <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                <span className="material-symbols-outlined text-[30px] text-slate-300">search_off</span>
                <h2 className="text-[13px] font-bold text-slate-900">No opportunity selected</h2>
                <p className="text-[10px] text-slate-500">{isLoading ? 'Loading opportunities…' : 'Select a card below to preview it here.'}</p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <button
                    className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0"
                    title="Back to opportunities"
                    type="button"
                    onClick={handleBack}
                  >
                    <span className="material-symbols-outlined text-[18px]">arrow_back</span>
                  </button>
                  <div className="flex items-center gap-1 font-bold text-[13px] text-slate-800 min-w-0 flex-1 justify-center">
                    <span className="truncate">{selectedOrgName}</span>
                    <span className="material-symbols-outlined text-blue-600 text-[16px] shrink-0">verified</span>
                  </div>
                  <button
                    className={isBookmarked ? 'w-8 h-8 rounded-full bg-secondary-container text-on-secondary-fixed flex items-center justify-center shrink-0 transition-colors' : 'w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 transition-colors'}
                    title={isBookmarked ? 'Saved' : 'Bookmark'}
                    type="button"
                    aria-pressed={isBookmarked}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleBookmark(selected.id); }}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {isBookmarked ? 'bookmark' : 'bookmark_border'}
                    </span>
                  </button>
                </div>
                <div className="flex flex-col items-center text-center">
                  {selectedLogo ? (
                    <img src={selectedLogo} alt={`${selectedOrgName} logo`} className="w-12 h-12 rounded-full object-cover shadow-md ring-4 ring-blue-50 bg-white" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-blue-600 to-blue-400 text-white flex items-center justify-center text-base font-extrabold shadow-md ring-4 ring-blue-50">
                      {getInitials(selectedOrgName)}
                    </div>
                  )}
                  <h2 className="text-[15px] font-bold text-slate-900 mt-1.5 tracking-tight leading-snug">{selectedTitle}</h2>
                  {selectedCompensation && (
                    <p className="text-[11px] font-bold text-blue-700 mt-0.5">{selectedCompensation}</p>
                  )}
                  <div className="flex flex-wrap justify-center items-center gap-1 mt-2">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">{selectedConfig.label}</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">{selectedDelivery}</span>
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-lime-100 text-lime-800">{selectedPills.length} Accommodations</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 bg-slate-100 p-1 rounded-xl gap-1">
                  {tabButton('overview', 'description', 'Overview')}
                  {tabButton('company', 'domain', 'Company')}
                  {tabButton('barrier', 'verified', 'Barrier-Free')}
                </div>
                {activeTab === 'overview' && (
                  <>
                    <div className="grid grid-cols-3 gap-1.5 bg-slate-50/80 rounded-xl p-2.5 border border-slate-100">
                      <div className="flex flex-col text-left min-w-0">
                        <div className="flex items-center gap-0.5 text-[9px] font-bold text-slate-400 uppercase leading-tight break-words">
                          <span className="material-symbols-outlined text-[12px] text-amber-700 shrink-0">{selectedConfig.typeIcon}</span>
                          <span className="truncate">{selectedConfig.typeLabel}</span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-800 mt-0.5 truncate">{selectedConfig.label}</span>
                      </div>
                      <div className="flex flex-col text-left min-w-0">
                        <div className="flex items-center gap-0.5 text-[9px] font-bold text-slate-400 uppercase leading-tight break-words">
                          <span className="material-symbols-outlined text-[12px] text-blue-600 shrink-0">alarm</span>
                          <span className="truncate">{selectedConfig.deadlineLabel}</span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-800 mt-0.5 truncate">{selectedDeadline || 'Rolling'}</span>
                      </div>
                      <div className="flex flex-col text-left min-w-0">
                        <div className="flex items-center gap-0.5 text-[9px] font-bold text-slate-400 uppercase leading-tight break-words">
                          <span className="material-symbols-outlined text-[12px] text-teal-600 shrink-0">home</span>
                          <span className="truncate">{selectedConfig.startLabel}</span>
                        </div>
                        <span className="text-[10px] font-bold text-slate-800 mt-0.5 truncate">{selectedStart || 'TBD'}</span>
                      </div>
                    </div>
                    <div className="bg-white border border-slate-200/80 rounded-xl p-2.5 flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                          <span className="material-symbols-outlined text-[16px]">{selectedConfig.compensationIcon}</span>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[9px] font-bold text-slate-400 uppercase truncate">{selectedConfig.compensationLabel}</span>
                          <span className="text-[10px] font-bold text-slate-800 truncate">{selectedCompensation || 'Not specified'}</span>
                        </div>
                      </div>
                    {selectedVenue && (
                      <div className="bg-slate-50/80 border border-slate-100 rounded-xl p-2.5 flex items-start gap-2">
                        <span className="material-symbols-outlined text-[16px] text-slate-500 shrink-0">location_on</span>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[9px] font-bold text-slate-400 uppercase">{selectedConfig.venueLabel}</span>
                          <span className="text-[10px] text-slate-700 mt-0.5 leading-snug">{selectedVenue}</span>
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-wide">{selectedConfig.detailsHeading}</h3>
                        <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} className="text-slate-400">
                          <span className="material-symbols-outlined text-[15px]">more_horiz</span>
                        </button>
                      </div>
                      {!expanded ? (
                        <p className="text-[11px] leading-relaxed text-slate-600">
                          {collapsedText.length > 219 ? `${collapsedText}…` : collapsedText || 'No description provided.'}{' '}
                          <button type="button" onClick={() => setExpanded(true)} className="text-blue-600 font-bold">Read More</button>
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          {selectedBlocks.map((block, index) => {
                            if (block.type === 'heading') {
                              return <h4 key={index} className="text-[11px] font-bold text-slate-900">{block.text}</h4>;
                            }
                            if (block.type === 'list') {
                              return (
                                <ul key={index} className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
                                  {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
                                </ul>
                              );
                            }
                            return <p key={index} className="text-[11px] leading-relaxed text-slate-600">{block.text}</p>;
                          })}
                          <button type="button" onClick={() => setExpanded(false)} className="self-start text-blue-600 font-bold text-[11px]">Show less</button>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {activeTab === 'company' && (
                  <div className="flex flex-col gap-2">
                    <div className="bg-slate-50/80 border border-slate-100 rounded-xl p-2.5 flex items-start gap-2">
                      {selectedLogo ? (
                        <img src={selectedLogo} alt={`${selectedOrgName} logo`} className="w-9 h-9 rounded-xl object-cover border border-slate-200 bg-white shrink-0" />
                      ) : (
                        <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center font-bold text-[13px] shrink-0">
                          {getInitials(selectedOrgName)}
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[11px] font-bold text-slate-900 truncate">{selectedOrgName}</span>
                        {selectedOrg?.website ? (
                          <a href={selectedOrg.website} target="_blank" rel="noreferrer" className="text-[10px] font-bold text-blue-600 hover:underline break-all">
                            {selectedOrg.website}
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-500">Website not provided</span>
                        )}
                        <span className="inline-flex w-fit items-center gap-1 text-[9px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full">
                          <span className="material-symbols-outlined text-[11px]">verified</span> Trusted organizer
                        </span>
                      </div>
                    </div>
                    {(selectedCoordinator.name || selectedContact) && (
                      <div className="border border-slate-200/80 rounded-xl p-2.5">
                        <h3 className="text-[10px] font-bold text-slate-900 uppercase tracking-wide flex items-center gap-1">
                          <span className="material-symbols-outlined text-[14px] text-blue-600">support_agent</span>
                          Accessibility coordinator
                        </h3>
                        {selectedCoordinator.name && <p className="text-[11px] font-bold text-slate-800 mt-1">{selectedCoordinator.name}</p>}
                        {selectedContactHref ? (
                          <a href={selectedContactHref} className="text-[10px] font-bold text-blue-600 hover:underline break-all">{selectedContact}</a>
                        ) : selectedContact ? (
                          <p className="text-[10px] text-slate-700">{selectedContact}</p>
                        ) : null}
                        {selectedCoordinator.noticePeriod && (
                          <p className="text-[10px] text-slate-500 mt-0.5">Notice: {selectedCoordinator.noticePeriod}</p>
                        )}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="bg-white border border-slate-200/80 rounded-xl p-2.5">
                        <span className="text-[9px] font-bold text-slate-400 uppercase leading-tight block truncate">{selectedConfig.deadlineLabel}</span>
                        <p className="text-[10px] font-bold text-slate-800 mt-0.5 truncate">{selectedDeadline || 'Rolling'}</p>
                      </div>
                      <div className="bg-white border border-slate-200/80 rounded-xl p-2.5">
                        <span className="text-[9px] font-bold text-slate-400 uppercase leading-tight block truncate">{selectedConfig.startLabel}</span>
                        <p className="text-[10px] font-bold text-slate-800 mt-0.5 truncate">{selectedStart || 'TBD'}</p>
                      </div>
                    </div>
                  </div>
                )}
                {activeTab === 'barrier' && (
                  <div className="flex flex-col gap-2">
                    <div className="border border-lime-200/70 bg-lime-50/40 rounded-xl p-2.5">
                      <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-lime-200/60">
                        <span className="text-[10px] font-bold text-lime-900 uppercase tracking-wider flex items-center gap-1 min-w-0">
                          <span className="material-symbols-outlined text-lime-600 text-[15px] shrink-0">verified_user</span>
                          <span className="truncate">Pre-Audited Accommodations</span>
                        </span>
                        <span className="text-[9px] font-extrabold bg-lime-200 text-lime-900 px-1.5 py-0.5 rounded-full shrink-0">{selectedPills.length} Verified</span>
                      </div>
                      {selectedPills.length > 0 ? (
                        <ul className="space-y-1.5 text-[11px] text-slate-700">
                          {selectedPills.map((pill) => (
                            <li key={pill.key} className="flex items-start gap-1.5">
                              <span className="material-symbols-outlined text-lime-600 text-[14px] shrink-0 mt-0.5">check_circle</span>
                              <span><strong>{pill.label}</strong></span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[11px] text-slate-600">Contact the coordinator for tailored accommodations.</p>
                      )}
                    </div>
                    {noteEntries.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        {noteEntries.map(([area, value]) => (
                          <p key={area} className="text-[11px] leading-relaxed text-slate-600">
                            <strong className="text-slate-800">{area}: </strong>{value}
                          </p>
                        ))}
                      </div>
                    )}
                    {selected?.details?.multimodalSupport && (
                      <p className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200/80 px-2 py-1.5 rounded-xl flex items-start gap-1.5 leading-snug">
                        <span className="material-symbols-outlined text-[14px] shrink-0">videocam</span>
                        Multimodal application supported (video, voice note, or assisted application)
                      </p>
                    )}
                    {(selectedCoordinator.name || selectedContact) && (
                      <div className="border border-slate-200/80 rounded-xl p-2.5">
                        <span className="text-[9px] font-bold text-slate-400 uppercase">Coordinator</span>
                        <p className="text-[11px] font-bold text-slate-800 mt-0.5">
                          {selectedCoordinator.name || 'Access coordinator'}
                          {selectedCoordinator.noticePeriod ? <span className="font-medium text-slate-500"> • {selectedCoordinator.noticePeriod}</span> : ''}
                        </p>
                        {selectedContactHref ? (
                          <a href={selectedContactHref} className="text-[10px] font-bold text-blue-600 hover:underline break-all">{selectedContact}</a>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
                {/* Gemini PWD copilot for THIS listing (mobile, compact) */}
                <OpportunityAiPanel compact {...aiPanelProps} />
                <div className="pt-0.5">
                  <a
                    href={selectedApplyUrl}
                    target={selectedApplyUrl === '#' ? undefined : '_blank'}
                    rel={selectedApplyUrl === '#' ? undefined : 'noreferrer'}
                    className="w-full bg-[#1d4ed8] text-white rounded-full py-2.5 px-4 font-bold text-[13px] flex items-center justify-between"
                  >
                    <span className="pl-1.5">{selectedConfig.cta}</span>
                    <span className="flex items-center text-blue-200">
                      <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                      <span className="material-symbols-outlined text-[16px] -ml-2 text-white">chevron_right</span>
                    </span>
                  </a>
                  {selectedConfig.ctaNote ? (
                    <p className="text-center text-[10px] text-slate-400 mt-1.5 font-medium leading-snug px-2">{selectedConfig.ctaNote}</p>
                  ) : null}
                </div>
              </>
            )}
          </aside>
          {/* END: OpportunityDetailCard */}
          {/* BEGIN: RelatedFeedSection (mobile adaptation of left REGION feed) */}
          <section>
            <div className="flex items-center justify-between gap-1.5 mb-1.5">
              <div className="flex items-center gap-1 shrink-0">
                <h2 className="text-[13px] font-bold text-slate-900 tracking-tight whitespace-nowrap">Related opportunities</h2>
              </div>
              <div className="relative flex min-w-0 flex-1 items-center justify-end gap-1 text-slate-500" data-mobile-sort-root>
                <span className="shrink-0 text-[10px] font-medium">Sort:</span>
                <button onClick={() => setMobileSortOpen((v) => !v)} className="flex min-w-0 max-w-[150px] items-center gap-0.5 overflow-hidden rounded-full px-2 py-1 text-[10px] font-bold text-blue-700 transition-colors hover:bg-slate-100" type="button" aria-expanded={mobileSortOpen} aria-haspopup="listbox">
                  <span className="block min-w-0 flex-1 truncate whitespace-nowrap text-ellipsis">{sortBy}</span>
                  <span className="material-symbols-outlined shrink-0 text-[12px] transition-transform" style={{ transform: mobileSortOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>expand_more</span>
                </button>
                <div className={`${mobileSortOpen ? '' : 'hidden'} absolute right-0 top-full mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden z-30`}>
                  <div className="py-1.5" role="listbox" aria-label="Sort related opportunities">
                    {SORT_OPTIONS.map((opt) => {
                      const isActive = sortBy === opt || (sortBy === 'Highest Accommodation Match' && opt === 'Highest Accommodation');
                      return (
                        <button
                          key={opt}
                          data-sort={opt}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => { setSortBy(opt); setMobileSortOpen(false); }}
                          className={isActive ? 'w-full text-left px-3.5 py-2 text-[11px] leading-[16px] font-bold bg-blue-100 text-blue-700 flex items-center justify-between gap-2' : 'w-full text-left px-3.5 py-2 text-[11px] leading-[16px] font-semibold text-slate-700 hover:bg-slate-50 flex items-center justify-between gap-2'}
                          type="button"
                        >
                          <span className="block min-w-0 flex-1 truncate whitespace-nowrap text-ellipsis">{opt}</span>
                          {isActive ? <span className="material-symbols-outlined shrink-0 text-[14px]">check</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1.5">
              {relatedTags.length === 0 ? (
                <span className="text-[10px] text-slate-400">Tags appear once an opportunity is selected.</span>
              ) : relatedTags.map((chip) => {
                const isActive = activeChip === chip;
                return (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setActiveChip(isActive ? null : chip)}
                    aria-pressed={isActive}
                    className={
                      isActive
                        ? 'px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 flex items-center gap-1 shrink-0 whitespace-nowrap'
                        : 'px-2.5 py-1 rounded-full text-[10px] font-semibold bg-white border border-slate-200 text-slate-600 shrink-0 whitespace-nowrap'
                    }
                  >
                    {chip}
                    {isActive && <span className="material-symbols-outlined text-[12px]">close</span>}
                  </button>
                );
              })}
            </div>
            <div className="mt-1 space-y-2.5">
              {isLoading ? (
                [0, 1, 2].map((skeleton) => (
                  <article key={`m-skeleton-${skeleton}`} aria-busy="true" className="bg-white border border-slate-200/80 rounded-2xl p-3 shadow-card animate-pulse">
                    <div className="h-3 w-24 rounded-full bg-slate-100" />
                    <div className="mt-2 h-5 w-3/4 rounded bg-slate-100" />
                    <div className="mt-2 flex gap-2">
                      <div className="h-5 w-20 rounded-full bg-slate-100" />
                      <div className="h-5 w-24 rounded-full bg-slate-100" />
                    </div>
                  </article>
                ))
              ) : loadError ? (
                <div className="bg-white border border-red-200 rounded-2xl p-3.5 text-center flex flex-col items-center gap-1.5">
                  <span className="material-symbols-outlined text-[24px] text-red-500">cloud_off</span>
                  <h3 className="text-[13px] font-bold text-slate-900">Couldn&apos;t load opportunities</h3>
                  <p className="text-[10px] text-slate-500">Check your connection, then try again.</p>
                  <button
                    type="button"
                    onClick={() => setRetryTick((t) => t + 1)}
                    className="bg-[#1d4ed8] text-white font-semibold text-[10px] px-3 py-1 rounded-full"
                  >
                    Retry
                  </button>
                </div>
              ) : pagedFeed.length === 0 ? (
                <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 text-center flex flex-col items-center gap-1.5">
                  <span className="material-symbols-outlined text-[24px] text-slate-300">search_off</span>
                  <h3 className="text-[13px] font-bold text-slate-900">No related opportunities</h3>
                  <p className="text-[10px] text-slate-500">
                    {opportunities.length === 0 ? 'No opportunities have been published yet.' : 'Try a different search term or category.'}
                  </p>
                </div>
              ) : (
                pagedFeed.map((opp, index) => {
                  const orgName = opp?.basic?.organization?.name || 'Inclusive Employer';
                  const title = opp?.basic?.title || 'Untitled opportunity';
                  const logoUrl = opp?.basic?.organization?.logo?.downloadURL || null;
                  const compensation = String(opp?.logistics?.compensation || '').trim();
                  const pills = getAccommodationPills(opp);
                  const isActive = selected && opp.id === selected.id;
                  const isSaved = bookmarked.includes(opp.id);
                  const avatarStyle = AVATAR_STYLES[index % AVATAR_STYLES.length];
                  return (
                    <article
                      key={opp.id}
                      onClick={() => handleSelect(opp)}
                      className={
                        isActive
                          ? 'bg-white border-2 border-blue-500/80 rounded-2xl p-3 shadow-card ring-2 ring-blue-50 cursor-pointer'
                          : 'bg-white border border-slate-200/80 rounded-2xl p-3 shadow-card cursor-pointer'
                      }
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="flex items-start gap-2 min-w-0">
                          {logoUrl ? (
                            <img src={logoUrl} alt={`${orgName} logo`} loading="lazy" className="w-9 h-9 rounded-xl object-cover bg-slate-50 border border-slate-200/60 shrink-0" />
                          ) : (
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-[13px] shrink-0 ${avatarStyle}`}>
                              {getInitials(orgName)}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1">
                              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide truncate">{orgName}</span>
                              <span className="inline-flex items-center gap-0.5 text-[8px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full shrink-0">
                                <span className="material-symbols-outlined text-[10px]">verified</span> Trusted
                              </span>
                            </div>
                            <h3 className="text-[11px] font-bold text-slate-900 mt-0.5 leading-snug">{title}</h3>
                            <div className="flex flex-wrap items-center gap-1 mt-1">
                              {compensation && (
                                <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">{compensation}</span>
                              )}
                              <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded-full">{formatLocation(opp)}</span>
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          aria-label={`Save ${title}`}
                          aria-pressed={isSaved}
                          onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleBookmark(opp.id); }}
                          className={isSaved ? 'w-8 h-8 rounded-full flex items-center justify-center bg-secondary-container text-on-secondary-fixed shrink-0 transition-colors' : 'w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 text-slate-400 hover:text-blue-600 shrink-0 transition-colors'}
                        >
                          <span className="material-symbols-outlined text-[16px]">
                            {isSaved ? 'bookmark' : 'bookmark_border'}
                          </span>
                        </button>
                      </div>
                      {pills.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1">
                          <span className="text-[9px] font-bold text-lime-700 bg-lime-50 border border-lime-200/80 px-1.5 py-0.5 rounded-full flex items-center gap-1">
                            <span className="material-symbols-outlined text-[11px]">{pills[0].icon}</span> {pills[0].label}
                          </span>
                          {pills.slice(1, 2).map((pill) => (
                            <span key={pill.key} className="text-[9px] font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded-full">
                              {pill.label}
                            </span>
                          ))}
                          {pills.length > 2 && (
                            <span className="text-[9px] font-semibold text-slate-500">+{pills.length - 2} more</span>
                          )}
                        </div>
                      )}
                      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                        <span className="text-[9px] text-slate-400 truncate">{formatPostedAgo(opp)}</span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {isActive && <span className="text-[9px] font-bold text-blue-600">Selected Preview</span>}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleSelect(opp); }}
                            className={
                              isActive
                                ? 'bg-[#1d4ed8] text-white font-semibold text-[10px] px-3 py-1 rounded-full'
                                : 'bg-slate-100 text-slate-700 font-semibold text-[10px] px-3 py-1 rounded-full'
                            }
                          >
                            View details
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
            <nav aria-label="Pagination" className="flex items-center justify-center gap-1 pt-3 pb-1">
              <button
                type="button"
                disabled={safePage === 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-white border border-slate-200 text-slate-600 flex items-center gap-0.5 disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[14px]">chevron_left</span>
                Previous
              </button>
              <div className="flex items-center gap-0.5">
                {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 3).map((page) => (
                  <button
                    key={page}
                    type="button"
                    aria-current={safePage === page ? 'page' : undefined}
                    onClick={() => setCurrentPage(page)}
                    className={
                      safePage === page
                        ? 'w-6 h-6 rounded-full text-[10px] font-bold bg-[#1d4ed8] text-white'
                        : 'w-6 h-6 rounded-full text-[10px] font-semibold text-slate-600'
                    }
                  >
                    {page}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={safePage === totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-white border border-slate-200 text-slate-600 flex items-center gap-0.5 disabled:opacity-50"
              >
                Next
                <span className="material-symbols-outlined text-[14px]">chevron_right</span>
              </button>
            </nav>
          </section>
          {/* END: RelatedFeedSection */}
        </main>
        {/* Spacer so the fixed mobile bottom nav never covers content */}
        <div className="h-20 lg:hidden" aria-hidden="true" />
      </div>
      {/* Mobile bottom nav on all pages except landing */}
      <MobileBottomNav
        active="browse"
        onBrowse={() => {
          if (typeof onBrowse === 'function') onBrowse();
          else handleBack();
        }}
        onPost={handlePostOpportunity}
        onSaved={() => {
          if (typeof onSaved === 'function') onSaved();
          else handleBack();
        }}
        onProfile={() => {
          if (typeof onEditProfile === 'function') onEditProfile();
        }}
      />
      {/* Ask Able — floating voice-first Gemini guide (whole-catalogue).
          SUGGEST lines from the model auto-apply as AI smart search. */}
      <AIAssistant
        opportunities={opportunities}
        visibleCount={filteredFeed.length}
        visibleTitles={pagedFeed.slice(0, 5).map((o) => o?.basic?.title || 'Untitled')}
        onApplySuggestion={(suggestion) => handleAiFind(suggestion)}
      />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default Details;
