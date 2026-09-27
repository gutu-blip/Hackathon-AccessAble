/**
 * Gemini AI service for AccessAble — PWD-first discovery layer.
 *
 * Uses the Gemini Generative Language REST API directly (no extra npm dep)
 * so the CRA build stays light:
 *   POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={API_KEY}
 *
 * PWD-focused capabilities exposed:
 *  1. parseNaturalLanguageQuery() — "remote jobs with screen reader support"
 *     -> structured catalogue filters (search keywords, quick filter, work mode,
 *        accommodations). Powers the AI Smart Search on Home.
 *  2. summarizeOpportunity() — plain-language / Easy-Read summary of a listing
 *     for cognitive, low-vision and screen-reader users.
 *  3. explainMatch() — "why does this fit me?" explanation grounded in the
 *     listing's verified accommodations.
 *  4. chatWithAble() — "Ask Able" assistant: answers questions about the
 *     catalogue, explains how to navigate/post/apply, grounded in live data.
 *
 * Every function degrades gracefully to a rule-based offline fallback so the
 * UI never breaks when the key is missing, quota is hit, or the user is offline.
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Requires REACT_APP_GEMINI_API_KEY in `.env.local` (never commit keys).
// Create `.env.local` with REACT_APP_GEMINI_API_KEY=... and restart.
// All callers already degrade gracefully to offline fallbacks when missing.
export const GEMINI_API_KEY = process.env.REACT_APP_GEMINI_API_KEY || '';

// gemini-2.0-flash is the current fast + cheap default. If Google retires the
// alias, the service auto-retries with gemini-1.5-flash.
export const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-1.5-flash'];

const GENERATION_DEFAULTS = {
  temperature: 0.4,
  maxOutputTokens: 1024,
};

// ---------------------------------------------------------------------------
// Low-level call
// ---------------------------------------------------------------------------
async function callGeminiRaw(model, body, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini ${model} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .join('\n')
    .trim();
}

export async function callGemini(prompt, { systemInstruction, json = false } = {}) {
  if (!GEMINI_API_KEY) throw new Error('Missing Gemini API key.');
  const body = {
    systemInstruction: systemInstruction
      ? { parts: [{ text: systemInstruction }] }
      : undefined,
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      ...GENERATION_DEFAULTS,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  };
  // Strip undefined keys (Gemini rejects explicit nulls in some fields).
  Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

  let lastError = null;
  for (const model of GEMINI_MODELS) {
    try {
      // eslint-disable-next-line no-await-in-loop
      return await callGeminiRaw(model, body, GEMINI_API_KEY);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Gemini request failed.');
}

// ---------------------------------------------------------------------------
// Helpers shared by fallbacks
// ---------------------------------------------------------------------------
function compactOpportunity(o, index) {
  const features = o?.accessibility?.features || {};
  const enabled = Object.entries(features)
    .filter(([, v]) => v === true)
    .map(([k]) => k.replace(/_/g, ' '));
  return {
    n: index + 1,
    id: o?.id,
    title: o?.basic?.title,
    org: o?.basic?.organization?.name,
    category: o?.basic?.category,
    mode: o?.logistics?.deliveryMode,
    compensation: o?.logistics?.compensation,
    deadline: o?.logistics?.applicationDeadline,
    accommodations: enabled,
  };
}

export function catalogueContext(opportunities, max = 25) {
  const list = (Array.isArray(opportunities) ? opportunities : []).slice(0, max);
  if (!list.length) return 'No opportunities are currently published.';
  return list.map((o, i) => {
    const c = compactOpportunity(o, i);
    return `#${c.n} "${c.title}" by ${c.org} [${c.category}/${c.mode}] pay: ${c.compensation || 'n/a'} deadline: ${c.deadline || 'n/a'} access: ${c.accommodations.join(', ') || 'contact coordinator'}`;
  }).join('\n');
}

// Rule-based NL parser — used when Gemini is unreachable, and as a
// post-processor to guarantee valid filter values.
export function ruleBasedParse(query) {
  const q = String(query || '').toLowerCase();
  const out = {
    searchKeywords: '',
    quickFilter: 'All Opportunities',
    workModes: [],
    accommodations: [],
    categories: [],
  };
  if (!q.trim()) return out;

  if (/(job|work|intern|hire|employ|role|developer|designer|engineer)/.test(q)) {
    out.quickFilter = 'Job/Internship';
    out.categories.push('job');
  } else if (/(event|webinar|workshop|meetup|conference|seminar)/.test(q)) {
    out.quickFilter = 'Event/Webinar';
    out.categories.push('event');
  } else if (/(grant|fund|bursary|scholarship|award)/.test(q)) {
    out.quickFilter = 'Grant/Funding';
    out.categories.push('grant');
  } else if (/(train|fellow|course|bootcamp|learn|certif)/.test(q)) {
    out.quickFilter = 'Training/Fellowship';
    out.categories.push('training');
  }

  if (/\bremote\b|work from home|wfh|online/.test(q)) out.workModes.push('Remote Only');
  if (/\bhybrid\b/.test(q)) out.workModes.push('Hybrid');
  if (/\bon-?site\b|in-?person|onsite|nairobi|kisumu|mombasa/.test(q)) out.workModes.push('On-site Verified');

  const acc = [];
  if (/screen reader|nvda|jaws|low vision|blind|visually impaired|braille|large print/.test(q)) {
    acc.push('Screen Reader Compatible');
  }
  if (/wheelchair|step-?free|mobilit|crutch|ramp|accessible parking/.test(q)) acc.push('Wheelchair / Step-Free');
  if (/\basl\b|sign language|ksl|deaf|hard of hearing|caption|cart|hearing/.test(q)) acc.push('ASL / CART Interpreting');
  if (/flexible|rest break|part-?time|neurodiv|autis|adhd|sensory|quiet|anxiety/.test(q)) {
    acc.push('Flexible Hours / Rest Breaks');
    acc.push('Neurodivergent Friendly');
  }
  out.accommodations = [...new Set(acc)];

  // Keywords = query minus stopwords, kept short for the haystack matcher.
  const stop = new Set(['find', 'show', 'me', 'for', 'with', 'and', 'the', 'that', 'have', 'has', 'are', 'please', 'jobs', 'job']);
  out.searchKeywords = q
    .replace(/[^a-z0-9\s/-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
    .slice(0, 8)
    .join(' ');
  return out;
}

// ---------------------------------------------------------------------------
// 1) Natural-language -> structured filters
// ---------------------------------------------------------------------------
const FILTER_SYSTEM = `You help persons with disabilities discover opportunities on AccessAble, Kenya's inclusive-opportunity hub.
Convert the user's request into JSON filters. Respond with ONLY valid JSON, no markdown.
Schema: {"searchKeywords": string (short keywords for text search, max 8 words),
"quickFilter": one of ["All Opportunities","Job/Internship","Event/Webinar","Grant/Funding","Training/Fellowship"],
"workModes": subset of ["Remote Only","Hybrid","On-site Verified"],
"accommodations": subset of ["Screen Reader Compatible","Wheelchair / Step-Free","ASL / CART Interpreting","Flexible Hours / Rest Breaks","Neurodivergent Friendly"],
"explanation": string (one friendly sentence, plain language, saying what you understood)}`;

export async function parseNaturalLanguageQuery(query) {
  const fallback = ruleBasedParse(query);
  try {
    const raw = await callGemini(`User request: """${String(query).slice(0, 500)}"""`, {
      systemInstruction: FILTER_SYSTEM,
      json: true,
    });
    const cleaned = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const validQuick = ['All Opportunities', 'Job/Internship', 'Event/Webinar', 'Grant/Funding', 'Training/Fellowship'];
    const validModes = ['Remote Only', 'Hybrid', 'On-site Verified'];
    const validAcc = [
      'Screen Reader Compatible',
      'Wheelchair / Step-Free',
      'ASL / CART Interpreting',
      'Flexible Hours / Rest Breaks',
      'Neurodivergent Friendly',
    ];
    return {
      searchKeywords: typeof parsed.searchKeywords === 'string' ? parsed.searchKeywords.slice(0, 120) : fallback.searchKeywords,
      quickFilter: validQuick.includes(parsed.quickFilter) ? parsed.quickFilter : fallback.quickFilter,
      workModes: Array.isArray(parsed.workModes) ? parsed.workModes.filter((m) => validModes.includes(m)) : fallback.workModes,
      accommodations: Array.isArray(parsed.accommodations)
        ? [...new Set(parsed.accommodations.filter((a) => validAcc.includes(a)))]
        : fallback.accommodations,
      explanation:
        typeof parsed.explanation === 'string' && parsed.explanation.trim()
          ? parsed.explanation.trim().slice(0, 280)
          : 'I understood your request and applied matching filters.',
      ai: true,
    };
  } catch (err) {
    return { ...fallback, explanation: 'AI is offline — I applied keyword matching instead.', ai: false, error: err?.message };
  }
}

// ---------------------------------------------------------------------------
// 2) Plain-language / Easy-Read summary
// ---------------------------------------------------------------------------
const SUMMARY_SYSTEM = `You are an accessibility helper for persons with disabilities. Rewrite opportunity listings in plain, Easy-Read language.
Rules: short sentences (max ~15 words each), no jargon, warm encouraging tone, Grade-6 reading level.
Always include: what it is, who it is for, where/how to join, pay if any, deadline, access support, and one next step.
Keep it under 130 words. Use simple bullet lines starting with "- ".`;

export async function summarizeOpportunity(opportunity) {
  const title = opportunity?.basic?.title || 'This opportunity';
  const org = opportunity?.basic?.organization?.name || 'an inclusive organizer';
  const desc = String(opportunity?.details?.descriptionMarkdown || '').slice(0, 2500);
  const features = Object.entries(opportunity?.accessibility?.features || {})
    .filter(([, v]) => v === true)
    .map(([k]) => k.replace(/_/g, ' '))
    .join(', ');
  const prompt = `Summarize in Easy-Read:\nTitle: ${title}\nOrganizer: ${org}\nCategory: ${opportunity?.basic?.category}\nMode: ${opportunity?.logistics?.deliveryMode}\nVenue: ${opportunity?.logistics?.venueAddress || 'n/a'}\nPay: ${opportunity?.logistics?.compensation || 'not stated'}\nDeadline: ${opportunity?.logistics?.applicationDeadline || 'not stated'}\nAccess support: ${features || 'contact coordinator'}\nDetails: ${desc}`;
  try {
    const text = await callGemini(prompt, { systemInstruction: SUMMARY_SYSTEM });
    return { text, ai: true };
  } catch (err) {
    // Offline Easy-Read fallback built from structured fields.
    const pills = features || 'tailored support from the coordinator';
    const text = [
      `- ${title} is offered by ${org}.`,
      `- You can join ${opportunity?.logistics?.deliveryMode === 'remote' ? 'online from home' : `by going to ${opportunity?.logistics?.venueAddress || 'the venue'}`}.`,
      opportunity?.logistics?.compensation ? `- Pay: ${opportunity.logistics.compensation}.` : `- Pay is not stated. Ask the coordinator.`,
      opportunity?.logistics?.applicationDeadline
        ? `- Last day to apply: ${opportunity.logistics.applicationDeadline}.`
        : `- No deadline is shown. Apply early.`,
      `- Access help includes: ${pills}.`,
      `- Next step: open View details, then press Apply Now.`,
    ].join('\n');
    return { text, ai: false, error: err?.message };
  }
}

// ---------------------------------------------------------------------------
// 3) "Why does this fit me?" match explanation
// ---------------------------------------------------------------------------
export async function explainMatch(opportunity, userNeed = '') {
  const c = compactOpportunity(opportunity || {}, 0);
  const prompt = `User access need: """${String(userNeed).slice(0, 300) || 'not stated'}"""\nOpportunity: ${c.title} by ${c.org} [${c.category}/${c.mode}]. Accommodations: ${c.accommodations.join(', ') || 'none listed'}. Pay: ${c.compensation || 'n/a'}. Deadline: ${c.deadline || 'n/a'}.\nIn 2-3 short plain sentences, say who it suits, which access features help, and one thing to confirm with the coordinator. Be honest if access info is missing.`;
  try {
    const text = await callGemini(prompt, {
      systemInstruction: 'You are an honest disability-inclusion adviser. Plain language, encouraging, never invent accommodations.',
    });
    return { text, ai: true };
  } catch (err) {
    const has = c.accommodations.length ? `It lists: ${c.accommodations.join(', ')}.` : 'Access details are limited — confirm with the coordinator before applying.';
    return { text: `${c.title} is a ${c.category} opportunity (${c.mode}). ${has}`, ai: false, error: err?.message };
  }
}

// ---------------------------------------------------------------------------
// 4) "Ask Able" chat — grounded in the live catalogue
// ---------------------------------------------------------------------------
const CHAT_SYSTEM = `You are Able, the friendly voice-first AI guide inside AccessAble, a Kenyan platform where persons with disabilities discover accessible jobs, events, grants, trainings and aid.
How to behave:
- Plain language, short sentences, warm and encouraging. Assume the user may use a screen reader, voice control, or need extra clarity.
- Answer ONLY from the catalogue snapshot provided. Never invent listings, deadlines, pay, or accommodations. If unsure, say so and suggest filters or contacting the coordinator.
- You can also explain how to use the site: search bar, quick pills (All/Job/Event/Grant/Training), Sort, Save/bookmark, View details, Apply Now, Post an opportunity, Saved tab, accessibility toggles (high contrast, large text, dyslexia font).
- When the user asks to find something, end with one line: SUGGEST: <short search phrase> so the app can apply filters.
- Keep replies under 120 words unless the user asks for detail. Offer to read results aloud.`;

export async function chatWithAble(history, opportunities) {
  const snapshot = catalogueContext(opportunities, 30);
  const transcript = (Array.isArray(history) ? history : [])
    .slice(-10)
    .map((m) => `${m.role === 'user' ? 'User' : 'Able'}: ${String(m.text || '').slice(0, 800)}`)
    .join('\n');
  const prompt = `Live catalogue snapshot (use only this):\n${snapshot}\n\nConversation so far:\n${transcript}\n\nReply as Able to the last user message.`;
  try {
    const text = await callGemini(prompt, { systemInstruction: CHAT_SYSTEM });
    return { text, ai: true };
  } catch (err) {
    // Grounded offline fallback: keyword match against the snapshot.
    const lastUser = [...(history || [])].reverse().find((m) => m.role === 'user')?.text || '';
    const parsed = ruleBasedParse(lastUser);
    const matches = (Array.isArray(opportunities) ? opportunities : []).filter((o) => {
      const hay = `${o?.basic?.title} ${o?.basic?.organization?.name} ${o?.basic?.category} ${o?.logistics?.deliveryMode}`.toLowerCase();
      return parsed.searchKeywords
        ? parsed.searchKeywords.split(' ').some((w) => w.length > 2 && hay.includes(w))
        : true;
    }).slice(0, 3);
    const listing = matches.length
      ? ` I found ${matches.length}: ${matches.map((m) => `"${m?.basic?.title}" by ${m?.basic?.organization?.name}`).join('; ')}.`
      : ' I could not match that yet — try "remote jobs", "ASL events", or "grants".';
    return {
      text: `AI is offline, but I can still help with keywords.${listing} You can also use the search bar, quick pills, Sort, and Save buttons. Want me to read the results aloud?`,
      ai: false,
      error: err?.message,
      suggestion: parsed.searchKeywords,
    };
  }
}

/** Extract the machine-readable `SUGGEST: ...` line the chat model may emit. */
export function extractSuggestion(text) {
  const m = String(text || '').match(/SUGGEST:\s*(.+)/i);
  return m ? m[1].trim().slice(0, 120) : null;
}

// ---------------------------------------------------------------------------
// 5) Accessible application plan — Details-page "Apply with confidence" card
// ---------------------------------------------------------------------------
// Turns one listing + the user's stated access need into a concrete plan:
// numbered steps, what to request from the coordinator, and a copy-paste
// message draft. Grounded in the listing so it never invents deadlines/pay.
const PLAN_SYSTEM = `You are an access-to-work coach for persons with disabilities in Kenya. Write plain, encouraging, Easy-Read plans.
Rules: short sentences (max ~15 words), Grade-6 level, no jargon. Never invent accommodations, pay, dates, or contacts — use only what is given. If access info is missing, say to confirm with the coordinator.
Format exactly:
STEPS:
1. ...
2. ...
3. ...
ASK:
- ...
MESSAGE:
> ... (2-3 sentence polite request the user can copy to the coordinator, mentioning their need and asking for the specific support)
Keep the whole reply under 200 words.`;

function fullListingSnapshot(opportunity) {
  const c = compactOpportunity(opportunity || {}, 0);
  const notes = opportunity?.accessibility?.notes || {};
  const noteText = Object.entries(notes)
    .filter(([, v]) => String(v || '').trim())
    .map(([k, v]) => `${k}: ${String(v).slice(0, 200)}`)
    .join(' | ');
  const coord = opportunity?.accessibility?.coordinator || {};
  return [
    `Title: ${c.title || 'n/a'}`,
    `Organizer: ${c.org || 'n/a'} (${opportunity?.basic?.organization?.website || 'no website'})`,
    `Category: ${c.category || 'n/a'} | Mode: ${c.mode || 'n/a'}`,
    `Venue: ${opportunity?.logistics?.venueAddress || 'n/a'}`,
    `Pay: ${c.compensation || 'not stated'} | Deadline: ${c.deadline || 'not stated'} | Starts: ${opportunity?.logistics?.startDate || 'n/a'}`,
    `Accommodations: ${c.accommodations.join(', ') || 'none listed'}`,
    `Access notes: ${noteText || 'none'}`,
    `Coordinator: ${coord.name || 'n/a'} — ${coord.contact || 'no contact'} (notice: ${coord.noticePeriod || 'n/a'})`,
    `Apply at: ${opportunity?.details?.applicationUrl || 'n/a'} | Multimodal: ${opportunity?.details?.multimodalSupport ? 'yes (video/voice/assisted ok)' : 'no'}`,
    `Description: ${String(opportunity?.details?.descriptionMarkdown || '').slice(0, 1500)}`,
  ].join('\n');
}

export async function planAccessibleApplication(opportunity, userNeed = '') {
  const prompt = `User access need: """${String(userNeed).slice(0, 300) || 'not stated — keep the plan general' }"""\n\nListing:\n${fullListingSnapshot(opportunity)}\n\nWrite the accessible application plan now.`;
  try {
    const text = await callGemini(prompt, { systemInstruction: PLAN_SYSTEM });
    return { text, ai: true };
  } catch (err) {
    const c = compactOpportunity(opportunity || {}, 0);
    const coord = opportunity?.accessibility?.coordinator || {};
    const text = [
      'STEPS:',
      `1. Open View details and check the deadline (${c.deadline || 'rolling — apply early'}).`,
      `2. Contact ${coord.name || 'the access coordinator'}${coord.contact ? ` at ${coord.contact}` : ''} and share your access need before you apply.`,
      `3. Prepare your application${opportunity?.details?.multimodalSupport ? ' — video, voice note, or written form are all ok' : ''}, then apply with the Apply button.`,
      'ASK:',
      `- Confirm: ${c.accommodations.slice(0, 3).join(', ') || 'which access support is available for this opportunity'}.`,
      'MESSAGE:',
      `> Hello ${coord.name || 'access team'}, I use ${String(userNeed).slice(0, 80) || 'assistive support'} and I would like to apply for "${c.title || 'this opportunity'}". Please tell me how to request access support. Thank you.`,
    ].join('\n');
    return { text, ai: false, error: err?.message };
  }
}

// ---------------------------------------------------------------------------
// 6) Easy-Read translation — English <-> Kiswahili (Kenyan PWD context)
// ---------------------------------------------------------------------------
const TRANSLATE_SYSTEM = `You translate accessibility summaries between English and Kiswahili for persons with disabilities in Kenya.
Rules: keep it simple and warm (short sentences, no jargon), preserve names, dates, places, and numbers exactly, keep bullet lines starting with "- ", keep under 160 words. Respond with ONLY the translation, no intro.`;

export async function translateEasyRead(text, target = 'Kiswahili') {
  const source = String(text || '').trim().slice(0, 2000);
  if (!source) return { text: '', ai: false };
  const lang = /swahili|kiswahili/i.test(String(target)) ? 'Kiswahili' : 'English';
  try {
    const out = await callGemini(`Translate this into ${lang}:\n"""${source}"""`, {
      systemInstruction: TRANSLATE_SYSTEM,
    });
    return { text: out, ai: true, lang };
  } catch (err) {
    return { text: source, ai: false, lang, error: err?.message };
  }
}

// ---------------------------------------------------------------------------
// 7) Scoped Q&A — "Ask about this opportunity" (Details-page copilot)
// ---------------------------------------------------------------------------
// Unlike chatWithAble (whole catalogue), this answers from ONE listing so
// blind, deaf, low-vision, and cognitive users get instant spoken/plain
// answers without scrolling the full page.
const FOCUSED_QA_SYSTEM = `You are Able, the friendly AI guide inside AccessAble. The user is viewing ONE opportunity and may use a screen reader, voice control, or need extra clarity.
Rules:
- Answer ONLY from the listing snapshot given. Never invent pay, deadlines, venues, contacts, or accommodations.
- Plain language, short sentences, warm and encouraging, under 120 words.
- If the answer is not in the listing, say so in one sentence and point to the access coordinator contact.
- End with one concrete next step (e.g. "Press Apply Now", "Call the coordinator", "Read the Easy-Read summary").`;

export async function askAboutOpportunity(opportunity, question, history = []) {
  const q = String(question || '').trim().slice(0, 600);
  if (!q) return { text: 'Please ask a question about this opportunity.', ai: false };
  const transcript = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((m) => `${m.role === 'user' ? 'User' : 'Able'}: ${String(m.text || '').slice(0, 400)}`)
    .join('\n');
  const prompt = `Listing snapshot (use only this):\n${fullListingSnapshot(opportunity)}\n\nRecent chat:\n${transcript || '(none)'}\n\nUser question: """${q}"""\n\nReply as Able.`;
  try {
    const text = await callGemini(prompt, { systemInstruction: FOCUSED_QA_SYSTEM });
    return { text, ai: true };
  } catch (err) {
    // Grounded offline fallback: answer from structured fields by keyword.
    const hay = q.toLowerCase();
    const c = compactOpportunity(opportunity || {}, 0);
    const coord = opportunity?.accessibility?.coordinator || {};
    let answer = '';
    if (/deadline|close|last day|apply by/.test(hay)) {
      answer = c.deadline ? `The deadline is ${c.deadline}. Apply early if you need access support.` : 'No deadline is shown — it may be rolling. Apply early.';
    } else if (/pay|salary|stipend|cost|fee|amount|free/.test(hay)) {
      answer = c.compensation ? `Pay is listed as: ${c.compensation}.` : 'Pay is not stated. Ask the coordinator.';
    } else if (/where|venue|location|remote|hybrid|onsite|on-site/.test(hay)) {
      answer = `Mode: ${c.mode || 'not stated'}. Venue: ${opportunity?.logistics?.venueAddress || 'not stated'}.`;
    } else if (/access|accommod|wheelchair|screen reader|sign|asl|caption|braille|quiet/.test(hay)) {
      answer = c.accommodations.length
        ? `Verified access: ${c.accommodations.join(', ')}. Confirm details with ${coord.name || 'the coordinator'}${coord.contact ? ` at ${coord.contact}` : ''}.`
        : `No accommodations are listed. Contact ${coord.name || 'the coordinator'}${coord.contact ? ` at ${coord.contact}` : ''} for tailored support.`;
    } else if (/who|organ|company|contact|coord/.test(hay)) {
      answer = `Organizer: ${c.org || 'not stated'}. Coordinator: ${coord.name || 'not stated'}${coord.contact ? ` — ${coord.contact}` : ''}.`;
    } else if (/how|apply|register|step|enroll/.test(hay)) {
      answer = `Press the Apply button to open ${opportunity?.details?.applicationUrl || 'the application link'}. Contact the coordinator first if you need access support.`;
    } else {
      answer = `"${c.title || 'This opportunity'}" by ${c.org || 'an inclusive organizer'} (${c.category || 'opportunity'}, ${c.mode || 'mode TBD'}). Ask me about deadline, pay, venue, access, or how to apply.`;
    }
    return { text: `AI is offline, but here is what the listing says: ${answer}`, ai: false, error: err?.message };
  }
}
