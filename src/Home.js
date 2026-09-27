/* eslint-disable jsx-a11y/anchor-is-valid -- href="#" anchors kept verbatim from Home.html for 1:1 UI fidelity */
/* eslint-disable jsx-a11y/anchor-is-valid -- href="#" anchors kept verbatim from Home.html for 1:1 UI fidelity */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Details from './Details';
import SubmissionForm from './SubmissionForm';
import Signup from './Signup';
import {
  ACCESSIBILITY_FEATURE_KEYS,
  INITIAL_OPPORTUNITY_FORM,
  deleteOpportunity,
  opportunityToFormValues,
  submitOpportunity,
  subscribeOpportunities,
  updateOpportunity,
  validateOpportunityForm,
} from './services/opportunities';
import { onValue, ref as dbRef, remove as dbRemove, set as dbSet } from 'firebase/database';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from './firebase';
import AIAssistant from './components/AIAssistant';
import { parseNaturalLanguageQuery, summarizeOpportunity } from './services/gemini';

// Speak any text aloud (screen-reader / low-vision support). Returns true if started.
function speakText(text) {
  try {
    if (!('speechSynthesis' in window)) return false;
    window.speechSynthesis.cancel();
    const clean = String(text || '').slice(0, 1200);
    if (!clean.trim()) return false;
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(clean));
    return true;
  } catch (error) {
    return false;
  }
}

/* ------------------------------------------------------------------
 * Home — React port of src/Home.html.
 * Every Tailwind className below is verbatim from the HTML version, and
 * tailwind.config.js tokens were aligned with the HTML <script
 * id="tailwind-config"> so the rendered UI matches pixel-for-pixel.
 * State only drives behaviour (search / filters / sort / bookmarks /
 * pagination / a11y toggles); default state reproduces the HTML exactly.
 * ------------------------------------------------------------------ */

// Exact <style> block from Home.html <head> (base reset + hidden scrollbar).
const FIDELITY_STYLES = `@layer base{html,body{margin:0;padding:0;}body{overscroll-behavior:none;}main>:first-child{margin-top:0!important;}main>:last-child{margin-bottom:0!important;}}::-webkit-scrollbar{display:none;}`;

const A11Y_BTN =
  'p-1.5 rounded-full hover:bg-surface-container hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary-container transition-all';
const ACTIVE_A11Y_BTN = `${A11Y_BTN} bg-secondary-container text-on-secondary-fixed`;

const QUICK_FILTER =
  'px-space-md py-2 rounded-full font-label-md text-label-md text-on-surface bg-surface-container-low hover:bg-surface-container transition-colors whitespace-nowrap flex items-center gap-1.5';
const ACTIVE_QUICK_FILTER =
  'px-space-md py-2 rounded-full font-label-md text-label-md font-bold bg-primary text-on-primary shadow-sm whitespace-nowrap';

const QUICK_FILTERS = [
  { label: 'All Opportunities', icon: null, iconClass: null },
  { label: 'Job/Internship', icon: 'work', iconClass: 'text-primary' },
  { label: 'Event/Webinar', icon: 'event', iconClass: 'text-secondary' },
  { label: 'Grant/Funding', icon: 'payments', iconClass: 'text-primary' },
  { label: 'Training/Fellowship', icon: 'school', iconClass: 'text-secondary' },
];

// Opportunity-type quick filter -> RTDB `basic.category` value.
const QUICK_FILTER_CATEGORY = {
  'Job/Internship': 'job',
  'Event/Webinar': 'event',
  'Grant/Funding': 'grant',
  'Training/Fellowship': 'training',
};

const SORT_OPTIONS = ['Most Relevant', 'Newest', 'Highest Accommodation'];

// Mobile-only constants — converted verbatim from HomeMobile.html
const MOBILE_SORT_OPTIONS = ['Most Relevant', 'Newest', 'Highest Accommodation'];

const MOBILE_QUICK_PILLS = [
  { label: 'All Opportunities', icon: 'all_inclusive', iconClass: null },
  { label: 'Job/Internship', icon: 'work', iconClass: 'text-secondary' },
  { label: 'Event/Webinar', icon: 'event', iconClass: 'text-primary' },
  { label: 'Grant/Funding', icon: 'payments', iconClass: 'text-secondary' },
  { label: 'Training/Fellowship', icon: 'school', iconClass: 'text-primary' },
];

const MOBILE_FILTER_PILLS = [
  { key: 'all', label: 'All Opportunities', icon: 'all_inclusive' },
  { key: 'job', label: 'Job/Internship', icon: 'work', iconClass: 'text-primary', quickKey: 'Job/Internship' },
  { key: 'event', label: 'Event/Webinar', icon: 'event', iconClass: 'text-secondary', quickKey: 'Event/Webinar' },
  { key: 'grant', label: 'Grant/Funding', icon: 'payments', iconClass: 'text-primary', quickKey: 'Grant/Funding' },
  { key: 'training', label: 'Training/Fellowship', icon: 'school', iconClass: 'text-secondary', quickKey: 'Training/Fellowship' },
];

const PAGE_SIZE = 6;

// Category metadata for the RTDB `basic.category` enum:
// job | event | grant | training | public (aid alias)
const CATEGORY_META = {
  job: { label: 'Job/Internship', icon: 'work' },
  event: { label: 'Event/Webinar', icon: 'event' },
  grant: { label: 'Grant/Funding', icon: 'payments' },
  training: { label: 'Training/Fellowship', icon: 'school' },
  public: { label: 'Public Program', icon: 'campaign' },
  aid: { label: 'Aid', icon: 'volunteer_activism' },
};

// Human labels for the RTDB `accessibility.features` boolean map.
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

// Rotate avatar backgrounds so dynamic cards keep the variedDummy look.
const AVATAR_STYLES = [
  'bg-primary-fixed text-on-primary-fixed',
  'bg-secondary-container text-on-secondary-fixed',
  'bg-tertiary-fixed text-on-tertiary-fixed',
  'bg-secondary-container/70 text-on-secondary-fixed',
  'bg-primary-fixed/60 text-primary',
  'bg-secondary text-on-secondary',
];

function getInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'OP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getCategoryMeta(category) {
  return CATEGORY_META[category] || { label: String(category || 'Opportunity'), icon: 'work' };
}

// "Apply by" vs "Register by" per category:
// job + grant -> Apply; event + training + aid/public -> Register.
function getDeadlineVerb(category) {
  const normalized = String(category || '').trim().toLowerCase();
  if (normalized === 'event' || normalized === 'training' || normalized === 'public' || normalized === 'aid') {
    return 'Register by';
  }
  return 'Apply by';
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
  if (days < 30) {
    const weeks = Math.floor(days / 7);
    return `Posted ${weeks} week${weeks === 1 ? '' : 's'} ago`;
  }
  const date = new Date(ts);
  return `Posted ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function formatReadableDate(isoDate) {
  if (!isoDate) return null;
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function shorten(text, max = 48) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trimEnd()}…`;
}

function formatLocation(opportunity) {
  const mode = opportunity?.logistics?.deliveryMode;
  const venue = String(opportunity?.logistics?.venueAddress || '').trim();
  if (mode === 'remote') return '100% Remote';
  if (mode === 'hybrid') return venue ? `Hybrid • ${shorten(venue, 42)}` : 'Hybrid';
  if (mode === 'onsite') return venue ? shorten(venue, 48) : 'On-site';
  return venue ? shorten(venue, 48) : 'Location TBD';
}

function formatDeliveryLabel(deliveryMode) {
  if (deliveryMode === 'remote') return 'Remote';
  if (deliveryMode === 'hybrid') return 'Hybrid';
  if (deliveryMode === 'onsite') return 'On-site';
  return deliveryMode ? String(deliveryMode) : '';
}

// Numeric value used for "Salary (High to Low)" sorting. "Free" -> 0,
// missing/unparseable -> -1 so it sorts last.
function parseCompensationValue(compensation) {
  const text = String(compensation || '').trim().toLowerCase();
  if (!text) return -1;
  if (text === 'free') return 0;
  const matches = text.replace(/,/g, '').match(/\d+(\.\d+)?/g);
  if (!matches) return -1;
  return Math.max(...matches.map(Number));
}

// ------------------------------------------------------------------
// Schema-aware search matching.
//
// Root-cause fix for "AI Find returns 0 even when matches exist":
// the old code did `haystack.includes(wholeQuery)` which requires the
// entire multi-word AI keyword string (e.g. "remote screen reader
// support") to appear contiguously in the corpus. Individual schema
// words are scattered across basic/logistics/details/accessibility, so
// the exact phrase never matches.
//
// Instead we tokenize the query and score each opportunity against the
// RTDB schema corpus (buildHaystack). Plurals ("jobs" vs "job") are
// normalized so AI/category words still match `basic.category`.
// Callers prefer full (AND) matches but fall back to partial (OR)
// matches so existing opportunities are actually displayed.
// ------------------------------------------------------------------
const SEARCH_STOPWORDS = new Set([
  'find', 'show', 'with', 'from', 'that', 'this', 'have', 'has', 'are',
  'was', 'were', 'please', 'need', 'want', 'looking', 'search', 'filter',
  'opportunity', 'opportunities', 'something', 'anything', 'role', 'roles',
  'please',
]);

function singularVariants(token) {
  const variants = new Set([token]);
  if (token.length > 3 && token.endsWith('ies')) {
    variants.add(`${token.slice(0, -3)}y`);
  }
  if (token.length > 3 && token.endsWith('s')) {
    variants.add(token.slice(0, -1));
  }
  if (token.length > 4 && token.endsWith('es')) {
    variants.add(token.slice(0, -2));
  }
  // Light stemming so "funding" matches "fund", "training" matches "train".
  if (token.length > 5 && token.endsWith('ing')) {
    variants.add(token.slice(0, -3));
    variants.add(`${token.slice(0, -3)}e`);
  }
  if (token.length > 4 && token.endsWith('ed')) {
    variants.add(token.slice(0, -2));
    variants.add(token.slice(0, -1));
  }
  // Plural forms so singular query tokens also match plural corpus text.
  variants.add(`${token}s`);
  return [...variants];
}

function tokenizeSearchQuery(query) {
  return String(query || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !SEARCH_STOPWORDS.has(w));
}

function tokenMatchesHaystack(haystack, token) {
  if (!token || !haystack) return false;
  if (haystack.includes(token)) return true;
  return singularVariants(token).some((variant) => haystack.includes(variant));
}

function getSearchScore(opportunity, tokens) {
  if (!tokens.length) return 0;
  const haystack = buildHaystack(opportunity);
  // Fast path: exact phrase still counts as a full match.
  if (tokens.length > 1 && haystack.includes(tokens.join(' '))) return tokens.length;
  let score = 0;
  tokens.forEach((token) => {
    if (tokenMatchesHaystack(haystack, token)) score += 1;
  });
  return score;
}

function matchesSearchQuery(opportunity, rawQuery) {
  const tokens = tokenizeSearchQuery(rawQuery);
  if (!tokens.length) {
    // Query was only stopwords/punctuation — don't filter anything out.
    // If the raw text was non-empty but meaningless, treat as no-op rather
    // than returning 0 results.
    const raw = String(rawQuery || '').trim();
    if (!raw) return true;
    if (/^[a-z0-9\s]+$/i.test(raw) && tokens.length === 0) return true;
    return buildHaystack(opportunity).includes(raw.toLowerCase());
  }
  return getSearchScore(opportunity, tokens) === tokens.length;
}

// Lowercase search corpus built from every user-facing schema field, plus
// synthetic keywords so the quick-filter pills keep working on live data.
function buildHaystack(opportunity) {
  const features = opportunity?.accessibility?.features || {};
  const notes = opportunity?.accessibility?.notes || {};
  const parts = [
    opportunity?.basic?.title,
    opportunity?.basic?.organization?.name,
    opportunity?.basic?.organization?.website,
    opportunity?.basic?.category,
    opportunity?.logistics?.deliveryMode,
    opportunity?.logistics?.venueAddress,
    opportunity?.logistics?.compensation,
    opportunity?.logistics?.applicationDeadline,
    opportunity?.logistics?.startDate,
    opportunity?.details?.descriptionMarkdown,
    opportunity?.details?.applicationUrl,
    Object.values(notes).filter(Boolean).join(' '),
    Object.entries(features)
      .filter(([, enabled]) => enabled === true)
      .map(([key]) => `${key.replace(/_/g, ' ')} ${FEATURE_META[key]?.label || ''}`)
      .join(' '),
  ];
  if (features.screen_reader_docs) parts.push('screen reader nvda jaws magnifier');
  if (features.sli_support) parts.push('asl sign language deaf ksl');
  if (features.mobility_stepfree || features.mobility_restrooms || features.mobility_parking) {
    parts.push('wheelchair step-free mobility accessible parking restrooms');
  }
  if (opportunity?.logistics?.deliveryMode === 'remote') parts.push('remote');
  if (features.quiet_room || features.camera_optional || features.pre_agenda) {
    parts.push('neurodivergent neurodiversity autistic sensory quiet asynchronous flexible');
  }
  if (features.audio_descriptions || features.cart_captions || features.braille_materials || features.hearing_loop) {
    parts.push('ergonomic speech-to-text captioning transcription relay contrast assistive tech captions');
  }
  return parts.filter(Boolean).join(' ').toLowerCase();
}

const QUICK_FILTER_KEYWORDS = {
  'All Opportunities': null,
  'Job/Internship': null,
  'Event/Webinar': null,
  'Grant/Funding': null,
  'Training/Fellowship': null,
  'Screen Reader Verified': ['screen reader', 'nvda', 'jaws', 'magnifier'],
  'ASL Fluent / Provided': ['asl'],
  'ASL Interpreters': ['asl'],
  'Wheelchair Accessible': ['wheelchair', 'step-free'],
  '100% Remote': ['remote'],
  'Neurodiversity Friendly': ['neurodivergent', 'neurodiversity', 'autistic', 'sensory', 'quiet', 'asynchronous'],
  'Neurodivergent Friendly': ['neurodivergent', 'neurodiversity', 'autistic', 'sensory', 'quiet', 'asynchronous'],
  'Assistive Tech Provided': ['ergonomic', 'speech-to-text', 'captioning', 'transcription', 'relay', 'contrast'],
  'Flexible Hours': ['flexible', 'quiet', 'asynchronous'],
};

const SAVED_RTDB_PATH = 'saved';
const A11Y_STORAGE_KEY = 'accessable.a11y.v1';

function readStored(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Storage is best-effort (private mode, quota, non-browser env).
  }
}

// Sidebar faceted-filter predicates. Labels are verbatim from the HTML port;
// each predicate maps its label onto the RTDB schema (opportunities_schema.json).

function matchesTypeFilter(opportunity, label) {
  const category = String(opportunity?.basic?.category || '').trim().toLowerCase();
  if (label === 'Job/Internship') return category === 'job';
  if (label === 'Event/Webinar') return category === 'event';
  if (label === 'Grant/Funding') return category === 'grant';
  if (label === 'Training/Fellowship') return category === 'training';
  if (label === 'Public Program / Aid') return category === 'public' || category === 'aid';
  return true;
}

function matchesAccommodationFilter(opportunity, label) {
  const features = opportunity?.accessibility?.features || {};
  if (label === 'Screen Reader Compatible') return features.screen_reader_docs === true;
  if (label === 'Wheelchair / Step-Free') {
    return (
      features.mobility_stepfree === true ||
      features.mobility_restrooms === true ||
      features.mobility_parking === true
    );
  }
  if (label === 'ASL / CART Interpreting') {
    return features.sli_support === true || features.cart_captions === true;
  }
  if (label === 'Flexible Hours / Rest Breaks') {
    return (
      features.camera_optional === true ||
      features.quiet_room === true ||
      features.pre_agenda === true
    );
  }
  if (label === 'Neurodivergent Friendly') {
    return (
      features.quiet_room === true ||
      features.camera_optional === true ||
      features.pre_agenda === true
    );
  }
  // Individual accommodation benefits (deduped FEATURE_META labels/keys).
  // Lets the faceted Accommodations section list every benefit found in
  // posted opportunities without redundant grouped entries.
  const normalized = String(label || '').trim().toLowerCase();
  const directKey = FEATURE_ORDER.find(
    (key) => key.toLowerCase() === normalized || (FEATURE_META[key]?.label || '').toLowerCase() === normalized
  );
  if (directKey) return features[directKey] === true;
  return true;
}

function matchesWorkModeFilter(opportunity, label) {
  const mode = opportunity?.logistics?.deliveryMode;
  if (label === 'Remote Only') return mode === 'remote';
  if (label === 'Hybrid') return mode === 'hybrid';
  if (label === 'On-site Verified') return mode === 'onsite';
  return true;
}

// Compensation buckets derived from `logistics.compensation` in the
// opportunities export: Free (contains "free"), Grant (contains "grant"),
// Paid / Stipend (numeric value that is neither free nor grant).
function getCompensationBucket(opportunity) {
  const text = String(opportunity?.logistics?.compensation || '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('grant')) return 'Grant Award';
  if (text.includes('free')) return 'Free';
  if (/\d/.test(text)) return 'Paid / Stipend';
  return 'Other';
}

function matchesCompensationFilter(opportunity, label) {
  const bucket = getCompensationBucket(opportunity);
  if (label === 'Free') return bucket === 'Free';
  if (label === 'Paid / Stipend') return bucket === 'Paid / Stipend';
  if (label === 'Grant Award') return bucket === 'Grant Award';
  return true;
}

function matchesSupportFilter(opportunity, label) {
  if (label === 'Multimodal Applications') return opportunity?.details?.multimodalSupport === true;
  return true;
}

// Deduped accommodation benefits actually present in posted opportunities.
// Returns FEATURE_ORDER entries (key/label/icon + live count), so the
// faceted Accommodations section never shows redundant or empty options.
function getAvailableAccommodations(opportunities) {
  const list = Array.isArray(opportunities) ? opportunities : [];
  const counts = {};
  FEATURE_ORDER.forEach((key) => {
    counts[key] = 0;
  });
  list.forEach((opp) => {
    const features = opp?.accessibility?.features || {};
    FEATURE_ORDER.forEach((key) => {
      if (features[key] === true) counts[key] += 1;
    });
  });
  const withData = FEATURE_ORDER.filter((key) => counts[key] > 0).map((key) => ({
    key,
    label: FEATURE_META[key]?.label || key,
    icon: FEATURE_META[key]?.icon || 'check',
    count: counts[key],
  }));
  // Fallback to the full catalogue before live data loads (or when empty),
  // so the section never renders blank.
  if (withData.length > 0) return withData;
  return FEATURE_ORDER.map((key) => ({
    key,
    label: FEATURE_META[key]?.label || key,
    icon: FEATURE_META[key]?.icon || 'check',
    count: 0,
  }));
}

const INFO_CONTENT = {
  'employer-guide': {
    title: 'Employer Guide',
    paragraphs: [
      'Post roles, events, grants, trainings, and public programs with accommodations declared up front — screen-reader tested materials, KSL/ASL interpretation, CART captions, step-free venues, and quiet rooms where relevant.',
      'Every listing names an accessibility coordinator with a direct contact and a notice period, so candidates can request adjustments before they apply, not after.',
      'Use the Post an Opportunity button to submit a listing. New submissions enter review with the status pending_review and appear in the catalogue immediately.',
    ],
  },
  'universal-statement': {
    title: 'Universal Access Statement',
    paragraphs: [
      'AccessAble verifies that advertised opportunities meet WCAG 2.2 AA and ADA-aligned practices: full keyboard operability, meaningful alt text, captioned media, and flexible participation modes.',
      'Accommodation badges on each card are drawn live from the listing data — only features the organizer confirmed are shown.',
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    paragraphs: [
      'Browsing, searching, filtering, and display preferences happen on your device. Display preferences are stored in your browser local storage. Saved bookmarks are stored in Firebase Realtime Database under your account (`saved/{uid}`) so they stay in sync across your devices.',
      'Opportunity listings you submit (including organization logos) are stored in Firebase Realtime Database and Cloud Storage so they can be shared publicly in the catalogue.',
    ],
  },
  terms: {
    title: 'Terms of Use',
    paragraphs: [
      'Listings must be truthful about accommodations, contacts, deadlines, and compensation. Do not post discriminatory, misleading, or unlawful content.',
      'Applying happens on the organizer website via the Apply Now link. AccessAble does not guarantee selection outcomes.',
    ],
  },
};

const FORM_CATEGORY_OPTIONS = [
  { value: 'job', icon: 'work', label: 'Job / Internship' },
  { value: 'event', icon: 'event', label: 'Event / Webinar' },
  { value: 'grant', icon: 'payments', label: 'Grant / Funding' },
  { value: 'training', icon: 'school', label: 'Training / Fellowship' },
  { value: 'aid', icon: 'campaign', label: 'Public Program / Aid' },
];

const FORM_DELIVERY_OPTIONS = [
  { value: 'remote', icon: 'language', label: '100% Remote' },
  { value: 'onsite', icon: 'location_city', label: 'On-Site' },
  { value: 'hybrid', icon: 'sync_alt', label: 'Hybrid' },
];

// Minimal markdown renderer for the details dialog: headings, bullets,
// numbered items, and paragraphs.
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

const BOOKMARK_IDLE =
  'w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-full bg-surface-container-low hover:bg-secondary-container text-on-surface hover:text-on-secondary-fixed transition-colors';
const BOOKMARK_ACTIVE =
  'w-10 h-10 shrink-0 inline-flex items-center justify-center rounded-full bg-secondary-container text-on-secondary-fixed transition-colors';

const PAGINATION_ACTIVE =
  'w-10 h-10 rounded-full font-label-md text-label-md font-bold bg-primary text-on-primary flex items-center justify-center shadow-sm';
const PAGINATION_IDLE =
  'w-10 h-10 rounded-full font-label-md text-label-md text-on-surface hover:bg-surface-container-low flex items-center justify-center transition-colors';

function toggleInList(setter, value) {
  setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
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

function DialogShell({ label, onClose, maxWidth = 'max-w-2xl', children }) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = setTimeout(() => {
      const target = panelRef.current?.querySelector('[data-autofocus]') || panelRef.current;
      target?.focus();
    }, 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(timer);
    };
  }, []);
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6" onClick={onClose} role="presentation">
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={`relative max-h-[92vh] w-full ${maxWidth} overflow-y-auto rounded-t-3xl bg-surface-container-lowest shadow-2xl focus:outline-none sm:rounded-3xl`}
      >
        {children}
      </div>
    </div>
  );
}

const FORM_INPUT =
  'w-full rounded-xl border bg-surface px-4 py-2.5 font-body-md text-body-md text-on-surface placeholder:text-outline focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary-fixed';
const FORM_INPUT_ERROR = 'border-error';
const FORM_INPUT_OK = 'border-outline-variant';
const FORM_LABEL = 'font-label-md text-label-md font-bold text-on-surface';
const FORM_ERROR_TEXT = 'text-xs text-error font-medium';
const FORM_HELP_TEXT = 'text-xs text-on-surface-variant';

function OpportunityFormModal({ mode, opportunity, onClose, onSaved }) {
  const isEdit = mode === 'edit';
  const [form, setForm] = useState(() =>
    isEdit && opportunity ? opportunityToFormValues(opportunity) : { ...INITIAL_OPPORTUNITY_FORM }
  );
  const [errors, setErrors] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const fileInputRef = useRef(null);
  const existingLogo = isEdit ? opportunity?.basic?.organization?.logo || null : null;

  useEffect(() => {
    return () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    };
  }, [logoPreview]);

  const setField = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleText = (name) => (event) => setField(name, event.target.value);
  const handleCheck = (name) => (event) => setField(name, event.target.checked);

  const handleLogoSelect = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setRemoveLogo(false);
    setErrors((prev) => ({ ...prev, logo: undefined }));
    event.target.value = '';
  };

  const fieldError = (name) => (submitAttempted ? errors[name] : undefined);
  const inputClass = (name) => `${FORM_INPUT} ${fieldError(name) ? FORM_INPUT_ERROR : FORM_INPUT_OK}`;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSubmitAttempted(true);
    const validation = validateOpportunityForm(form);
    if (logoFile && logoFile.size > 5 * 1024 * 1024) {
      validation.logo = 'Logo must be 5MB or smaller.';
    }
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      setSubmitError('Please fix the highlighted fields before submitting.');
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (isEdit) {
        await updateOpportunity(opportunity.id, form, { logoFile, removeLogo });
        onSaved(opportunity.id, 'edit');
      } else {
        const id = await submitOpportunity(form, logoFile);
        onSaved(id, 'create');
      }
    } catch (error) {
      console.error('Opportunity save failed:', error);
      setSubmitError(error?.message || 'Saving failed. Check your connection and database rules, then try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogShell label={isEdit ? 'Edit opportunity' : 'Post an opportunity'} onClose={onClose} maxWidth="max-w-3xl">
      <form onSubmit={handleSubmit} noValidate>
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-surface-container bg-surface-container-lowest/95 px-space-lg py-4 backdrop-blur">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary text-[24px]" aria-hidden="true">
              {isEdit ? 'edit' : 'post_add'}
            </span>
            <div>
              <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                {isEdit ? 'Edit opportunity' : 'Post an opportunity'}
              </h2>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                {isEdit
                  ? 'Changes replace the live listing immediately.'
                  : 'New listings enter review and appear in the catalogue.'}
              </p>
            </div>
          </div>
          <button
            aria-label="Close dialog"
            className="rounded-full p-2 hover:bg-surface-container transition-colors"
            onClick={onClose}
            type="button"
          >
            <span className="material-symbols-outlined text-[22px]" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-6 px-space-lg py-space-md">
          {submitError && (
            <div role="alert" className="flex items-start gap-2 rounded-xl bg-error-container px-4 py-3 text-on-error-container">
              <span className="material-symbols-outlined text-[20px]" aria-hidden="true">error</span>
              <p className="font-body-sm text-body-sm font-medium">{submitError}</p>
            </div>
          )}

          <section className="flex flex-col gap-4">
            <h3 className="font-label-lg text-label-lg font-bold text-primary">1. Basics</h3>
            <div className="flex flex-col gap-1.5">
              <label className={FORM_LABEL} htmlFor="opp-form-title">Opportunity title *</label>
              <input
                id="opp-form-title"
                data-autofocus
                className={inputClass('opportunityTitle')}
                maxLength={120}
                onChange={handleText('opportunityTitle')}
                placeholder="e.g. Junior Frontend Developer (Remote)"
                value={form.opportunityTitle}
                aria-invalid={fieldError('opportunityTitle') ? true : undefined}
              />
              {fieldError('opportunityTitle') && <span className={FORM_ERROR_TEXT}>{fieldError('opportunityTitle')}</span>}
            </div>
            <fieldset>
              <legend className={FORM_LABEL}>Category *</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {FORM_CATEGORY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-4 py-2 font-label-md text-label-md transition-colors ${
                      form.category === option.value
                        ? 'border-primary bg-primary-fixed text-on-primary-fixed font-bold'
                        : 'border-outline-variant text-on-surface-variant hover:border-primary'
                    }`}
                  >
                    <input
                      className="sr-only"
                      checked={form.category === option.value}
                      name="opp-category"
                      onChange={() => setField('category', option.value)}
                      type="radio"
                      value={option.value}
                    />
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{option.icon}</span>
                    {option.label}
                  </label>
                ))}
              </div>
              {fieldError('category') && <span className={FORM_ERROR_TEXT}>{fieldError('category')}</span>}
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className={FORM_LABEL} htmlFor="opp-form-org">Organization *</label>
                <input
                  id="opp-form-org"
                  className={inputClass('orgName')}
                  onChange={handleText('orgName')}
                  placeholder="Kenya Inclusive Tech Trust"
                  value={form.orgName}
                  aria-invalid={fieldError('orgName') ? true : undefined}
                />
                {fieldError('orgName') && <span className={FORM_ERROR_TEXT}>{fieldError('orgName')}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={FORM_LABEL} htmlFor="opp-form-org-url">Organization website</label>
                <input
                  id="opp-form-org-url"
                  className={inputClass('orgUrl')}
                  inputMode="url"
                  onChange={handleText('orgUrl')}
                  placeholder="https://example.org"
                  value={form.orgUrl}
                  aria-invalid={fieldError('orgUrl') ? true : undefined}
                />
                {fieldError('orgUrl') && <span className={FORM_ERROR_TEXT}>{fieldError('orgUrl')}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={FORM_LABEL} id="opp-form-logo-label">Organization logo</span>
              <div className="flex flex-wrap items-center gap-3">
                {logoPreview ? (
                  <img src={logoPreview} alt="New logo preview" className="h-12 w-12 rounded-2xl border border-outline-variant object-cover" />
                ) : existingLogo && !removeLogo ? (
                  <img src={existingLogo.downloadURL} alt="Current logo" className="h-12 w-12 rounded-2xl border border-outline-variant object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-container font-bold text-on-surface-variant">
                    <span className="material-symbols-outlined" aria-hidden="true">image</span>
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <span className="font-body-sm text-body-sm text-on-surface">
                    {logoFile ? logoFile.name : existingLogo && !removeLogo ? existingLogo.name || 'Current logo kept' : 'No logo'}
                  </span>
                  <div className="flex flex-wrap gap-3">
                    <button className="font-label-sm text-label-sm font-bold text-primary hover:underline" onClick={() => fileInputRef.current?.click()} type="button">
                      {logoFile || existingLogo ? 'Replace' : 'Upload'} (SVG/PNG/JPG, max 5MB)
                    </button>
                    {(logoFile || (existingLogo && !removeLogo)) && (
                      <button
                        className="font-label-sm text-label-sm font-bold text-error hover:underline"
                        onClick={() => {
                          if (logoPreview) URL.revokeObjectURL(logoPreview);
                          setLogoFile(null);
                          setLogoPreview(null);
                          if (existingLogo) setRemoveLogo(true);
                        }}
                        type="button"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
                <input ref={fileInputRef} accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg" className="sr-only" onChange={handleLogoSelect} type="file" aria-labelledby="opp-form-logo-label" />
              </div>
              {removeLogo && !logoFile && <span className={FORM_HELP_TEXT}>The current logo will be removed on save.</span>}
              {submitAttempted && errors.logo && <span className={FORM_ERROR_TEXT}>{errors.logo}</span>}
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="font-label-lg text-label-lg font-bold text-primary">2. Logistics &amp; dates</h3>
            <fieldset>
              <legend className={FORM_LABEL}>Delivery mode *</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {FORM_DELIVERY_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-4 py-2 font-label-md text-label-md transition-colors ${
                      form.deliveryMode === option.value
                        ? 'border-primary bg-primary-fixed text-on-primary-fixed font-bold'
                        : 'border-outline-variant text-on-surface-variant hover:border-primary'
                    }`}
                  >
                    <input
                      className="sr-only"
                      checked={form.deliveryMode === option.value}
                      name="opp-delivery"
                      onChange={() => setField('deliveryMode', option.value)}
                      type="radio"
                      value={option.value}
                    />
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{option.icon}</span>
                    {option.label}
                  </label>
                ))}
              </div>
              {fieldError('deliveryMode') && <span className={FORM_ERROR_TEXT}>{fieldError('deliveryMode')}</span>}
            </fieldset>
            {form.deliveryMode !== 'remote' && (
              <div className="flex flex-col gap-1.5">
                <label className={FORM_LABEL} htmlFor="opp-form-venue">Venue address *</label>
                <input
                  id="opp-form-venue"
                  className={inputClass('venueAddress')}
                  onChange={handleText('venueAddress')}
                  placeholder="Building, street, city + step-free entry directions"
                  value={form.venueAddress}
                />
                {fieldError('venueAddress') && <span className={FORM_ERROR_TEXT}>{fieldError('venueAddress')}</span>}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <fieldset>
                <legend className={FORM_LABEL}>Application deadline *</legend>
                <div className="mt-1.5 flex gap-2">
                  {[
                    ['deadlineDay', 'DD', '2'],
                    ['deadlineMonth', 'MM', '2'],
                    ['deadlineYear', 'YYYY', '4'],
                  ].map(([name, placeholder, maxLength]) => (
                    <input
                      key={name}
                      aria-label={`Deadline ${placeholder}`}
                      className={inputClass('applicationDeadline')}
                      inputMode="numeric"
                      maxLength={Number(maxLength)}
                      onChange={handleText(name)}
                      placeholder={placeholder}
                      value={form[name]}
                    />
                  ))}
                </div>
                {fieldError('applicationDeadline') && <span className={FORM_ERROR_TEXT}>{fieldError('applicationDeadline')}</span>}
              </fieldset>
              <fieldset>
                <legend className={FORM_LABEL}>Start date (optional)</legend>
                <div className="mt-1.5 flex gap-2">
                  {[
                    ['startDay', 'DD', '2'],
                    ['startMonth', 'MM', '2'],
                    ['startYear', 'YYYY', '4'],
                  ].map(([name, placeholder, maxLength]) => (
                    <input
                      key={name}
                      aria-label={`Start ${placeholder}`}
                      className={inputClass('startDate')}
                      inputMode="numeric"
                      maxLength={Number(maxLength)}
                      onChange={handleText(name)}
                      placeholder={placeholder}
                      value={form[name]}
                    />
                  ))}
                </div>
                {fieldError('startDate') && <span className={FORM_ERROR_TEXT}>{fieldError('startDate')}</span>}
              </fieldset>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={FORM_LABEL} htmlFor="opp-form-comp">Compensation</label>
              <input
                id="opp-form-comp"
                className={inputClass('compensation')}
                onChange={handleText('compensation')}
                placeholder="e.g. Ksh 75,000 / month, Free, Ksh 500,000 grant"
                value={form.compensation}
              />
              <span className={FORM_HELP_TEXT}>Shown as the pay badge on the card. Leave empty if not applicable.</span>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="font-label-lg text-label-lg font-bold text-primary">3. Accessibility</h3>
            <fieldset>
              <legend className={FORM_LABEL}>Confirmed accommodations</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {ACCESSIBILITY_FEATURE_KEYS.map((key) => (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 font-label-sm text-label-sm transition-colors ${
                      form[key]
                        ? 'border-primary bg-secondary-container/40 text-on-secondary-fixed font-bold'
                        : 'border-outline-variant text-on-surface-variant hover:border-primary'
                    }`}
                  >
                    <input checked={!!form[key]} className="accent-primary" onChange={handleCheck(key)} type="checkbox" />
                    <span className="material-symbols-outlined text-[16px]" aria-hidden="true">{FEATURE_META[key]?.icon || 'check'}</span>
                    {FEATURE_META[key]?.label || key}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {[
                ['mobilityNotes', 'Mobility notes'],
                ['hearingNotes', 'Hearing notes'],
                ['visionNotes', 'Vision notes'],
                ['sensoryNotes', 'Sensory notes'],
              ].map(([name, label]) => (
                <div key={name} className="flex flex-col gap-1.5">
                  <label className={FORM_LABEL} htmlFor={`opp-form-${name}`}>{label}</label>
                  <input
                    id={`opp-form-${name}`}
                    className={`${FORM_INPUT} ${FORM_INPUT_OK}`}
                    onChange={handleText(name)}
                    placeholder="Optional detail"
                    value={form[name]}
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label className={FORM_LABEL} htmlFor="opp-form-coord-name">Coordinator name *</label>
                <input id="opp-form-coord-name" className={inputClass('coordinatorName')} onChange={handleText('coordinatorName')} value={form.coordinatorName} />
                {fieldError('coordinatorName') && <span className={FORM_ERROR_TEXT}>{fieldError('coordinatorName')}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={FORM_LABEL} htmlFor="opp-form-coord-contact">Coordinator contact *</label>
                <input id="opp-form-coord-contact" className={inputClass('coordinatorContact')} onChange={handleText('coordinatorContact')} placeholder="email or +254…" value={form.coordinatorContact} />
                {fieldError('coordinatorContact') && <span className={FORM_ERROR_TEXT}>{fieldError('coordinatorContact')}</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={FORM_LABEL} htmlFor="opp-form-coord-notice">Notice period</label>
                <input id="opp-form-coord-notice" className={`${FORM_INPUT} ${FORM_INPUT_OK}`} onChange={handleText('coordinatorNotice')} value={form.coordinatorNotice} />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <h3 className="font-label-lg text-label-lg font-bold text-primary">4. Description &amp; application</h3>
            <div className="flex flex-col gap-1.5">
              <label className={FORM_LABEL} htmlFor="opp-form-desc">Full description *</label>
              <textarea
                id="opp-form-desc"
                className={`${inputClass('description')} min-h-32`}
                onChange={handleText('description')}
                placeholder="Markdown supported: ## headings, - bullets, 1. steps"
                rows={6}
                value={form.description}
                aria-invalid={fieldError('description') ? true : undefined}
              />
              {fieldError('description') && <span className={FORM_ERROR_TEXT}>{fieldError('description')}</span>}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={FORM_LABEL} htmlFor="opp-form-url">Application / registration URL *</label>
              <input
                id="opp-form-url"
                className={inputClass('appUrl')}
                inputMode="url"
                onChange={handleText('appUrl')}
                placeholder="https://…"
                value={form.appUrl}
                aria-invalid={fieldError('appUrl') ? true : undefined}
              />
              {fieldError('appUrl') && <span className={FORM_ERROR_TEXT}>{fieldError('appUrl')}</span>}
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 font-body-sm text-body-sm text-on-surface">
              <input checked={!!form.multimodalSupport} className="h-4 w-4 accent-primary" onChange={handleCheck('multimodalSupport')} type="checkbox" />
              Multimodal application supported (video, voice note, or assisted application)
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 font-body-sm text-body-sm text-on-surface">
              <input checked={!!form.pledgeAgree} className="mt-1 h-4 w-4 accent-primary" onChange={handleCheck('pledgeAgree')} type="checkbox" />
              <span>
                I accept the True-Inclusion pledge: every accommodation marked above is genuinely provided. *
              </span>
            </label>
            {fieldError('pledgeAgree') && <span className={FORM_ERROR_TEXT}>{fieldError('pledgeAgree')}</span>}
          </section>
        </div>

        <div className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-surface-container bg-surface-container-lowest/95 px-space-lg py-4 backdrop-blur sm:flex-row sm:justify-end">
          <button
            className="rounded-full px-space-lg py-2.5 font-label-md text-label-md font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
            disabled={submitting}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-full bg-primary px-space-lg py-2.5 font-label-md text-label-md font-bold text-on-primary shadow-sm hover:bg-primary-container transition-colors disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Submit for review'}
          </button>
        </div>
      </form>
    </DialogShell>
  );
}

function DeleteConfirmDialog({ opportunity, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);
  const title = opportunity?.basic?.title || 'this opportunity';
  const org = opportunity?.basic?.organization?.name || '';

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteOpportunity(opportunity.id);
      onDeleted(opportunity);
    } catch (err) {
      console.error('Delete failed:', err);
      setError(err?.message || 'Delete failed. Check your connection and database rules.');
      setDeleting(false);
    }
  };

  return (
    <DialogShell label="Delete opportunity" onClose={onClose} maxWidth="max-w-md">
      <div className="flex flex-col gap-4 px-space-lg py-space-md">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-error-container text-on-error-container" aria-hidden="true">
            <span className="material-symbols-outlined text-[24px]">delete</span>
          </span>
          <div>
            <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">Delete opportunity?</h2>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">
              “{title}”{org ? ` by ${org}` : ''} will be permanently removed from the catalogue for everyone. This cannot be undone.
            </p>
          </div>
        </div>
        {error && (
          <div role="alert" className="rounded-xl bg-error-container px-4 py-3 font-body-sm text-body-sm font-medium text-on-error-container">
            {error}
          </div>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            autoFocus
            data-autofocus
            className="rounded-full px-space-lg py-2.5 font-label-md text-label-md font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
            disabled={deleting}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="rounded-full bg-error px-space-lg py-2.5 font-label-md text-label-md font-bold text-on-error shadow-sm transition-colors disabled:opacity-60"
            disabled={deleting}
            onClick={handleDelete}
            type="button"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

function DetailsDialog({ opportunity, bookmarked, onToggleBookmark, onEdit, onCopyLink, onClose }) {
  const [aiSummary, setAiSummary] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiIsAi, setAiIsAi] = useState(true);
  if (!opportunity) return null;
  const category = getCategoryMeta(opportunity?.basic?.category);
  const orgName = opportunity?.basic?.organization?.name || 'Inclusive Employer';
  const orgWebsite = opportunity?.basic?.organization?.website || null;
  const title = opportunity?.basic?.title || 'Untitled opportunity';
  const pills = getAccommodationPills(opportunity);
  const notes = opportunity?.accessibility?.notes || {};
  const coordinator = opportunity?.accessibility?.coordinator || {};
  const blocks = renderDescriptionBlocks(opportunity?.details?.descriptionMarkdown);
  const deadline = formatReadableDate(opportunity?.logistics?.applicationDeadline);
  const startDate = formatReadableDate(opportunity?.logistics?.startDate);
  const compensation = String(opportunity?.logistics?.compensation || '').trim();
  const venue = String(opportunity?.logistics?.venueAddress || '').trim();
  const applyUrl = opportunity?.details?.applicationUrl || '#';
  const noteEntries = [
    ['Mobility', notes.mobility],
    ['Hearing', notes.hearing],
    ['Vision', notes.vision],
    ['Sensory', notes.sensory],
  ].filter(([, value]) => String(value || '').trim() !== '');
  const contact = String(coordinator.contact || '').trim();
  const contactHref = contact.includes('@') ? `mailto:${contact}` : contact ? `tel:${contact.replace(/\s+/g, '')}` : null;

  return (
    <DialogShell label={`Details: ${title}`} onClose={onClose} maxWidth="max-w-3xl">
      <div className="flex items-start justify-between gap-3 border-b border-surface-container px-space-lg py-4">
        <div className="flex flex-col gap-1.5">
          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-primary-fixed px-2.5 py-1 font-label-sm text-label-sm font-bold text-on-primary-fixed">
            <span className="material-symbols-outlined text-[14px]" aria-hidden="true">{category.icon}</span>
            {category.label}
          </span>
          <h2 className="font-headline-md text-headline-md font-bold text-on-surface">{title}</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {orgName}
            {orgWebsite && (
              <>
                {' · '}
                <a className="font-bold text-primary hover:underline" href={orgWebsite} target="_blank" rel="noreferrer">
                  Website
                </a>
              </>
            )}
          </p>
        </div>
        <button aria-label="Close details" className="rounded-full p-2 hover:bg-surface-container transition-colors" onClick={onClose} type="button" data-autofocus>
          <span className="material-symbols-outlined text-[22px]" aria-hidden="true">close</span>
        </button>
      </div>

      <div className="flex flex-col gap-5 px-space-lg py-space-md">
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-surface-container-low px-3 py-1 font-label-sm text-label-sm font-semibold text-on-surface">{formatLocation(opportunity)}</span>
          {compensation && <span className="rounded-full bg-primary-fixed px-3 py-1 font-label-sm text-label-sm font-bold text-on-primary-fixed">{compensation}</span>}
          {deadline && <span className="rounded-full bg-surface-container-low px-3 py-1 font-label-sm text-label-sm font-semibold text-on-surface">{getDeadlineVerb(opportunity?.basic?.category)} {deadline}</span>}
          {startDate && <span className="rounded-full bg-surface-container-low px-3 py-1 font-label-sm text-label-sm font-semibold text-on-surface">Starts {startDate}</span>}
        </div>

        {venue && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            <span className="font-bold text-on-surface">Venue: </span>{venue}
          </p>
        )}

        <div className="flex flex-col gap-2">
          {blocks.map((block, index) => {
            if (block.type === 'heading') {
              return <h3 key={index} className="font-headline-sm text-headline-sm font-bold text-on-surface">{block.text}</h3>;
            }
            if (block.type === 'list') {
              return (
                <ul key={index} className="flex list-disc flex-col gap-1 pl-5 font-body-md text-body-md text-on-surface">
                  {block.items.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}
                </ul>
              );
            }
            return <p key={index} className="font-body-md text-body-md text-on-surface">{block.text}</p>;
          })}
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-label-lg text-label-lg font-bold text-on-surface">Verified accommodations ({pills.length})</h3>
          {(aiLoading || aiSummary) && (
            <div aria-live="polite" className="rounded-2xl border border-primary-fixed bg-primary-fixed/15 p-3.5 flex flex-col gap-1.5">
              <p className="flex items-center gap-1.5 font-label-md text-label-md font-bold text-primary">
                <span className="material-symbols-outlined text-[18px]" aria-hidden="true">auto_awesome</span>
                Easy-Read summary {aiIsAi ? '· Gemini AI' : '· offline'}
              </p>
              {aiLoading ? (
                <p className="animate-pulse font-body-sm text-body-sm text-on-surface-variant">Simplifying…</p>
              ) : (
                String(aiSummary || '').split('\n').map((line, i) => (
                  <p key={i} className="font-body-sm text-body-sm text-on-surface">{line.replace(/^-\s*/, '• ')}</p>
                ))
              )}
              {!aiLoading && aiSummary && (
                <button className="self-start inline-flex items-center gap-1 font-label-sm text-label-sm font-bold text-primary hover:underline" onClick={() => speakText(aiSummary)} type="button">
                  <span className="material-symbols-outlined text-[16px]" aria-hidden="true">volume_up</span> Listen to summary
                </button>
              )}
            </div>
          )}
          {pills.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {pills.map((pill) => (
                <span key={pill.key} className="inline-flex items-center gap-1 rounded-full bg-secondary-container/40 px-3 py-1 font-label-sm text-label-sm text-on-secondary-fixed">
                  <span className="material-symbols-outlined text-[16px] text-secondary" aria-hidden="true">{pill.icon}</span>
                  {pill.label}
                </span>
              ))}
            </div>
          ) : (
            <p className="font-body-sm text-body-sm text-on-surface-variant">Contact the coordinator for tailored accommodations.</p>
          )}
          {noteEntries.map(([area, value]) => (
            <p key={area} className="font-body-sm text-body-sm text-on-surface-variant">
              <span className="font-bold text-on-surface">{area}: </span>{value}
            </p>
          ))}
        </div>

        {(coordinator.name || contact) && (
          <div className="rounded-2xl bg-surface-container-low p-4">
            <h3 className="font-label-lg text-label-lg font-bold text-on-surface">Accessibility coordinator</h3>
            <p className="mt-1 font-body-sm text-body-sm text-on-surface">
              {coordinator.name}
              {coordinator.noticePeriod && <span className="text-on-surface-variant"> · {coordinator.noticePeriod}</span>}
            </p>
            {contactHref ? (
              <a className="font-body-sm text-body-sm font-bold text-primary hover:underline" href={contactHref}>{contact}</a>
            ) : contact ? (
              <p className="font-body-sm text-body-sm text-on-surface">{contact}</p>
            ) : null}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t border-surface-container bg-surface-container-lowest/95 px-space-lg py-4 backdrop-blur">
        <button
          className="inline-flex items-center gap-1.5 rounded-full bg-primary-fixed/40 px-4 py-2.5 font-label-md text-label-md font-bold text-on-primary-fixed hover:bg-primary-fixed transition-colors disabled:opacity-60"
          disabled={aiLoading}
          onClick={async () => {
            setAiLoading(true);
            try {
              const { text, ai } = await summarizeOpportunity(opportunity);
              setAiSummary(text);
              setAiIsAi(ai);
            } finally {
              setAiLoading(false);
            }
          }}
          type="button"
        >
          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">auto_awesome</span>
          {aiLoading ? 'Simplifying…' : aiSummary ? 'Re-simplify' : 'Simplify ✨'}
        </button>
        <button
          className="rounded-full px-4 py-2.5 font-label-md text-label-md font-bold text-on-surface-variant hover:bg-surface-container transition-colors"
          onClick={() => speakText(`${title} by ${orgName}. ${blocks.map((b) => b.text || (b.items || []).join('. ')).join(' ').slice(0, 800)}`)}
          type="button"
        >
          🔊 Listen
        </button>
        <button className="rounded-full px-4 py-2.5 font-label-md text-label-md font-bold text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => onToggleBookmark(opportunity.id)} type="button">
          {bookmarked ? 'Saved ✓' : 'Save'}
        </button>
        <button className="rounded-full px-4 py-2.5 font-label-md text-label-md font-bold text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => onCopyLink(opportunity)} type="button">
          Copy link
        </button>
        <button className="rounded-full px-4 py-2.5 font-label-md text-label-md font-bold text-on-surface-variant hover:bg-surface-container transition-colors" onClick={() => onEdit(opportunity)} type="button">
          Edit
        </button>
        <a
          href={applyUrl}
          target={applyUrl === '#' ? undefined : '_blank'}
          rel={applyUrl === '#' ? undefined : 'noreferrer'}
          className="rounded-full bg-primary px-space-lg py-2.5 font-label-md text-label-md font-bold text-on-primary shadow-sm hover:bg-primary-container transition-colors"
        >
          Apply Now
        </a>
      </div>
    </DialogShell>
  );
}

function InfoDialog({ topic, onClose }) {
  const content = INFO_CONTENT[topic] || { title: 'Information', paragraphs: [] };
  return (
    <DialogShell label={content.title} onClose={onClose} maxWidth="max-w-lg">
      <div className="flex items-start justify-between gap-3 border-b border-surface-container px-space-lg py-4">
        <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">{content.title}</h2>
        <button aria-label="Close dialog" className="rounded-full p-2 hover:bg-surface-container transition-colors" onClick={onClose} type="button" data-autofocus>
          <span className="material-symbols-outlined text-[22px]" aria-hidden="true">close</span>
        </button>
      </div>
      <div className="flex flex-col gap-3 px-space-lg py-space-md">
        {content.paragraphs.map((paragraph, index) => (
          <p key={index} className="font-body-md text-body-md text-on-surface">{paragraph}</p>
        ))}
        <div className="flex justify-end pt-2">
          <button className="rounded-full bg-primary px-space-lg py-2.5 font-label-md text-label-md font-bold text-on-primary hover:bg-primary-container transition-colors" onClick={onClose} type="button">
            Got it
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

function AISummaryDialog({ opportunity, summary, loading, isAi, onListen, onClose }) {
  const title = opportunity?.basic?.title || 'Opportunity';
  return (
    <DialogShell label={`Easy-Read summary: ${title}`} onClose={onClose} maxWidth="max-w-lg">
      <div className="flex items-start justify-between gap-3 border-b border-surface-container px-space-lg py-4">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-primary text-[24px]" aria-hidden="true">auto_awesome</span>
          <div>
            <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">Easy-Read summary</h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {title} · {isAi ? 'written by Gemini AI' : 'offline plain-language version'}
            </p>
          </div>
        </div>
        <button aria-label="Close summary" className="rounded-full p-2 hover:bg-surface-container transition-colors" onClick={onClose} type="button" data-autofocus>
          <span className="material-symbols-outlined text-[22px]" aria-hidden="true">close</span>
        </button>
      </div>
      <div className="flex flex-col gap-3 px-space-lg py-space-md" aria-live="polite">
        {loading ? (
          <p className="animate-pulse font-body-md text-body-md text-on-surface-variant">Simplifying this opportunity for you…</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {String(summary || '').split('\n').map((line, i) => (
              <p key={i} className="font-body-md text-body-md text-on-surface">{line.replace(/^-\s*/, '• ')}</p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <button
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-container-low px-4 py-2.5 font-label-md text-label-md font-bold text-on-surface hover:bg-surface-container transition-colors"
            onClick={onListen}
            type="button"
            disabled={loading || !summary}
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">volume_up</span>
            Listen
          </button>
          <button
            className="rounded-full bg-primary px-space-lg py-2.5 font-label-md text-label-md font-bold text-on-primary hover:bg-primary-container transition-colors"
            onClick={onClose}
            type="button"
          >
            Got it
          </button>
        </div>
      </div>
    </DialogShell>
  );
}

function AISmartSearch({ idPrefix, searchQuery, setSearchQuery, onApplyFilters, aiParsing, aiNote }) {
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const recogRef = useRef(null);
  const submittedRef = useRef(false);
  // Always call the latest search handler — avoids the stale-closure bug
  // where a voice result captured an old `onApplyFilters` (with aiParsing
  // already true) and silently dropped the search.
  const applyRef = useRef(onApplyFilters);
  applyRef.current = onApplyFilters;

  useEffect(() => () => {
    try { recogRef.current?.abort?.(); } catch (e) { /* noop */ }
    try { recogRef.current?.stop?.(); } catch (e) { /* noop */ }
  }, []);

  const getTranscript = (e) => {
    try {
      // Aggregate every result so long utterances aren't truncated to
      // just the first chunk (e.results[0][0] only).
      return Array.from(e.results || [])
        .map((r) => r?.[0]?.transcript || '')
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
    } catch (error) {
      return e.results?.[0]?.[0]?.transcript || '';
    }
  };

  const isFinalResult = (e) => {
    try {
      const list = Array.from(e.results || []);
      if (!list.length) return false;
      // SpeechRecognition fires onresult multiple times with interim
      // chunks — only treat it as done when the latest chunk is final.
      return !!list[list.length - 1]?.isFinal;
    } catch (error) {
      return true;
    }
  };

  const submitVoice = (transcript) => {
    const text = String(transcript || '').trim();
    if (!text || submittedRef.current) return;
    submittedRef.current = true;
    setSearchQuery(text);
    // Same path as typing + Enter / AI Find click.
    try {
      const out = applyRef.current?.(text);
      // If the handler is async, don't swallow rejections.
      if (out && typeof out.catch === 'function') out.catch(() => {});
    } finally {
      try { recogRef.current?.stop(); } catch (e) { /* noop */ }
      setListening(false);
    }
  };

  const startVoice = () => {
    try {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        setVoiceError('Voice search is not supported in this browser. Type your request instead.');
        return;
      }
      // Toggle: tapping Speak while listening stops (same as other bars).
      if (listening) {
        try { recogRef.current?.stop(); } catch (e) { /* noop */ }
        setListening(false);
        return;
      }
      const recog = new SR();
      recogRef.current = recog;
      submittedRef.current = false;
      recog.lang = 'en-KE';
      // Interim = true so the input fills live while speaking; we only
      // auto-search once a FINAL result (or onend fallback) arrives.
      recog.interimResults = true;
      recog.continuous = false;
      recog.maxAlternatives = 1;
      setVoiceError('');
      recog.onresult = (e) => {
        const transcript = getTranscript(e);
        if (transcript) setSearchQuery(transcript);
        if (transcript && isFinalResult(e)) submitVoice(transcript);
      };
      recog.onerror = (e) => {
        if (e?.error === 'not-allowed' || e?.error === 'service-not-allowed') {
          setVoiceError('Microphone blocked. Allow mic access in the browser, then try again.');
        } else if (e?.error === 'no-speech') {
          setVoiceError('No speech heard. Tap Speak and try again.');
        } else if (e?.error !== 'aborted') {
          setVoiceError('Voice had trouble. Type your request or tap Speak to retry.');
        }
        setListening(false);
      };
      recog.onend = () => {
        setListening(false);
        // Fallback: some browsers fire onend without a final-flagged
        // result — if we heard text but never submitted, submit it now
        // so speaking always initiates the search like typing does.
        if (!submittedRef.current) {
          try {
            // searchQuery state may be stale inside this callback, so read
            // the live input value directly.
            const live = document.getElementById(`${idPrefix}-ai-search`)?.value || '';
            if (String(live).trim()) submitVoice(live);
          } catch (e) { /* noop */ }
        }
      };
      recog.start();
      setListening(true);
    } catch (error) {
      setListening(false);
      setVoiceError('Could not start voice search. Type your request instead.');
    }
  };
  const voiceAvailable = typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  return (
    <div className="rounded-2xl border border-primary-fixed bg-primary-fixed/20 p-3 sm:p-4 flex flex-col gap-2" role="region" aria-label="AI smart search">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-primary text-[22px]" aria-hidden="true">auto_awesome</span>
        <p className="font-label-md text-label-md font-bold text-on-surface">Describe what you need — AI finds it</p>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <label htmlFor={`${idPrefix}-ai-search`} className="sr-only">Describe the opportunity you need in your own words</label>
        <input
          id={`${idPrefix}-ai-search`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onApplyFilters(searchQuery); } }}
          placeholder='Try: "remote jobs with screen reader support" or tap mic and speak…'
          className="min-w-0 flex-1 rounded-full bg-surface-container-lowest px-4 py-2.5 font-body-sm text-body-sm text-on-surface placeholder:text-outline outline-none focus:ring-2 focus:ring-primary border border-outline-variant/40"
        />
        <div className="flex gap-2">
          {voiceAvailable && (
            <button
              type="button"
              onClick={startVoice}
              aria-pressed={listening}
              aria-label={listening ? 'Stop voice input' : 'Speak your search'}
              title="Speak your search"
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 py-2.5 font-label-md text-label-md font-bold transition-all ${listening ? 'animate-pulse bg-error text-on-error' : 'bg-surface-container-low text-on-surface hover:bg-surface-container'}`}
            >
              <span className="material-symbols-outlined text-[18px]" aria-hidden="true">{listening ? 'mic_off' : 'mic'}</span>
              {listening ? 'Listening…' : 'Speak'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onApplyFilters(searchQuery)}
            disabled={aiParsing || !String(searchQuery || '').trim()}
            className="inline-flex min-h-[44px] flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-full bg-primary px-5 py-2.5 font-label-md text-label-md font-bold text-on-primary shadow-sm hover:bg-primary-container transition-colors disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-[18px]" aria-hidden="true">auto_awesome</span>
            {aiParsing ? 'Understanding…' : 'AI Find'}
          </button>
        </div>
      </div>
      {aiNote && (
        <p aria-live="polite" className="font-body-sm text-body-sm text-on-surface-variant flex items-start gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-primary shrink-0 mt-0.5" aria-hidden="true">info</span>
          {aiNote}
        </p>
      )}
      {listening && (
        <p aria-live="polite" className="font-body-sm text-body-sm text-on-surface-variant flex items-start gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-error shrink-0 mt-0.5 animate-pulse" aria-hidden="true">mic</span>
          Listening… speak now. Your words appear above and search starts automatically when you pause.
        </p>
      )}
      {voiceError && !listening && (
        <p role="alert" className="font-body-sm text-body-sm text-error flex items-start gap-1.5">
          <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5" aria-hidden="true">error</span>
          {voiceError}
        </p>
      )}
    </div>
  );
}

function Home({ onViewDetails, onPostOpportunity, onEditProfile, initialView, onViewChange, initialAiFilter, onAiFilterConsumed }) {
  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      if (initialAiFilter && typeof initialAiFilter.searchKeywords === 'string') return initialAiFilter.searchKeywords;
      const stashed = sessionStorage.getItem('accessable.aiFilter');
      if (!initialAiFilter && stashed) {
        const p = JSON.parse(stashed);
        if (p && typeof p.searchKeywords === 'string') return p.searchKeywords;
      }
    } catch (e) { /* noop */ }
    return '';
  });
  const [showDetailsPage, setShowDetailsPage] = useState(false);
  const [selectedForDetailsPage, setSelectedForDetailsPage] = useState(null);
  const [showSubmissionForm, setShowSubmissionForm] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [activeQuickFilter, setActiveQuickFilter] = useState('All Opportunities');
  const [sortBy, setSortBy] = useState(SORT_OPTIONS[0]);
  const [bookmarked, setBookmarked] = useState([]);
  const [opportunityType, setOpportunityType] = useState([]);
  const [accommodation, setAccommodation] = useState([]);
  const [workMode, setWorkMode] = useState([]);
  const [compensationType, setCompensationType] = useState([]);
  const [applicationSupport, setApplicationSupport] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [view, setView] = useState(initialView === 'saved' ? 'saved' : 'browse');
  // --- Gemini AI state (PWD-first discovery) ---
  const [aiParsing, setAiParsing] = useState(false);
  const [aiNote, setAiNote] = useState('');
  const [aiSummaryOpp, setAiSummaryOpp] = useState(null);
  const [aiSummaryText, setAiSummaryText] = useState('');
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryIsAi, setAiSummaryIsAi] = useState(true);

  // Natural-language "AI Find": Gemini converts "remote jobs with screen
  // reader support" into catalogue filters + keywords, then applies them.
  // Faceted filters the AI does not manage are cleared so stale sidebar
  // selections cannot intersect to 0 results.
  // Uses a ref guard (not state in the dep array) so voice callbacks never
  // capture a stale `aiParsing=true` closure that would silently drop the
  // search right after speaking.
  const aiParsingRef = useRef(false);
  const handleAiFind = useCallback(async (rawText) => {
    const text = String(rawText || '').trim();
    if (!text || aiParsingRef.current) return;
    aiParsingRef.current = true;
    setAiParsing(true);
    setAiNote('Able is understanding your request…');
    try {
      const parsed = await parseNaturalLanguageQuery(text);
      if (parsed.quickFilter) setActiveQuickFilter(parsed.quickFilter);
      if (Array.isArray(parsed.workModes)) setWorkMode(parsed.workModes);
      if (Array.isArray(parsed.accommodations)) setAccommodation(parsed.accommodations);
      // AI owns category/work-mode/accommodation + keywords. Anything else
      // left over from manual filtering would AND with the AI result and
      // force the listview to 0, so reset it.
      setOpportunityType([]);
      setCompensationType([]);
      setApplicationSupport([]);
      setSearchQuery(parsed.searchKeywords || '');
      setView('browse');
      setCurrentPage(1);
      setAiNote(`✨ ${parsed.explanation || 'Filters applied.'}${parsed.ai ? '' : ' (offline mode)'}`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setAiNote('AI is unreachable — try keywords like "remote", "ASL", or "grant".');
    } finally {
      aiParsingRef.current = false;
      setAiParsing(false);
    }
  }, []);

  // Easy-Read summary for any card (cognitive / low-vision / SR users).
  const openAiSummary = useCallback(async (opp) => {
    if (!opp) return;
    setAiSummaryOpp(opp);
    setAiSummaryText('');
    setAiSummaryIsAi(true);
    setAiSummaryLoading(true);
    try {
      const { text, ai } = await summarizeOpportunity(opp);
      setAiSummaryText(text);
      setAiSummaryIsAi(ai);
    } catch (error) {
      setAiSummaryText('Sorry — the summary failed. Try opening View details instead.');
      setAiSummaryIsAi(false);
    } finally {
      setAiSummaryLoading(false);
    }
  }, []);

  // Apply Landing's Gemini AI handoff once (prop or sessionStorage stash).
  // Lets PWDs move from Landing's AI bar / Access Match straight into a
  // pre-filtered catalogue without retyping or re-speaking their needs.
  const aiHandoffDone = useRef(false);
  useEffect(() => {
    if (aiHandoffDone.current) return;
    let parsed = null;
    if (initialAiFilter && typeof initialAiFilter === 'object') {
      parsed = initialAiFilter;
    } else {
      try {
        const stashed = sessionStorage.getItem('accessable.aiFilter');
        if (stashed) parsed = JSON.parse(stashed);
      } catch (e) { /* noop */ }
    }
    if (parsed && typeof parsed === 'object' && (parsed.quickFilter || parsed.searchKeywords || parsed.workModes || parsed.accommodations)) {
      aiHandoffDone.current = true;
      if (parsed.quickFilter) setActiveQuickFilter(parsed.quickFilter);
      if (Array.isArray(parsed.workModes)) setWorkMode(parsed.workModes);
      if (Array.isArray(parsed.accommodations)) setAccommodation(parsed.accommodations);
      if (typeof parsed.searchKeywords === 'string') setSearchQuery(parsed.searchKeywords);
      setView('browse');
      setCurrentPage(1);
      setAiNote(`✨ ${parsed.explanation || 'Your AI filters from the landing page are applied.'}${parsed.ai === false ? ' (offline mode)' : ''}`);
      try { sessionStorage.removeItem('accessable.aiFilter'); } catch (e) { /* noop */ }
      if (typeof onAiFilterConsumed === 'function') {
        try { onAiFilterConsumed(); } catch (e) { /* noop */ }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync catalogue tab when App navigates home via global bottom nav
  // (e.g. Saved tab pressed from Details / Submission / Signup pages).
  useEffect(() => {
    if (initialView === 'saved' || initialView === 'browse') {
      setView(initialView);
    }
  }, [initialView]);

  // Report tab changes back to App so going details -> back preserves the tab.
  useEffect(() => {
    if (typeof onViewChange === 'function') onViewChange(view);
  }, [view, onViewChange]);
  const [highContrast, setHighContrast] = useState(() => readStored(A11Y_STORAGE_KEY, {}).highContrast === true);
  const [largeText, setLargeText] = useState(() => readStored(A11Y_STORAGE_KEY, {}).largeText === true);
  const [dyslexiaFont, setDyslexiaFont] = useState(() => readStored(A11Y_STORAGE_KEY, {}).dyslexiaFont === true);
  // Production list from Firebase RTDB `/opportunities` (schema v1).
  const [opportunities, setOpportunities] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retryTick, setRetryTick] = useState(0);
  // UI chrome state: toasts, menus, dialogs (CRUD + details + info).
  const [toasts, setToasts] = useState([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [formModal, setFormModal] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [detailsOpp, setDetailsOpp] = useState(null);
  const [infoTopic, setInfoTopic] = useState(null);
  // Mobile-only chrome: sort dropdown + filter bottomsheet (ported from HomeMobile.html vanilla JS)
  const [mobileSortOpen, setMobileSortOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  // Mobile bottom nav single-selection (radio-group behaviour): only one tab
  // is selected at a time. Browse/Saved mirror `view`; Post opens the post
  // flow; Profile opens Signup in edit mode.
  const [mobileTab, setMobileTab] = useState('browse');
  // Google signed-in user — drives the header avatar + per-user saved path.
  const [currentUser, setCurrentUser] = useState(null);
  const toastIdRef = useRef(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => setCurrentUser(user || null));
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const currentUid = currentUser?.uid || null;
  const savedPath = currentUid ? `${SAVED_RTDB_PATH}/${currentUid}` : null;
  const profilePhoto =
    currentUser?.photoURL ||
    'https://lh3.googleusercontent.com/aida/AEtjO1VNhLS90sGEsrGZ4QTntCwO2KXWJl3z598WV0kITWYBuSL7zQYm0n6q799qV9ZDVq6a-2qzH9MhYEWr_pGzq8mxMSVe8JefZOglP-0LPl0necCYsTlYSKP2el0-E5dq678kpSUDcrwBI35nO_VHGJQGtDpw75E6j9cjj0fR_y639Vb6qP_D7otM3hrleIb-3mYbOsBLr9zQN7FbbalfsIMCUizv6yUVCbmcc2MhiOggcFFPJbt-6BjxI16mCYl3kgtWB50d1OBlsew';
  const profileName = currentUser?.displayName || 'My AccessAble';

  // Navigate to the Details.js page. The clicked card item is forwarded so
  // Details.js can display it inside the opportunity details card. When Home
  // is rendered inside App, delegate to App via onViewDetails(opportunity);
  // when rendered standalone, render Details directly so the button still
  // navigates.
  const handleViewDetails = useCallback((opportunity) => {
    if (typeof onViewDetails === 'function') {
      onViewDetails(opportunity || null);
    } else {
      setSelectedForDetailsPage(opportunity || null);
      setShowDetailsPage(true);
    }
  }, [onViewDetails]);

  // Navigate to the SubmissionForm.js page. When Home is rendered inside
  // App, delegate to App via onPostOpportunity; when rendered standalone,
  // render SubmissionForm directly so the button still navigates.
  const handlePostOpportunity = useCallback(() => {
    if (typeof onPostOpportunity === 'function') {
      onPostOpportunity();
    } else {
      setShowSubmissionForm(true);
    }
  }, [onPostOpportunity]);

  // Open Signup.js in edit mode so users can edit + update profile details.
  // When Home is rendered inside App, delegate via onEditProfile; when
  // rendered standalone, render Signup directly in edit mode.
  const handleEditProfile = useCallback(() => {
    setProfileOpen(false);
    setOpenMenuId(null);
    setMobileFiltersOpen(false);
    setMobileSortOpen(false);
    if (typeof onEditProfile === 'function') {
      onEditProfile();
    } else {
      setShowProfileEditor(true);
    }
  }, [onEditProfile]);

  // Keep the mobile bottom-nav radio selection in sync when `view` changes
  // from elsewhere (desktop filters, saved/bookmarks empty-state, etc.).
  // Post/Profile keep their selection until another tab is chosen.
  useEffect(() => {
    if (view === 'browse' || view === 'saved') {
      setMobileTab(view);
    }
  }, [view]);

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

  // Mirror the HTML <body> a11y behaviours onto the React document body.
  useEffect(() => {
    document.body.classList.toggle('high-contrast-mode', highContrast);
    return () => document.body.classList.remove('high-contrast-mode');
  }, [highContrast]);

  useEffect(() => {
    document.body.classList.toggle('dyslexia-font', dyslexiaFont);
    return () => document.body.classList.remove('dyslexia-font');
  }, [dyslexiaFont]);

  useEffect(() => {
    document.documentElement.style.fontSize = largeText ? '18px' : '';
    return () => {
      document.documentElement.style.fontSize = '';
    };
  }, [largeText]);

  // Persist display preferences on this device.
  useEffect(() => {
    writeStored(A11Y_STORAGE_KEY, { highContrast, largeText, dyslexiaFont });
  }, [highContrast, largeText, dyslexiaFont]);

  // Saved bookmarks live in Firebase RTDB scoped to the signed-in user:
  // `/saved/{uid}/{opportunityId}: true`. The saved tab + card save state
  // both derive from this subscription. Signed-out visitors keep local-only
  // bookmarks until they sign in with Google.
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

  // Live subscription to the production `/opportunities` node. Records
  // follow opportunities_schema.json (basic/logistics/accessibility/
  // details/meta). Newest-first ordering comes from the service.
  useEffect(() => {
    setIsLoading(true);
    setLoadError(null);
    const unsubscribe = subscribeOpportunities(
      (items) => {
        setOpportunities(items);
        setIsLoading(false);
      },
      (error) => {
        console.error('Failed to load opportunities:', error);
        setLoadError(error);
        setIsLoading(false);
      }
    );
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [retryTick]);

  // Close the profile dropdown and card menus on outside click / Escape.
  useEffect(() => {
    if (!profileOpen && !openMenuId) return undefined;
    const onPointerDown = (event) => {
      if (event.target.closest('[data-menu-root]')) return;
      setProfileOpen(false);
      setOpenMenuId(null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setProfileOpen(false);
        setOpenMenuId(null);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [profileOpen, openMenuId]);

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
  const isBookmarked = (id) => bookmarked.includes(id);

  const resetFilters = () => {
    setSearchQuery('');
    setActiveQuickFilter('All Opportunities');
    setSortBy(SORT_OPTIONS[0]);
    setOpportunityType([]);
    setAccommodation([]);
    setWorkMode([]);
    setCompensationType([]);
    setApplicationSupport([]);
    setCurrentPage(1);
    setView('browse');
    setAiNote('');
  };

  const copyOpportunityLink = useCallback(
    async (opp) => {
      const url = opp?.details?.applicationUrl || window.location.href;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          pushToast('Application link copied to clipboard.');
        } else {
          window.prompt('Copy the application link:', url);
        }
      } catch (error) {
        window.prompt('Copy the application link:', url);
      }
      setOpenMenuId(null);
    },
    [pushToast]
  );

  const openCreateModal = useCallback(() => {
    setProfileOpen(false);
    setOpenMenuId(null);
    handlePostOpportunity();
  }, [handlePostOpportunity]);

  const openEditModal = useCallback((opp) => {
    setFormModal({ mode: 'edit', opportunity: opp });
    setOpenMenuId(null);
    setDetailsOpp(null);
  }, []);

  const handleFormSaved = useCallback(
    (id, mode) => {
      setFormModal(null);
      pushToast(
        mode === 'edit'
          ? 'Opportunity updated.'
          : `Opportunity submitted for review (ID: ${id}).`
      );
      if (mode === 'create') setView('browse');
    },
    [pushToast]
  );

  const handleDeleted = useCallback(
    async (opp) => {
      setDeleteTarget(null);
      setDetailsOpp((current) => (current && current.id === opp.id ? null : current));
      // Best-effort cleanup of the per-user saved entry in RTDB; the
      // subscription will reconcile local state.
      if (opp?.id && savedPath) {
        try {
          await dbRemove(dbRef(db, `${savedPath}/${opp.id}`));
        } catch (error) {
          console.warn('Could not remove deleted opportunity from saved:', error);
        }
      }
      pushToast('Opportunity deleted.');
    },
    [pushToast, savedPath]
  );

  const visibleOpportunities = useMemo(() => {
    const queryTokens = tokenizeSearchQuery(searchQuery);
    const hasQuery = queryTokens.length > 0;
    const keywords = QUICK_FILTER_KEYWORDS[activeQuickFilter];
    const quickCategory = QUICK_FILTER_CATEGORY[activeQuickFilter];
    // Stage 1: every structural/schema filter EXCEPT the free-text query.
    // (view, quick pill category, faceted sidebar filters).
    const baseFiltered = opportunities.filter((opp) => {
      if (view === 'saved' && !bookmarked.includes(opp.id)) return false;
      const haystack = buildHaystack(opp);
      if (quickCategory && String(opp?.basic?.category || '').trim().toLowerCase() !== quickCategory) return false;
      if (keywords && !keywords.some((k) => haystack.includes(k))) return false;
      if (opportunityType.length > 0 && !opportunityType.some((label) => matchesTypeFilter(opp, label))) return false;
      if (accommodation.length > 0 && !accommodation.some((label) => matchesAccommodationFilter(opp, label))) return false;
      if (workMode.length > 0 && !workMode.some((label) => matchesWorkModeFilter(opp, label))) return false;
      if (compensationType.length > 0 && !compensationType.some((label) => matchesCompensationFilter(opp, label))) return false;
      if (applicationSupport.length > 0 && !applicationSupport.some((label) => matchesSupportFilter(opp, label))) return false;
      return true;
    });
    // Stage 2: schema-aware keyword search cross-checked with buildHaystack.
    // Prefer full (AND) matches; fall back to partial (OR) matches ordered
    // by relevance so AI searches never collapse to 0 when close matches
    // exist in the export schema. Genuine non-matches still return 0.
    let filtered = baseFiltered;
    let scores = null;
    if (hasQuery) {
      scores = new Map(
        baseFiltered.map((opp) => [opp.id, getSearchScore(opp, queryTokens)])
      );
      const fullMatches = baseFiltered.filter((opp) => scores.get(opp.id) === queryTokens.length);
      if (fullMatches.length > 0) {
        filtered = fullMatches;
      } else {
        filtered = baseFiltered
          .filter((opp) => (scores.get(opp.id) || 0) > 0)
          .sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0) || getTimestamp(b) - getTimestamp(a));
      }
    }
    const sorted = [...filtered];
    const normalizedSort = String(sortBy || '').trim();
    if (normalizedSort === 'Newest') {
      sorted.sort((a, b) => getTimestamp(b) - getTimestamp(a));
    } else if (normalizedSort === 'Highest Accommodation Match' || normalizedSort === 'Highest Accommodation') {
      sorted.sort((a, b) => countAccommodations(b) - countAccommodations(a) || getTimestamp(b) - getTimestamp(a));
    } else if (hasQuery && scores) {
      // "Most Relevant" + active search -> rank by schema token matches.
      sorted.sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0) || getTimestamp(b) - getTimestamp(a));
    }
    return sorted;
  }, [opportunities, searchQuery, activeQuickFilter, sortBy, view, bookmarked, opportunityType, accommodation, workMode, compensationType, applicationSupport]);

  const visibleCount = visibleOpportunities.length;
  const totalPages = Math.max(1, Math.ceil(visibleCount / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, currentPage), totalPages);
  const pagedOpportunities = visibleOpportunities.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const paginationPages = totalPages <= 7
    ? Array.from({ length: totalPages }, (_, i) => i + 1)
    : [1, 2, 3, 'ellipsis', totalPages];

  // Reset to page 1 whenever the result set definition changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeQuickFilter, sortBy, view, opportunityType, accommodation, workMode, compensationType, applicationSupport]);

  // Clamp the page after deletes shrink the result set.
  useEffect(() => {
    setCurrentPage((page) => Math.min(Math.max(1, page), totalPages));
  }, [totalPages]);

  const activeFacetCount = opportunityType.length + accommodation.length + workMode.length + compensationType.length + applicationSupport.length;
  const hasActiveFilters =
    activeQuickFilter !== 'All Opportunities' ||
    opportunityType.length > 0 ||
    accommodation.length > 0 ||
    workMode.length > 0 ||
    compensationType.length > 0 ||
    applicationSupport.length > 0 ||
    searchQuery.trim() !== '';
  // Deduped, data-synced accommodation benefits for the faceted filters.
  // Recomputed whenever live opportunities change so new postings appear
  // without redundant grouped entries.
  const accommodationOptions = useMemo(() => getAvailableAccommodations(opportunities), [opportunities]);
  const employerCount = useMemo(
    () =>
      new Set(
        opportunities
          .map((opp) => String(opp?.basic?.organization?.name || '').trim().toLowerCase())
          .filter(Boolean)
      ).size,
    [opportunities]
  );
  const heroRolesLabel = isLoading ? 'Loading verified roles…' : `${opportunities.length} Verified ${opportunities.length === 1 ? 'Role' : 'Roles'}`;
  const heroEmployersLabel = isLoading ? 'Loading employers…' : `${employerCount} Inclusive ${employerCount === 1 ? 'Employer' : 'Employers'}`;

  // Mobile chrome effects: lock scroll when filters sheet open, close sort on outside click
  useEffect(() => {
    if (mobileFiltersOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
    return undefined;
  }, [mobileFiltersOpen]);

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

  // Keep mobile filter sheet in sync with body overflow for closing via Esc
  useEffect(() => {
    if (!mobileFiltersOpen) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') setMobileFiltersOpen(false); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [mobileFiltersOpen]);

  // Standalone fallback: if Home is used without App's onViewDetails,
  // navigate by rendering the Details.js page directly with the clicked item.
  if (showDetailsPage && typeof onViewDetails !== 'function') {
    return (
      <Details
        opportunity={selectedForDetailsPage}
        opportunityId={selectedForDetailsPage?.id || null}
        onBack={() => setShowDetailsPage(false)}
      />
    );
  }

  // Standalone fallback: if Home is used without App's onPostOpportunity,
  // navigate by rendering the SubmissionForm.js page directly.
  if (showSubmissionForm && typeof onPostOpportunity !== 'function') {
    return <SubmissionForm />;
  }

  // Standalone fallback: if Home is used without App's onEditProfile,
  // render Signup.js directly in edit mode so the profile can be updated.
  if (showProfileEditor && typeof onEditProfile !== 'function') {
    return (
      <Signup
        mode="edit"
        onBack={() => setShowProfileEditor(false)}
        onExplore={() => setShowProfileEditor(false)}
        onComplete={() => setShowProfileEditor(false)}
      />
    );
  }

  return (
    // Root mirrors <body> from both Desktop + Mobile HTML shells.
    // Desktop UI (large devices) keeps every className verbatim from Home.html
    // Mobile UI (HomeMobile.html) is rendered exclusively on <lg via lg:hidden.
    <div className={`bg-surface font-body-md text-body-md text-on-surface antialiased${highContrast ? ' high-contrast-mode' : ''}${dyslexiaFont ? ' dyslexia-font' : ''}`}>
      <style>{FIDELITY_STYLES}</style>
      {/* Material symbols + scrollbar helpers — shared verbatim from HomeMobile.html <style> */}
      <style>{`.material-symbols-outlined{font-variation-settings:'FILL' 0,'wght' 500,'GRAD' 0,'opsz' 24;display:inline-block;vertical-align:middle;line-height:1}.material-symbols-fill{font-variation-settings:'FILL' 1,'wght' 600,'GRAD' 0,'opsz' 24}.scrollbar-none::-webkit-scrollbar{display:none}.scrollbar-none{-ms-overflow-style:none;scrollbar-width:none}.accommodations-scroll{scrollbar-width:thin;scrollbar-color:#c4c5d7 transparent}.accommodations-scroll::-webkit-scrollbar{display:block;width:6px}.accommodations-scroll::-webkit-scrollbar-thumb{background:#c4c5d7;border-radius:9999px}.accommodations-scroll::-webkit-scrollbar-track{background:transparent}`}</style>

      {/* ===================== DESKTOP SHELL (lg+) ===================== */}
      <div className="hidden lg:block">
        <header className="fixed top-0 left-0 right-0 z-50 bg-surface-container-lowest/90 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.04)]"><div className="h-20 w-full px-gutter-mobile lg:px-gutter flex items-center justify-between gap-space-md"><div className="flex items-center gap-space-md shrink-0"><a className="flex items-center gap-space-sm focus:outline-none focus:ring-4 focus:ring-primary-container rounded-full" data-path="browse-opportunities" href="#" onClick={() => { setView('browse'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBCDjVcBc3SNANVDT_ft-chQPXJCLOQGldM-AKBAD84S97xfkIkmjOznYOtxgWiW5Dbv2hTdSkGJo8eDJF1uCwzv-W-Ghj0kM_grRYiD-0zFLledBnQ9udNAAE2K36tqe-gOPhRfYoS38KIQ3At2QtkO6UFAKvlJja-KOoArAyMH27rewac-QfhWctu8fNbtWxq40lHIyPqF-yjA0mQbO0CWxR1-sKK_GV4uKF8obS2ONVis9Nykdf-Oqp7fqxZegFIOvE" alt="AccessAble Logo" className="h-10 w-auto object-contain" /><div className="flex flex-col"><span className="font-headline-sm text-headline-sm text-primary tracking-tight font-extrabold">AccessAble</span></div></a></div><div className="hidden md:flex flex-1 max-w-xl mx-space-sm"><div className="w-full flex items-center bg-surface-container-low px-space-md py-space-xs rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.04)] focus-within:outline-none focus-within:ring-0 focus-within:border-transparent"><span className="material-symbols-outlined text-outline mr-space-sm">search</span><input aria-label="Search inclusive jobs, internships, accommodations" className="w-full bg-transparent border-none outline-none focus:outline-none focus:ring-0 focus:border-transparent font-body-sm text-body-sm text-on-surface placeholder:text-outline" style={{ outline: 'none', boxShadow: 'none' }} placeholder="Search inclusive jobs, internships, accommodations..." type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div></div><nav className="hidden xl:flex items-center gap-space-xs bg-surface-container-low p-1.5 rounded-full" data-active-classes="bg-primary text-on-primary font-label-md rounded-full shadow-sm"><button aria-current={view === "browse" ? "page" : undefined} className={view === "browse" ? "px-space-md py-2 transition-all bg-primary text-on-primary font-label-md rounded-full shadow-sm" : "px-space-md py-2 rounded-full font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-all"} onClick={() => setView("browse")} type="button">Browse Opportunities</button><button aria-current={view === "saved" ? "page" : undefined} className={view === "saved" ? "px-space-md py-2 transition-all bg-primary text-on-primary font-label-md rounded-full shadow-sm flex items-center gap-1.5" : "px-space-md py-2 rounded-full font-label-md text-label-md text-on-surface-variant hover:text-on-surface transition-all flex items-center gap-1.5"} onClick={() => setView("saved")} type="button">Saved Bookmarks{bookmarked.length > 0 ? (<span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-secondary-container px-1 font-label-sm text-label-sm font-bold text-on-secondary-fixed">{bookmarked.length}</span>) : null}</button></nav><div className="flex items-center gap-space-sm shrink-0"><div className="hidden sm:flex items-center gap-1 bg-surface-container-low px-2 py-1 rounded-full text-on-surface-variant"><button aria-pressed={highContrast} className={highContrast ? ACTIVE_A11Y_BTN : A11Y_BTN} onClick={() => setHighContrast((v) => !v)} title="Toggle High Contrast" type="button"><span className="material-symbols-outlined text-[20px]">contrast</span></button><button aria-pressed={largeText} className={largeText ? ACTIVE_A11Y_BTN : A11Y_BTN} onClick={() => setLargeText((v) => !v)} title="Text Size Options" type="button"><span className="material-symbols-outlined text-[20px]">text_fields</span></button><button aria-pressed={dyslexiaFont} className={dyslexiaFont ? ACTIVE_A11Y_BTN : A11Y_BTN} onClick={() => setDyslexiaFont((v) => !v)} title="Universal Accessibility Options" type="button"><span className="material-symbols-outlined text-[20px]">accessibility</span></button></div><button className="hidden sm:inline-flex items-center justify-center bg-primary-container text-on-primary px-space-lg py-2.5 rounded-full font-label-md text-label-md shadow-sm hover:scale-[1.02] focus:outline-none focus:ring-4 focus:ring-secondary-container transition-transform" onClick={openCreateModal} type="button">Post an Opportunity</button><div className="flex items-center ml-space-xs" data-menu-root><div className="relative"><button aria-expanded={profileOpen} aria-haspopup="menu" aria-label="Account menu" className="block rounded-full focus:outline-none focus:ring-4 focus:ring-primary-container" onClick={() => setProfileOpen((v) => !v)} type="button"><img alt="Profile" className="w-8 h-8 rounded-full object-cover ring-2 ring-secondary-container" src={profilePhoto} referrerPolicy="no-referrer" /></button>{profileOpen ? (<div aria-label="Account" role="menu" className="fixed right-4 top-20 z-50 w-64 rounded-2xl bg-surface-container-lowest p-2 shadow-xl ring-1 ring-outline-variant"><div className="flex items-center gap-3 rounded-xl bg-surface-container-low px-3 py-2.5"><img alt="" className="h-9 w-9 rounded-full object-cover" src={profilePhoto} referrerPolicy="no-referrer" /><div className="flex flex-col"><span className="font-label-md text-label-md font-bold text-on-surface">{profileName}</span><span className="font-label-sm text-label-sm text-on-surface-variant">{bookmarked.length} saved {bookmarked.length === 1 ? "opportunity" : "opportunities"}</span></div></div><button role="menuitem" className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container" onClick={handleEditProfile} type="button"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">edit</span>Edit profile</button><button role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container" onClick={() => { setView("saved"); setProfileOpen(false); }} type="button"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">bookmark</span>Saved bookmarks</button><button role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container" onClick={openCreateModal} type="button"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">post_add</span>Post an opportunity</button><button role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container" onClick={() => { resetFilters(); setProfileOpen(false); }} type="button"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">restart_alt</span>Reset all filters</button><button role="menuitem" className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container" onClick={() => setHighContrast((v) => !v)} type="button"><span className="material-symbols-outlined text-[20px]" aria-hidden="true">contrast</span>High contrast: {highContrast ? "on" : "off"}</button></div>) : null}</div></div></div></div></header><aside className="fixed left-0 top-20 bottom-0 w-72 bg-surface-container-lowest shadow-[1px_0_12px_rgba(0,0,0,0.03)] z-40 overflow-y-auto p-space-md flex flex-col gap-space-lg"><div className="flex items-center justify-between pb-space-xs"><div className="flex items-center gap-2"><span className="material-symbols-outlined text-primary text-[20px]">tune</span><span className="font-label-lg text-label-lg font-bold text-on-surface">Faceted Filters</span>{activeFacetCount > 0 ? (<span className="rounded-full bg-primary-fixed px-2 py-0.5 font-label-sm text-label-sm font-bold text-on-primary-fixed">{activeFacetCount} active</span>) : null}</div><button className="font-label-sm text-label-sm text-primary hover:underline" onClick={resetFilters} type="button">Reset</button></div><div className="space-y-space-sm"><span className="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wider">Opportunity Type</span><div className="space-y-1.5"><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={opportunityType.includes("Job/Internship")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setOpportunityType, "Job/Internship")} type="checkbox" value="Job/Internship" />Job/Internship</label><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={opportunityType.includes("Event/Webinar")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setOpportunityType, "Event/Webinar")} type="checkbox" value="Event/Webinar" />Event/Webinar</label><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={opportunityType.includes("Grant/Funding")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setOpportunityType, "Grant/Funding")} type="checkbox" value="Grant/Funding" />Grant/Funding</label><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={opportunityType.includes("Training/Fellowship")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setOpportunityType, "Training/Fellowship")} type="checkbox" value="Training/Fellowship" />Training/Fellowship</label><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={opportunityType.includes("Public Program / Aid")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setOpportunityType, "Public Program / Aid")} type="checkbox" value="Public Program / Aid" />Public Program / Aid</label></div></div><div className="space-y-space-sm"><div className="flex items-center gap-1.5"><span className="material-symbols-outlined text-secondary text-[18px]">verified</span><span className="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wider">Accommodations</span></div><div className="accommodations-scroll max-h-44 space-y-1.5 overflow-y-auto pr-1">{accommodationOptions.map((option) => (<label key={option.key} className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={accommodation.includes(option.label)} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setAccommodation, option.label)} type="checkbox" value={option.label} />{option.label}{option.count > 0 ? (<span className="ml-auto rounded-full bg-surface-container px-1.5 py-0.5 text-[11px] font-bold text-on-surface-variant">{option.count}</span>) : null}</label>))}</div></div><div className="space-y-space-sm"><span className="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wider">Location</span><div className="space-y-1.5"><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={workMode.includes("Remote Only")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setWorkMode, "Remote Only")} type="checkbox" value="Remote Only" />Remote Only</label><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={workMode.includes("Hybrid")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setWorkMode, "Hybrid")} type="checkbox" value="Hybrid" />Hybrid</label><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={workMode.includes("On-site Verified")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setWorkMode, "On-site Verified")} type="checkbox" value="On-site Verified" />On-site Verified</label></div></div><div className="space-y-space-sm"><span className="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wider">Compensation</span><div className="space-y-1.5"><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={compensationType.includes("Free")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setCompensationType, "Free")} type="checkbox" value="Free" />Free</label><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={compensationType.includes("Paid / Stipend")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setCompensationType, "Paid / Stipend")} type="checkbox" value="Paid / Stipend" />Paid / Stipend</label><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={compensationType.includes("Grant Award")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setCompensationType, "Grant Award")} type="checkbox" value="Grant Award" />Grant Award</label></div></div><div className="space-y-space-sm"><span className="font-label-md text-label-md font-bold text-on-surface uppercase tracking-wider">Application Support</span><div className="space-y-1.5"><label className="flex items-center gap-2 text-on-surface-variant hover:text-on-surface cursor-pointer text-body-sm font-body-sm"><input checked={applicationSupport.includes("Multimodal Applications")} className="w-4 h-4 rounded text-primary focus:ring-primary-container" onChange={() => toggleInList(setApplicationSupport, "Multimodal Applications")} type="checkbox" value="Multimodal Applications" />Multimodal Applications</label></div></div></aside><div className="pl-72"><main className="w-full pt-20 bg-surface min-h-[calc(100vh-14rem)]"><div className="flex flex-col w-full">
      <div className="w-full px-gutter-mobile lg:px-gutter py-space-md max-w-7xl mx-auto flex flex-col gap-space-lg">
      <div className="px-gutter-mobile pt-space-md md:hidden"><div className="flex w-full items-center rounded-full bg-surface-container-lowest px-space-md py-space-xs shadow-sm focus-within:outline-none focus-within:ring-0 focus-within:border-transparent"><span className="material-symbols-outlined text-outline mr-space-sm">search</span><input aria-label="Search opportunities" className="w-full border-none bg-transparent outline-none focus:outline-none focus:ring-0 focus:border-transparent font-body-sm text-body-sm text-on-surface placeholder:text-outline" style={{ outline: 'none', boxShadow: 'none' }} placeholder="Search opportunities..." type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></div></div>
      {/* Hero / Discovery Editorial Cluster Section */}
      <section className="relative overflow-hidden bg-surface-container-lowest rounded-xl p-space-lg lg:p-space-xl shadow-sm">
      <div className="absolute -right-20 -top-24 w-96 h-96 rounded-full bg-secondary-container/20 blur-3xl pointer-events-none"></div>
      <div className="absolute -left-12 -bottom-16 w-80 h-80 rounded-full bg-primary-fixed/25 blur-2xl pointer-events-none"></div>
      <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-center">
      {/* Text & Headline Area */}
      <div className="lg:col-span-7 flex flex-col gap-space-md">
      <h1 className="font-headline-xl text-headline-xl text-on-surface tracking-tight font-extrabold">
                  Bringing opportunities closer to PWDs
                </h1>
      <p className="font-body-xl text-body-xl text-on-surface-variant max-w-xl">
                  The central hub for persons with disabilities to discover accessible careers, events, and beneficiary programs with guaranteed support.
                </p>
      {/* Verified Key Stats Pills */}
      <div className="flex flex-wrap items-center gap-space-sm pt-space-xs">
      <div className="order-1 flex items-center gap-2.5 bg-surface-container-low px-4 py-2 rounded-full">
      <span className="w-2.5 h-2.5 rounded-full bg-secondary"></span>
      <span className="font-label-md text-label-md font-bold text-on-surface">{heroRolesLabel}</span>
      </div>
      <div className="order-2 flex items-center gap-2.5 bg-surface-container-low px-4 py-2 rounded-full">
      <span className="w-2.5 h-2.5 rounded-full bg-primary"></span>
      <span className="font-label-md text-label-md font-bold text-on-surface">{heroEmployersLabel}</span>
      </div>
      </div>
      </div>
      {/* Visual Pinterest-Style Editorial Organic Cluster */}
      <div className="lg:col-span-5 relative flex items-center justify-center">
      <div className="relative w-full max-w-sm h-72 sm:h-80 flex items-center justify-center">
      {/* Organic Visual 1: Main dynamic card */}
      <div className="absolute w-44 h-56 rounded-3xl overflow-hidden shadow-lg transform -rotate-3 hover:rotate-0 transition-transform duration-300 z-20 left-4 top-2 bg-primary">
      <img alt="A smiling disabled professional woman in a modern bright creative studio working with assistive screen reading monitors and ergonomic workspace tools." className="w-full h-full object-cover" data-alt="A smiling disabled professional woman in a modern bright creative studio working with assistive screen reading monitors and ergonomic workspace tools." src="https://lh3.googleusercontent.com/aida-public/AB6AXuCKoz9IVr6ByJX88ukbzr6tNn2BBU82sPXGtveRE0NhZDqh6Rrrz6nb4Wkpy-SVPaIIdov0Z1J9bvXCqPehAtTgVTREAuwfxmvO4bsfEyBb1XPYLsa6Qu1G4a0amdQ8Ks9CPiFoqU7JjvH-F057wRA4x2twm7Tt0EyJYGO4AJdNac7dziY68kSNXAIXfMspXyT8bEEEFN311qbxcVjm9XDMts4_3cS9RXYoJLutad6aNtuohlHywfwzjg" />
      </div>
      {/* Organic Visual 2: Secondary overlapping card */}
      <div className="absolute w-40 h-52 rounded-3xl overflow-hidden shadow-md transform rotate-6 hover:rotate-0 transition-transform duration-300 z-10 right-2 top-8 bg-surface-container">
      <img alt="An agile creative designer communicating with colleagues using expressive American Sign Language in an airy, brightly illuminated inclusive workplace." className="w-full h-full object-cover" data-alt="An agile creative designer communicating with colleagues using expressive American Sign Language in an airy, brightly illuminated inclusive workplace." src="https://lh3.googleusercontent.com/aida-public/AB6AXuCDw7XwUBg2ZVu1BrOxRAchx3Qzu1OFSVc3k6J5PX4OCP4DcIuDVkK2MZQj9F3wh1fnGitTF2Ciqo6pnBOUW1vUgVvnm7lPrWm2Fh4A8nSh36Hlgn_4wiEn8wTn0Ign2vfgQp5jfAc49me1KmH60fBq0TTfrS2-jEjVn_PaaK4q4CSRhVsSwpFuajwMrID5bpZgAQrqMbBfelHucsJNz6KDVO6uxHJwgdZzFtmkJ3Fcx9qSNAV3rme5Hw" />
      <div className="absolute top-2 right-2 bg-surface-container-lowest/90 backdrop-blur rounded-full p-1.5 shadow">
      <img alt="AccessAble Emblem" className="w-5 h-5 object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuDtXasFbINsZyg42aA7_TxHxLjvfFB5Nn-QLPrO3VGTMw014NuhsbxOmMcz6vow1jzQo0yCJbfyZMtPuO6_uSpEKnXuZZ6pLK3uLplHCKD4heNJRFzZ55Tc_LBXgMo3P1CCKiYJUcLpqConELHkrj-gDgZWNrdObkws7GRv1heSd_bDhTlTasMkAImN_1ENKwn9ajXpc1sSwfiOkEYQT9eeomNHC3KLlljR_ZAWM2Xo8n3Lmdxvmo1K9coPoVT-Y1IwCOg" />
      </div>
      </div>
      </div>
      </div>
      </div>
      {/* Quick Filter Scroll Pills */}
      <div className="mt-space-lg pt-space-md border-t-0 flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">{QUICK_FILTERS.map((filter) => { const isActive = activeQuickFilter === filter.label; return (<button key={filter.label} aria-pressed={isActive} className={isActive ? ACTIVE_QUICK_FILTER : QUICK_FILTER} onClick={() => setActiveQuickFilter(filter.label)} type="button">{filter.icon ? (<span className={`material-symbols-outlined text-[18px] ${filter.iconClass}`}>{filter.icon}</span>) : null}{filter.label}</button>); })}</div>
      </section>
      {/* AI Smart Search (Gemini) — PWD-first natural language discovery */}
      <AISmartSearch
        idPrefix="desktop"
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onApplyFilters={handleAiFind}
        aiParsing={aiParsing}
        aiNote={aiNote}
      />
      {/* Controls Bar: Result Count & Sorting */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-sm bg-surface-container-lowest px-space-md py-3 rounded-full shadow-sm">
      <div className="flex items-center gap-2">
      <span className="font-headline-sm text-headline-sm text-on-surface font-bold">Showing {visibleCount} {view === "saved" ? (visibleCount === 1 ? "Saved Opportunity" : "Saved Opportunities") : "Opportunities"}</span>
      </div>
      <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
      <label className="font-label-sm text-label-sm text-on-surface-variant font-bold" htmlFor="sort-select">Sort by:</label>
      <div className="relative">
      <select className="appearance-none bg-surface-container-low text-on-surface font-label-md text-label-md rounded-full py-2 pl-4 pr-9 focus:outline-none focus:ring-2 focus:ring-primary cursor-pointer" id="sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
      <option value="Most Relevant">Most Relevant</option>
      <option value="Newest">Newest</option>
      <option value="Highest Accommodation">Highest Accommodation</option>
      </select>
      <span className="material-symbols-outlined text-[18px] absolute right-3 top-2.5 text-on-surface pointer-events-none">expand_more</span>
      </div>
      </div>
      </div>
      {/* Opportunity Cards Grid — live production list from RTDB `/opportunities` (schema v1) */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-space-md">
      {isLoading ? (
        [0, 1, 2, 3].map((skeleton) => (
          <article key={`skeleton-${skeleton}`} aria-busy="true" className="bg-surface-container-lowest rounded-2xl p-space-lg shadow-sm flex flex-col gap-space-md animate-pulse">
            <div className="h-5 w-32 rounded-full bg-surface-container"></div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-surface-container"></div>
              <div className="flex flex-col gap-2 flex-1">
                <div className="h-3 w-28 rounded bg-surface-container"></div>
                <div className="h-5 w-3/4 rounded bg-surface-container"></div>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="h-6 w-24 rounded-full bg-surface-container"></div>
              <div className="h-6 w-28 rounded-full bg-surface-container"></div>
            </div>
            <div className="h-16 rounded-xl bg-surface-container-low"></div>
          </article>
        ))
      ) : loadError ? (
        <div className="col-span-full bg-surface-container-lowest rounded-2xl p-space-lg shadow-sm flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-[32px] text-error">cloud_off</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">Couldn&apos;t load opportunities</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
            Check your connection and Firebase database rules for the <code>opportunities</code> node, then try again.
          </p>
          <button
            className="px-space-lg py-2.5 rounded-full font-label-md text-label-md font-bold bg-primary text-on-primary hover:bg-primary-container shadow-sm transition-transform"
            onClick={() => setRetryTick((tick) => tick + 1)}
            type="button"
          >
            Retry
          </button>
        </div>
      ) : pagedOpportunities.length === 0 ? (
        <div className="col-span-full bg-surface-container-lowest rounded-2xl p-space-lg shadow-sm flex flex-col items-center gap-3 text-center">
          <span className="material-symbols-outlined text-[32px] text-outline">search_off</span>
          <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold">No opportunities match your filters</h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
            {view === 'saved' && bookmarked.length === 0
              ? 'You have not saved any opportunities yet. Tap the bookmark icon on any card to keep it here.'
              : opportunities.length === 0
                ? 'No opportunities have been published yet. Be the first to post an inclusive listing.'
                : 'Try a different search term or clear the filters to see more results.'}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {view === 'saved' && bookmarked.length === 0 ? (
              <button
                className="px-space-lg py-2.5 rounded-full font-label-md text-label-md font-bold bg-primary text-on-primary hover:bg-primary-container shadow-sm transition-transform"
                onClick={() => setView('browse')}
                type="button"
              >
                Browse opportunities
              </button>
            ) : (
              <>
                {opportunities.length === 0 && (
                  <button
                    className="px-space-lg py-2.5 rounded-full font-label-md text-label-md font-bold bg-primary text-on-primary hover:bg-primary-container shadow-sm transition-transform"
                    onClick={openCreateModal}
                    type="button"
                  >
                    Post an opportunity
                  </button>
                )}
                <button
                  className="px-space-lg py-2.5 rounded-full font-label-md text-label-md font-bold bg-surface-container-low text-on-surface hover:bg-surface-container shadow-sm transition-transform"
                  onClick={resetFilters}
                  type="button"
                >
                  Clear search &amp; filters
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        pagedOpportunities.map((opp, index) => {
          const category = getCategoryMeta(opp?.basic?.category);
          const orgName = opp?.basic?.organization?.name || 'Inclusive Employer';
          const title = opp?.basic?.title || 'Untitled opportunity';
          const logoUrl = opp?.basic?.organization?.logo?.downloadURL || null;
          const deliveryLabel = formatDeliveryLabel(opp?.logistics?.deliveryMode);
          const locationLabel = formatLocation(opp);
          const compensation = String(opp?.logistics?.compensation || '').trim();
          const pills = getAccommodationPills(opp);
          const deadline = formatReadableDate(opp?.logistics?.applicationDeadline);
          const startDate = formatReadableDate(opp?.logistics?.startDate);
          const posted = formatPostedAgo(opp);
          const bookmarkedActive = isBookmarked(opp.id);
          const avatarStyle = AVATAR_STYLES[index % AVATAR_STYLES.length];
          const venueFull = String(opp?.logistics?.venueAddress || '').trim();
          return (
            <article key={opp.id} className="bg-surface-container-lowest rounded-2xl p-space-lg shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between gap-space-md relative overflow-hidden group">
              <div className="flex flex-col gap-space-sm">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 font-label-sm text-label-sm px-2.5 py-1 rounded-full font-bold bg-primary-fixed text-on-primary-fixed">
                    <span className="material-symbols-outlined text-[14px]">{category.icon}</span>
                    {category.label}{deliveryLabel ? ` • ${deliveryLabel}` : ''}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    {logoUrl ? (
                      <img src={logoUrl} alt={`${orgName} logo`} className="h-12 w-12 shrink-0 aspect-square rounded-2xl border border-surface-container bg-surface-container-low object-cover object-center" loading="lazy" />
                    ) : (
                      <div className={`h-12 w-12 shrink-0 aspect-square rounded-2xl flex items-center justify-center overflow-hidden font-headline-sm font-bold ${avatarStyle}`}>
                        {getInitials(orgName)}
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-on-surface-variant">{orgName}</span>
                      <h2 className="font-headline-sm text-headline-sm text-on-surface group-hover:text-primary transition-colors">
                        <button className="text-left hover:underline" onClick={() => setDetailsOpp(opp)} type="button">{title}</button>
                      </h2>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center" data-menu-root>
                    <button aria-label={`Bookmark ${title}`} aria-pressed={bookmarkedActive} className={bookmarkedActive ? BOOKMARK_ACTIVE : BOOKMARK_IDLE} onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleBookmark(opp.id); }} type="button"><span className="material-symbols-outlined text-[20px]">{bookmarkedActive ? 'bookmark' : 'bookmark_border'}</span></button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span title={venueFull || locationLabel} className="px-3 py-1 rounded-full bg-surface-container-low text-on-surface font-label-sm text-label-sm font-semibold">{locationLabel}</span>
                  {compensation ? (
                    <span className="px-3 py-1 rounded-full bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm font-bold">{compensation}</span>
                  ) : null}
                </div>
                <div className="pt-space-xs flex flex-col gap-1.5">
                  <span className="font-label-sm text-label-sm text-secondary font-bold flex items-center gap-1.5">
                    <img alt="Verified" className="w-4 h-4 object-contain" src="https://lh3.googleusercontent.com/aida-public/AB6AXuCRZqu5ilMT97zfPV82wMPqykrz0UiB4VZf7w3U3CFuaeVcw5PnwKs_4G3uJCfeT8y2xHsciE8DG7PcRACaKs741hTnfyGOOMpGHBC6utn8u1hawxEI8sRSdNtRrVICqrXz6kmo2oCPTXZ2TZmBrna1h4xtFLXav4WIYxpYoFcnzOHEl5_DNu4h4D7CTTKWSESwLnDcZ_TybF8mKfsWHVzLIPkyQ7zzI5LPdV9Ydroq0suoUA3TWW12Z5Hbdy5nGSX2T2U" />
                    Verified Accommodations Included
                  </span>
                  {pills.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {pills.map((pill, pillIndex) => (
                        <span
                          key={pill.key}
                          className={
                            pillIndex === 0
                              ? 'inline-flex items-center gap-1 px-3 py-1 rounded-full bg-secondary-container/40 text-on-secondary-fixed font-label-sm text-label-sm'
                              : 'inline-flex items-center gap-1 px-3 py-1 rounded-full bg-surface-container text-on-surface font-label-sm text-label-sm'
                          }
                        >
                          <span className={`material-symbols-outlined text-[16px]${pillIndex === 0 ? ' text-secondary' : ''}`}>{pill.icon}</span>
                          {pill.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="font-body-sm text-body-sm text-on-surface-variant">
                      Contact the access coordinator for tailored accommodations.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 pt-space-sm border-t-0 bg-surface-container-low/50 -mx-space-lg -mb-space-lg p-space-md px-space-lg rounded-b-2xl">
                <div className="flex min-w-0 flex-col items-start gap-0.5 text-on-surface-variant font-label-sm text-label-sm">
                  <span className="truncate">{posted}</span>
                  {deadline ? (
                    <span className="font-semibold text-primary">{getDeadlineVerb(opp?.basic?.category)} {deadline}</span>
                  ) : startDate ? (
                    <span className="font-semibold text-primary">Starts {startDate}</span>
                  ) : (
                    <span className="font-semibold text-primary">{countAccommodations(opp)} accommodations</span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    aria-label={`Simplify ${title} into Easy-Read with AI`}
                    onClick={() => openAiSummary(opp)}
                    type="button"
                    title="Simplify with Gemini AI into plain language"
                    className="inline-flex items-center gap-1 px-4 py-2.5 rounded-full font-label-md text-label-md font-bold bg-surface-container-low text-on-surface hover:bg-secondary-container hover:text-on-secondary-fixed transition-all"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">auto_awesome</span>
                    Simplify
                  </button>
                  <button
                    aria-label={`Listen to ${title}`}
                    onClick={() => speakText(`${title} by ${orgName}. ${compensation || ''} ${locationLabel}. ${pills.map((p) => p.label).join(', ') || 'Contact coordinator for accommodations.'}`)}
                    type="button"
                    title="Read this card aloud"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface-container-low text-on-surface hover:bg-secondary-container hover:text-on-secondary-fixed transition-all"
                  >
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">volume_up</span>
                  </button>
                  <button
                    aria-label={`View details for ${title}`}
                    onClick={() => handleViewDetails(opp)}
                    type="button"
                    className="inline-block px-space-lg py-2.5 rounded-full font-label-md text-label-md font-bold bg-primary-fixed text-on-primary-fixed hover:bg-primary-fixed-dim shadow-sm hover:scale-[1.02] transition-all"
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
      <nav aria-label="Pagination Navigation" className="flex items-center justify-center gap-2 pt-space-md pb-space-lg"><button className="px-4 py-2 rounded-full font-label-md text-label-md bg-surface-container-low text-on-surface hover:bg-surface-container transition-colors flex items-center gap-1" disabled={safePage === 1} onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} type="button"><span className="material-symbols-outlined text-[18px]">chevron_left</span>Previous</button><div className="flex items-center gap-1.5">{paginationPages.map((page) => (page === "ellipsis" ? (<span key="ellipsis" className="px-2 text-outline">...</span>) : (<button key={page} aria-current={safePage === page ? "page" : undefined} className={safePage === page ? PAGINATION_ACTIVE : PAGINATION_IDLE} onClick={() => setCurrentPage(page)} type="button">{page}</button>)))}</div><button className="px-4 py-2 rounded-full font-label-md text-label-md bg-surface-container-low text-on-surface hover:bg-surface-container transition-colors flex items-center gap-1" disabled={safePage === totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} type="button">Next<span className="material-symbols-outlined text-[18px]">chevron_right</span></button></nav>
      </div>
      </div></main><footer className="w-full bg-surface-container-lowest shadow-[0_-1px_12px_rgba(0,0,0,0.03)]"><div className="w-full px-gutter-mobile lg:px-gutter py-space-lg flex flex-col md:flex-row items-center justify-between gap-space-md"><div className="flex items-center gap-space-sm"><img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBCWku6ZpPWVXtQt8w0ZpnuVTJ3ERcAUjTsNDCMtXeJoM_KVv2GV-jdxKNW3Q0317oU-QiSsAU5-Hvi-GGS5CG1JQLYor_cZn6TEIabQ179mcPhmD5sa009E6aLgQAVrv9cvBgq9J8RydE-yT9pxn-6N7VY8dDB0qMwlNFiIFinqKFSvCcD6TydKg0JseRyear8GpWElbW9zrbhZsNctm-Dnu5DQjENKBiUSkd19yl1VkxbAuStiBLZnmm06z7zjRsjy60" alt="AccessAble Logo" className="h-6 w-auto object-contain" /><span className="font-body-sm text-body-sm text-on-surface-variant">© 2025 AccessAble. Universal accessibility verified.</span></div><div className="flex items-center gap-space-md font-label-sm text-label-sm text-on-surface-variant"><button className="hover:text-primary transition-colors" onClick={() => setInfoTopic("employer-guide")} type="button">Employer Guide</button><button className="hover:text-primary transition-colors" onClick={() => setInfoTopic("universal-statement")} type="button">Universal Statement</button><button className="hover:text-primary transition-colors" onClick={() => setInfoTopic("privacy")} type="button">Privacy Policy</button><button className="hover:text-primary transition-colors" onClick={() => setInfoTopic("terms")} type="button">Terms</button></div></div></footer></div>
      </div>

      {/* ===================== MOBILE SHELL (<lg) — verbatim from HomeMobile.html ===================== */}
      <div className="lg:hidden bg-background text-on-surface min-h-screen pb-24">
        <div className="max-w-md mx-auto min-h-screen bg-background relative shadow-2xl flex flex-col">
          {/* Top App Bar — HomeMobile.html header 1:1 */}
          <header className="bg-surface-container-lowest sticky top-0 z-40 px-3.5 h-14 w-full flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-1.5">
                <img alt="AccessAble Brand Emblem" className="w-7 h-7 rounded-full object-contain bg-primary-fixed p-1" src="https://lh3.googleusercontent.com/aida/AEtjO1WLbGjCfL8UicmlrkOSPAlssnO2OKaHqD5ZXNt6Y6AnemO3fCsMGqNqSPVA7A6I75AZzg_skLwDxS_Ngo_fHorj7FqRayG9Kme_o1gdhINxcyYDAaX7VKZfR5VjCvoNemrwJEutzuzSgBqrmVq33om0-QkmmQWB-Ok-TjAqe3K6He4LMj2BhdIl3j8FgN7oBdCbMlUT0UxK2nGKlZJPZgAHQg8pDGsOulOofmVt7o2ojH3I30RS1hWZfscJDhxZwJcRDr59vnvcDcc" />
                <div className="flex flex-col leading-tight">
                  <span className="text-[17px] leading-[20px] font-bold text-primary tracking-tight">AccessAble</span>
                  <span className="text-[11px] leading-[14px] text-secondary font-bold tracking-wide">Inclusive Opportunities</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <img className="w-8 h-8 rounded-full object-cover border-2 border-secondary-container shadow-sm" alt={profileName} title={profileName} src={profilePhoto} referrerPolicy="no-referrer" />
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-secondary-container border-2 border-surface-container-lowest rounded-full"></span>
              </div>
            </div>
          </header>

          {/* Sub-header & Quick Accessibility Controls Toolstrip — HomeMobile.html 1:1 with shared a11y state */}
          <section className="bg-surface-container-lowest px-3.5 py-1.5 shadow-sm border-b border-surface-container">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] leading-[14px] font-bold text-on-surface break-words whitespace-normal flex-1 min-w-0">Accessibility toggles</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <button aria-label="Accessibility Settings" aria-pressed={highContrast} onClick={() => setHighContrast((v) => !v)} className={`w-7 h-7 rounded-full flex items-center justify-center active:scale-95 transition-all shrink-0 ${highContrast ? 'bg-secondary-container text-on-secondary-fixed' : 'bg-surface-container-low text-primary hover:bg-surface-container'}`}>
                  <span className="material-symbols-outlined text-[18px]">accessibility_new</span>
                </button>
                <div className="flex items-center gap-0.5 bg-surface-container-low px-1.5 py-0.5 rounded-full border border-outline-variant/30">
                <button onClick={() => setLargeText(false)} className={`px-1 text-xs font-bold transition-colors ${!largeText ? 'text-on-surface' : 'text-on-surface-variant hover:text-primary'}`} title="Decrease font size">A-</button>
                <span className="w-[1px] h-3 bg-outline-variant"></span>
                <button onClick={() => setLargeText(true)} className={`px-1 text-xs font-bold transition-colors ${largeText ? 'text-on-surface bg-secondary-container/40 rounded px-1' : 'text-on-surface hover:text-primary'}`} title="Increase font size">A+</button>
                <span className="w-[1px] h-3 bg-outline-variant"></span>
                <button onClick={() => setHighContrast((v) => !v)} className={`p-0.5 rounded transition-colors flex items-center ${highContrast ? 'text-primary bg-primary-fixed/50' : 'text-on-surface-variant hover:text-primary'}`} title="High Contrast Mode">
                  <span className="material-symbols-outlined text-sm">contrast</span>
                </button>
                <span className="w-[1px] h-3 bg-outline-variant"></span>
                <button aria-label="Dyslexia Font" aria-pressed={dyslexiaFont} onClick={() => setDyslexiaFont((v) => !v)} className={`p-0.5 rounded flex items-center ${dyslexiaFont ? 'text-secondary bg-secondary-container/40' : 'text-secondary font-bold text-xs hover:text-primary'}`} title="Dyslexia Friendly Font">
                  <span className="material-symbols-outlined text-sm">format_letter_spacing</span>
                </button>
                </div>
              </div>
            </div>
          </section>

          {/* Main Content Stream — HomeMobile.html <main> 1:1 but dynamic & logic-bound */}
          <main className="flex-1 px-3.5 pt-3 space-y-3">
            {/* Dynamic Search & Voice Command Bar (Pill Form) — shared searchQuery */}
            <div className="relative bg-surface-container-lowest rounded-full shadow-sm flex items-center p-1 border border-outline-variant/40 focus-within:outline-none focus-within:ring-0 focus-within:border-transparent transition-all">
              <div className="pl-2.5 pr-1.5 flex items-center text-primary">
                <span className="material-symbols-outlined text-[20px]">search</span>
              </div>
              <input
                className="w-full bg-transparent border-none outline-none text-on-surface placeholder:text-outline font-body-sm text-body-sm focus:outline-none focus:ring-0 focus:border-transparent focus:ring-offset-0 p-0"
                style={{ outline: 'none', boxShadow: 'none' }}
                placeholder="Search verified roles, accommodations..."
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <div className="flex items-center gap-1 pr-0.5">
                <button aria-label="Open filter preferences" onClick={() => setMobileFiltersOpen(true)} className="w-8 h-8 rounded-full bg-primary-container text-on-primary hover:bg-primary flex items-center justify-center active:scale-95 transition-all shadow-sm">
                  <span className="material-symbols-outlined text-[18px]">tune</span>
                </button>
              </div>
            </div>

            {/* AI Smart Search (mobile) — voice + natural language via Gemini */}
            <AISmartSearch
              idPrefix="mobile"
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onApplyFilters={handleAiFind}
              aiParsing={aiParsing}
              aiNote={aiNote}
            />

            {/* Category Filter Pills (Horizontal Scroll) — shared activeQuickFilter */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <h2 className="text-[13px] leading-[18px] text-on-surface font-bold">{hasActiveFilters ? 'Filters' : 'Popular'}</h2>
                {hasActiveFilters ? (
                  <button onClick={resetFilters} className="text-[11px] leading-[14px] text-primary font-bold hover:underline">Clear All</button>
                ) : null}
              </div>
              <div className="flex gap-1.5 overflow-x-auto scrollbar-none pb-1 -mx-3.5 px-3.5">
                {MOBILE_QUICK_PILLS.map((pill) => {
                  const reallyActive = activeQuickFilter === pill.label;
                  return (
                    <button
                      key={pill.label}
                      aria-pressed={reallyActive}
                      onClick={() => setActiveQuickFilter(pill.label)}
                      className={reallyActive ? 'flex-shrink-0 bg-primary-container text-on-primary px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-bold shadow-sm flex items-center gap-1 active:scale-95 transition-all' : 'flex-shrink-0 bg-surface-container-lowest text-on-surface border border-outline-variant/60 hover:bg-surface-container px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-semibold shadow-sm flex items-center gap-1 active:scale-95 transition-all'}
                      type="button"
                    >
                      <span className={`material-symbols-outlined text-[13px] ${pill.iconClass || ''}`}>{pill.icon}</span>
                      <span>{pill.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Feed Header — shared visibleCount + sortBy (mobile: compact "{n} found" + ellipsis sort) */}
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex min-w-0 shrink-0 items-center gap-2">
                <h2 className="whitespace-nowrap text-[16px] leading-[22px] font-bold text-on-surface">{visibleCount} found</h2>
              </div>
              <div className="relative flex min-w-0 flex-1 items-center justify-end gap-1 text-outline font-label-sm text-label-sm" data-mobile-sort-root>
                <span className="shrink-0">Sort:</span>
                <button onClick={() => setMobileSortOpen((v) => !v)} className="flex min-w-0 max-w-[150px] items-center gap-0.5 overflow-hidden rounded-full px-2 py-1 font-bold text-primary transition-colors hover:bg-surface-container" type="button">
                  <span className="block min-w-0 flex-1 truncate whitespace-nowrap text-ellipsis">{MOBILE_SORT_OPTIONS.includes(sortBy) ? sortBy : sortBy === 'Highest Accommodation Match' ? 'Highest Accommodation' : sortBy}</span>
                  <span className="material-symbols-outlined shrink-0 text-base transition-transform" style={{ transform: mobileSortOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>arrow_drop_down</span>
                </button>
                <div className={`${mobileSortOpen ? '' : 'hidden'} absolute right-0 top-full mt-2 w-52 bg-surface-container-lowest rounded-2xl shadow-xl border border-outline-variant/40 overflow-hidden z-30`}>
                  <div className="py-1.5">
                    {MOBILE_SORT_OPTIONS.map((opt) => {
                      const normalizedSortBy = sortBy === 'Highest Accommodation Match' ? 'Highest Accommodation' : sortBy;
                      const isActive = normalizedSortBy === opt;
                      return (
                        <button
                          key={opt}
                          data-sort={opt}
                          onClick={() => { setSortBy(opt); setMobileSortOpen(false); }}
                          className={isActive ? 'w-full text-left px-3.5 py-2 text-[13px] leading-[18px] font-bold bg-primary-container text-on-primary flex items-center justify-between gap-2' : 'w-full text-left px-3.5 py-2 text-[13px] leading-[18px] font-semibold text-on-surface hover:bg-surface-container flex items-center justify-between gap-2'}
                          type="button"
                        >
                          <span className="block min-w-0 flex-1 truncate whitespace-nowrap text-ellipsis">{opt}</span>
                          {isActive ? <span className="material-symbols-outlined shrink-0 text-base">check</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Dynamic Opportunity Cards — uses pagedOpportunities shared with desktop */}
            {isLoading ? (
              <div className="space-y-2.5">
                {[0,1,2].map((s) => (
                  <div key={s} className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/40 animate-pulse">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-surface-container"></div>
                      <div className="flex-1 space-y-2">
                        <div className="h-3 w-24 bg-surface-container rounded"></div>
                        <div className="h-4 w-3/4 bg-surface-container rounded"></div>
                      </div>
                    </div>
                    <div className="mt-4 h-12 bg-surface-container-low rounded-2xl"></div>
                  </div>
                ))}
              </div>
            ) : loadError ? (
              <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/40 flex flex-col items-center gap-2.5 text-center">
                <span className="material-symbols-outlined text-[26px] text-error">cloud_off</span>
                <p className="text-[14px] leading-[20px] font-bold text-on-surface">Couldn&apos;t load opportunities</p>
                <button onClick={() => setRetryTick((t) => t+1)} className="bg-primary text-on-primary px-4 py-1.5 rounded-full text-[13px] leading-[18px] font-bold" type="button">Retry</button>
              </div>
            ) : pagedOpportunities.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/40 flex flex-col items-center gap-1.5 text-center">
                <span className="material-symbols-outlined text-[24px] text-outline">search_off</span>
                <h3 className="text-[16px] leading-[22px] font-bold text-on-surface">No opportunities match</h3>
                <p className="font-body-sm text-body-sm text-on-surface-variant">{view === 'saved' && bookmarked.length===0 ? 'No saved bookmarks yet.' : 'Try clearing filters or another search.'}</p>
                <button onClick={resetFilters} className="mt-1.5 bg-surface-container-low px-4 py-1.5 rounded-full text-[13px] leading-[18px] font-bold text-on-surface" type="button">Clear filters</button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {pagedOpportunities.map((opp, index) => {
                  const orgName = opp?.basic?.organization?.name || 'Inclusive Employer';
                  const title = opp?.basic?.title || 'Untitled opportunity';
                  const compensation = String(opp?.logistics?.compensation || '').trim();
                  const deliveryLabel = formatDeliveryLabel(opp?.logistics?.deliveryMode);
                  const categoryMeta = getCategoryMeta(opp?.basic?.category);
                  const pills = getAccommodationPills(opp);
                  const posted = formatPostedAgo(opp);
                  const deadline = formatReadableDate(opp?.logistics?.applicationDeadline);
                  const startDate = formatReadableDate(opp?.logistics?.startDate);
                  const bookmarkedActive = isBookmarked(opp.id);
                  const avatarStyle = AVATAR_STYLES[index % AVATAR_STYLES.length];
                  const logoUrl = opp?.basic?.organization?.logo?.downloadURL || null;
                  const initials = getInitials(orgName);
                  // icons mapping for accommodation pills on mobile: first pill gets primary/secondary tint
                  return (
                    <article key={opp.id} className="bg-surface-container-lowest rounded-2xl p-4 shadow-sm border border-outline-variant/40 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {logoUrl ? (
                            <img src={logoUrl} alt={`${orgName} logo`} className="w-10 h-10 rounded-xl object-cover border border-outline-variant/30 bg-surface-container-low shrink-0" />
                          ) : (
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-[15px] font-extrabold shrink-0 ${avatarStyle}`}>
                              {initials}
                            </div>
                          )}
                          <div className="min-w-0">
                            <span className="text-[13px] leading-[18px] font-bold text-on-surface block truncate">{orgName}</span>
                            <div className="flex items-center gap-1 flex-wrap mt-0.5">
                              <span className="inline-flex items-center gap-0.5 bg-secondary-fixed/50 text-on-secondary-fixed text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                                <span className="material-symbols-outlined text-[12px]">{categoryMeta.icon}</span>
                                <span>{categoryMeta.label}</span>
                              </span>
                              <p className="text-[11px] leading-[14px] text-outline truncate">{deliveryLabel || formatLocation(opp)}</p>
                            </div>
                          </div>
                        </div>
                        <button aria-label={`Save ${title}`} aria-pressed={bookmarkedActive} onClick={(e) => { e.stopPropagation(); e.preventDefault(); toggleBookmark(opp.id); }} className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 ${bookmarkedActive ? 'bg-secondary-container text-on-secondary-fixed' : 'bg-surface-container-low hover:bg-surface-container text-outline hover:text-primary'}`} type="button">
                          <span className="material-symbols-outlined text-[20px]">{bookmarkedActive ? 'bookmark' : 'bookmark_border'}</span>
                        </button>
                      </div>
                      <div className="mt-2.5">
                        <h3 className="text-[16px] leading-[22px] font-bold text-on-surface">
                          <button onClick={() => handleViewDetails(opp)} className="text-left hover:text-primary" type="button">{title}</button>
                        </h3>
                        {compensation && <p className="text-[13px] leading-[18px] text-primary font-bold mt-0.5">{compensation}</p>}
                      </div>
                      {pills.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1">
                          {pills.slice(0,4).map((pill) => (
                            <span key={pill.key} className="inline-flex items-center gap-1 bg-surface-container text-on-surface-variant text-[11px] leading-[14px] font-semibold px-2 py-1 rounded-full">
                              <span className="material-symbols-outlined text-primary text-[13px]">{pill.icon}</span>
                              <span>{pill.label}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-3 pt-2.5 border-t border-surface-container flex items-center justify-between gap-2">
                        <span className="flex min-w-0 flex-col items-start gap-0.5 text-[11px] leading-[14px] text-outline">
                          <span className="flex min-w-0 items-center gap-1">
                            <span className="material-symbols-outlined text-[14px]">history</span>
                            <span className="truncate">{posted}</span>
                          </span>
                          {deadline ? (
                            <span className="truncate font-semibold text-primary">{getDeadlineVerb(opp?.basic?.category)} {deadline}</span>
                          ) : startDate ? (
                            <span className="truncate font-semibold text-primary">Starts {startDate}</span>
                          ) : null}
                          <span className="flex items-center gap-1 pt-1">
                            <button onClick={() => openAiSummary(opp)} className="inline-flex items-center gap-0.5 rounded-full bg-surface-container px-2 py-1 text-[11px] font-bold text-on-surface hover:bg-secondary-container hover:text-on-secondary-fixed transition-colors" type="button" aria-label={`Simplify ${title} with AI`}>
                              <span className="material-symbols-outlined text-[13px]">auto_awesome</span> Simplify
                            </button>
                            <button onClick={() => speakText(`${title} by ${orgName}. ${compensation || ''}. ${(pills || []).map((p) => p.label).join(', ')}`)} className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-surface-container text-on-surface hover:bg-secondary-container hover:text-on-secondary-fixed transition-colors" type="button" aria-label={`Listen to ${title}`}>
                              <span className="material-symbols-outlined text-[14px]">volume_up</span>
                            </button>
                          </span>
                        </span>
                        <button onClick={() => handleViewDetails(opp)} className="bg-primary-fixed text-on-primary-fixed hover:bg-primary-fixed-dim text-[13px] leading-[18px] font-bold px-3.5 py-1.5 rounded-full transition-all flex items-center gap-1 active:scale-95 shadow-sm shrink-0" type="button">
                          <span>View Details</span>
                          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {/* Mobile pagination — shares desktop pagination state */}
            {totalPages > 1 && !isLoading && !loadError && pagedOpportunities.length > 0 && (
              <nav aria-label="Mobile pagination" className="flex items-center justify-center gap-1 pt-1.5">
                <button disabled={safePage===1} onClick={() => setCurrentPage((p)=>Math.max(1,p-1))} className="px-3 py-1.5 rounded-full text-on-surface bg-surface-container-low disabled:opacity-40 flex items-center gap-1 text-[12px] leading-[16px] font-semibold" type="button"><span className="material-symbols-outlined text-[14px]">chevron_left</span>Prev</button>
                <span className="text-[12px] leading-[16px] text-on-surface font-bold px-2">{safePage} / {totalPages}</span>
                <button disabled={safePage===totalPages} onClick={() => setCurrentPage((p)=>Math.min(totalPages,p+1))} className="px-3 py-1.5 rounded-full text-on-surface bg-surface-container-low disabled:opacity-40 flex items-center gap-1 text-[12px] leading-[16px] font-semibold" type="button">Next<span className="material-symbols-outlined text-[14px]">chevron_right</span></button>
              </nav>
            )}
          </main>

          {/* Bottom Navigation Bar — mobile only (lg:hidden shell). Single-select radio group:
              only one tab is selected at a time; Profile opens Signup in edit mode. */}
          <nav role="radiogroup" aria-label="Primary" className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 py-1.5 max-w-md mx-auto right-0 bg-surface-container-lowest shadow-lg border-t border-surface-container" onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const radios = Array.from(e.currentTarget.querySelectorAll('[role="radio"]'));
            const idx = radios.indexOf(document.activeElement);
            if (idx === -1) return;
            e.preventDefault();
            const next = e.key === 'ArrowRight' ? (idx + 1) % radios.length : (idx - 1 + radios.length) % radios.length;
            radios[next]?.focus();
          }}>
            <button role="radio" aria-checked={mobileTab === 'browse'} aria-label="Browse" tabIndex={mobileTab === 'browse' ? 0 : -1} onClick={() => { setMobileTab('browse'); setView('browse'); setMobileFiltersOpen(false); window.scrollTo({top:0,behavior:'smooth'}); }} className={`flex flex-col items-center justify-center min-w-[60px] min-h-[44px] rounded-xl px-2.5 py-0.5 active:scale-95 transition-transform duration-150 ${mobileTab==='browse' ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`} type="button">
              <span className={`material-symbols-outlined text-[22px] leading-none ${mobileTab==='browse' ? 'material-symbols-fill' : ''}`}>explore</span>
              <span className="text-[11px] leading-[14px] font-bold">Browse</span>
            </button>
            <button role="radio" aria-checked={mobileTab === 'post'} aria-label="Post" tabIndex={mobileTab === 'post' ? 0 : -1} onClick={() => { setMobileTab('post'); openCreateModal(); }} className={`flex flex-col items-center justify-center min-w-[60px] min-h-[44px] rounded-xl px-2.5 py-0.5 active:scale-95 transition-transform duration-150 ${mobileTab==='post' ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`} type="button">
              <span className={`material-symbols-outlined text-[22px] leading-none ${mobileTab==='post' ? 'material-symbols-fill' : ''}`}>add_circle</span>
              <span className="text-[11px] leading-[14px] font-bold">Post</span>
            </button>
            <button role="radio" aria-checked={mobileTab === 'saved'} aria-label="Saved" tabIndex={mobileTab === 'saved' ? 0 : -1} onClick={() => { setMobileTab('saved'); setView('saved'); setMobileFiltersOpen(false); window.scrollTo({top:0,behavior:'smooth'}); }} className={`flex flex-col items-center justify-center min-w-[60px] min-h-[44px] rounded-xl px-2.5 py-0.5 active:scale-95 transition-transform duration-150 relative ${mobileTab==='saved' ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`} type="button">
              <span className={`material-symbols-outlined text-[22px] leading-none ${mobileTab==='saved' ? 'material-symbols-fill' : ''}`}>bookmark</span>
              {bookmarked.length>0 && <span className="absolute top-0.5 right-2.5 w-4 h-4 bg-secondary-container text-on-secondary-container text-[10px] font-extrabold rounded-full flex items-center justify-center">{bookmarked.length}</span>}
              <span className="text-[11px] leading-[14px] font-bold">Saved</span>
            </button>
            <button role="radio" aria-checked={mobileTab === 'profile'} aria-label="Profile — edit your profile" tabIndex={mobileTab === 'profile' ? 0 : -1} onClick={() => { setMobileTab('profile'); handleEditProfile(); }} className={`flex flex-col items-center justify-center min-w-[60px] min-h-[44px] rounded-xl px-2.5 py-0.5 active:scale-95 transition-transform duration-150 ${mobileTab==='profile' ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'}`} type="button">
              {currentUser?.photoURL ? (
                <img src={profilePhoto} alt={profileName} referrerPolicy="no-referrer" className="w-[22px] h-[22px] rounded-full object-cover" />
              ) : (
                <span className="material-symbols-outlined text-[22px] leading-none">person</span>
              )}
              <span className="text-[11px] leading-[14px] font-bold">Profile</span>
            </button>
          </nav>

          {/* Filters BottomSheet Modal — React port of HomeMobile.html vanilla JS */}
          {mobileFiltersOpen && <div onClick={() => setMobileFiltersOpen(false)} className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-sm z-40 max-w-md mx-auto" aria-hidden="true"></div>}
          <div className={`${mobileFiltersOpen ? '' : 'hidden'} fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-surface-container-lowest rounded-t-3xl shadow-2xl z-50 max-h-[80vh] flex flex-col overflow-hidden`} style={{ transform: mobileFiltersOpen ? 'translateY(0)' : 'translateY(100%)', transition: 'transform 300ms cubic-bezier(0.32, 0.72, 0, 1)' }}>
            <div className="flex justify-center pt-2.5 pb-1.5">
              <span className="w-9 h-1 bg-outline-variant rounded-full"></span>
            </div>
            <div className="flex items-center justify-between px-4 pb-2.5 border-b border-surface-container">
              <h3 className="text-[17px] leading-[22px] font-bold text-on-surface">Filters</h3>
              <div className="flex items-center gap-1.5">
                <button onClick={() => { resetFilters(); }} className="text-[12px] leading-[16px] font-bold text-primary hover:underline px-2 py-1" type="button">Clear All</button>
                <button aria-label="Close filters" onClick={() => setMobileFiltersOpen(false)} className="w-8 h-8 rounded-full bg-surface-container-low hover:bg-surface-container flex items-center justify-center text-on-surface active:scale-95 transition-all" type="button">
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scrollbar-none">
              <div>
                <h4 className="text-[13px] leading-[18px] font-bold text-on-surface mb-2">Opportunity Type</h4>
                <div className="flex flex-wrap gap-1.5">
                  {MOBILE_FILTER_PILLS.map((pill) => {
                    const isActive = (pill.key === 'all' && activeQuickFilter === 'All Opportunities') || (pill.quickKey && activeQuickFilter === pill.quickKey);
                    return (
                      <button
                        key={pill.key}
                        onClick={() => {
                          if (pill.key === 'all') setActiveQuickFilter('All Opportunities');
                          else setActiveQuickFilter(pill.quickKey);
                        }}
                        className={isActive ? 'bg-primary text-on-primary px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-bold shadow-sm flex items-center gap-1' : 'bg-surface-container-low border border-outline-variant/60 text-on-surface px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-semibold flex items-center gap-1 hover:bg-surface-container'}
                        type="button"
                      >
                        <span className={`material-symbols-outlined text-[13px] ${pill.iconClass || ''}`}>{pill.icon}</span>
                        <span>{pill.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <h4 className="text-[13px] leading-[18px] font-bold text-on-surface mb-2">More types</h4>
                <div className="flex flex-wrap gap-1.5">
                  <label className="inline-flex items-center gap-1.5 bg-surface-container px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-semibold text-on-surface cursor-pointer hover:bg-surface-container-high">
                    <input type="checkbox" checked={opportunityType.includes('Public Program / Aid')} onChange={() => toggleInList(setOpportunityType, 'Public Program / Aid')} className="rounded text-primary focus:ring-primary w-3.5 h-3.5" /> Public Program / Aid
                  </label>
                </div>
              </div>
              <div>
                <h4 className="text-[13px] leading-[18px] font-bold text-on-surface mb-2">Location</h4>
                <div className="flex flex-wrap gap-1.5">
                  <label className="inline-flex items-center gap-1.5 bg-surface-container px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-semibold text-on-surface cursor-pointer hover:bg-surface-container-high">
                    <input type="checkbox" checked={workMode.includes('Remote Only')} onChange={() => toggleInList(setWorkMode, 'Remote Only')} className="rounded text-primary focus:ring-primary w-3.5 h-3.5" /> Remote
                  </label>
                  <label className="inline-flex items-center gap-1.5 bg-surface-container px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-semibold text-on-surface cursor-pointer hover:bg-surface-container-high">
                    <input type="checkbox" checked={workMode.includes('Hybrid')} onChange={() => toggleInList(setWorkMode, 'Hybrid')} className="rounded text-primary focus:ring-primary w-3.5 h-3.5" /> Hybrid
                  </label>
                  <label className="inline-flex items-center gap-1.5 bg-surface-container px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-semibold text-on-surface cursor-pointer hover:bg-surface-container-high">
                    <input type="checkbox" checked={workMode.includes('On-site Verified')} onChange={() => toggleInList(setWorkMode, 'On-site Verified')} className="rounded text-primary focus:ring-primary w-3.5 h-3.5" /> On-site
                  </label>
                </div>
              </div>
              <div>
                <h4 className="text-[13px] leading-[18px] font-bold text-on-surface mb-2">Verified Accommodations</h4>
                <div className="accommodations-scroll flex max-h-40 flex-wrap gap-1.5 overflow-y-auto pr-1">
                  {accommodationOptions.map((option) => (
                    <label key={option.key} className="inline-flex items-center gap-1 bg-surface-container px-2.5 py-1.5 rounded-full text-[12px] leading-[16px] font-semibold text-on-surface cursor-pointer hover:bg-surface-container-high">
                      <span className="material-symbols-outlined text-primary text-[13px]">{option.icon}</span> {option.label}
                      {option.count > 0 ? (<span className="rounded-full bg-surface-container-lowest px-1.5 text-[10px] font-bold text-on-surface-variant">{option.count}</span>) : null}
                      <input type="checkbox" checked={accommodation.includes(option.label)} onChange={() => toggleInList(setAccommodation, option.label)} className="rounded text-primary focus:ring-primary w-3.5 h-3.5" />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-[13px] leading-[18px] font-bold text-on-surface mb-2">Compensation</h4>
                <div className="flex flex-wrap gap-1.5">
                  {['Free', 'Paid / Stipend', 'Grant Award'].map((label) => (
                    <label key={label} className="inline-flex items-center gap-1.5 bg-surface-container px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-semibold text-on-surface cursor-pointer hover:bg-surface-container-high">
                      <input type="checkbox" checked={compensationType.includes(label)} onChange={() => toggleInList(setCompensationType, label)} className="rounded text-primary focus:ring-primary w-3.5 h-3.5" /> {label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-[13px] leading-[18px] font-bold text-on-surface mb-2">Application Support</h4>
                <div className="flex flex-wrap gap-1.5">
                  <label className="inline-flex items-center gap-1.5 bg-surface-container px-3 py-1.5 rounded-full text-[12px] leading-[16px] font-semibold text-on-surface cursor-pointer hover:bg-surface-container-high">
                    <input type="checkbox" checked={applicationSupport.includes('Multimodal Applications')} onChange={() => toggleInList(setApplicationSupport, 'Multimodal Applications')} className="rounded text-primary focus:ring-primary w-3.5 h-3.5" /> Multimodal Applications
                  </label>
                </div>
              </div>
            </div>
            <div className="p-3.5 border-t border-surface-container bg-surface-container-lowest flex items-center gap-2.5">
              <button onClick={() => setMobileFiltersOpen(false)} className="flex-1 bg-surface-container hover:bg-surface-container-high text-on-surface text-[13px] leading-[18px] font-bold py-2.5 rounded-full" type="button">Cancel</button>
              <button onClick={() => setMobileFiltersOpen(false)} className="flex-1 bg-primary hover:bg-primary-container text-on-primary text-[13px] leading-[18px] font-bold py-2.5 rounded-full shadow-md" type="button">Show {visibleCount} Results</button>
            </div>
          </div>
        </div>
      </div>

      {/* Shared overlays (toasts, dialogs) — remain outside lg split so they overlay both shells */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {/* Ask Able — floating voice-first Gemini assistant (PWD navigation aid) */}
      <AIAssistant
        opportunities={opportunities}
        visibleCount={visibleCount}
        visibleTitles={pagedOpportunities.slice(0, 5).map((o) => o?.basic?.title || 'Untitled')}
        onApplySuggestion={(suggestion) => handleAiFind(suggestion)}
      />
      {aiSummaryOpp ? (
        <AISummaryDialog
          opportunity={aiSummaryOpp}
          summary={aiSummaryText}
          loading={aiSummaryLoading}
          isAi={aiSummaryIsAi}
          onListen={() => speakText(aiSummaryText)}
          onClose={() => { setAiSummaryOpp(null); if ('speechSynthesis' in window) window.speechSynthesis.cancel(); }}
        />
      ) : null}
      {formModal ? (
        <OpportunityFormModal
          key={formModal.mode === 'edit' ? formModal.opportunity.id : 'create'}
          mode={formModal.mode}
          opportunity={formModal.opportunity}
          onClose={() => setFormModal(null)}
          onSaved={handleFormSaved}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteConfirmDialog opportunity={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={handleDeleted} />
      ) : null}
      {detailsOpp ? (
        <DetailsDialog
          opportunity={opportunities.find((item) => item.id === detailsOpp.id) || detailsOpp}
          bookmarked={isBookmarked(detailsOpp.id)}
          onToggleBookmark={toggleBookmark}
          onEdit={openEditModal}
          onCopyLink={copyOpportunityLink}
          onClose={() => setDetailsOpp(null)}
        />
      ) : null}
      {infoTopic ? <InfoDialog topic={infoTopic} onClose={() => setInfoTopic(null)} /> : null}
    </div>
  );
}

export default Home;