import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import {
  ACCESS_NEED_OPTIONS,
  ASSISTIVE_TECH_OPTIONS,
  COMMUNICATION_OPTIONS,
  DISABILITY_TYPE_OPTIONS,
  INITIAL_PROFILE_FORM,
  INTEREST_OPTIONS,
  KENYA_COUNTIES,
  LANGUAGE_OPTIONS,
  ROLE_OPTIONS,
  VERIFICATION_METHODS,
  WORK_MODE_OPTIONS,
  clearDraft,
  fetchUserProfile,
  profileToFormValues,
  readDraft,
  saveUserProfile,
  validateAccessStep,
  validateIdentityStep,
  validateVerificationStep,
  writeDraft,
} from './services/profiles';

/* ------------------------------------------------------------------
 * Signup — premium sign-up / profile page for persons with disabilities
 * and/or their caregivers.
 *
 * Flow:  0. Google sign-in (main method)
 *        1. Identity (role, name, county, languages…)
 *        2. Access needs (disability types, assistive tech, comms…)
 *        3. Disability verification + emergency contact + review
 *
 * On success the profile is saved to RTDB `/users/{uid}` (verification
 * document goes to Storage) and the caller navigates to Home.
 * ------------------------------------------------------------------ */

const STEPS = [
  { n: 0, icon: 'login', label: 'Account', title: 'Sign in with Google' },
  { n: 1, icon: 'person', label: 'Identity', title: 'Who is this profile for?' },
  { n: 2, icon: 'accessibility_new', label: 'Access needs', title: 'Personalize your experience' },
  { n: 3, icon: 'verified', label: 'Verify', title: 'Verify & finish' },
];

const INPUT_CLS =
  'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 shadow-sm transition-all focus:border-blue-600 focus:outline-none focus:ring-4 focus:ring-blue-600/15';
const LABEL_CLS = 'text-[13px] font-extrabold text-slate-900';
const ERROR_CLS = 'mt-1 text-[12px] font-bold text-red-600';
const HINT_CLS = 'mt-1 text-[12px] font-medium text-slate-500';

function toggleList(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function friendlyAuthError(code) {
  if (code === 'auth/operation-not-allowed')
    return 'Google sign-in is not enabled for this Firebase project yet. In Firebase Console → Authentication → Sign-in method, enable the Google provider, then try again.';
  if (code === 'auth/popup-closed-by-user') return 'The Google sign-in window was closed before finishing. Try again when ready.';
  if (code === 'auth/popup-blocked') return 'Your browser blocked the Google pop-up. Allow pop-ups for this site and try again.';
  if (code === 'auth/network-request-failed') return 'Network error during sign-in. Check your connection and try again.';
  if (code === 'auth/unauthorized-domain') return 'This domain is not authorized for sign-in. Add it under Firebase Console → Authentication → Settings → Authorized domains.';
  return 'Google sign-in failed. Please try again.';
}

function Chip({ selected, onClick, icon, label, hint, dark }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-2xl border p-3 text-left transition-all focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 ${
        selected
          ? 'border-blue-700 bg-blue-700 text-white shadow-lg shadow-blue-700/25'
          : dark
            ? 'border-white/15 bg-white/5 text-white hover:border-lime-300/60 hover:bg-white/10'
            : 'border-slate-200 bg-white text-slate-900 shadow-sm hover:border-blue-600 hover:shadow'
      }`}
    >
      {icon && (
        <span
          aria-hidden="true"
          className={`material-symbols-outlined shrink-0 text-[20px] ${selected ? 'text-lime-300' : dark ? 'text-lime-300' : 'text-blue-700'}`}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0">
        <span className="block text-[13px] font-extrabold leading-tight">{label}</span>
        {hint && (
          <span className={`mt-0.5 block text-[11px] font-medium leading-snug ${selected ? 'text-blue-100' : dark ? 'text-slate-300' : 'text-slate-500'}`}>
            {hint}
          </span>
        )}
      </span>
      <span
        aria-hidden="true"
        className={`material-symbols-outlined ml-auto shrink-0 text-[18px] ${selected ? 'text-lime-300' : 'text-slate-300'}`}
      >
        {selected ? 'check_circle' : 'circle'}
      </span>
    </button>
  );
}

function PillToggle({ selected, onClick, label }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12px] font-bold transition-all ${
        selected
          ? 'border-slate-900 bg-slate-900 text-white shadow-md'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-900 hover:text-slate-900'
      }`}
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[15px]">
        {selected ? 'check_circle' : 'add'}
      </span>
      {label}
    </button>
  );
}

function Signup({ onComplete, onBack, onExplore, mode = 'create', initialStep }) {
  const isEditMode = mode === 'edit';
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [step, setStep] = useState(() =>
    Number.isInteger(initialStep) ? Math.min(Math.max(initialStep, 0), 3) : 0
  );
  const [form, setForm] = useState(() => ({ ...INITIAL_PROFILE_FORM, ...(readDraft() || {}) }));
  const [errors, setErrors] = useState({});
  const [attempted, setAttempted] = useState(false);
  const [verificationFile, setVerificationFile] = useState(null);
  const [existingDoc, setExistingDoc] = useState(null);
  const [existingProfile, setExistingProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [announce, setAnnounce] = useState('');
  const fileInputRef = useRef(null);
  const headingRef = useRef(null);

  // Listen for Google auth state + prefill returning users.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setAuthLoading(false);
      if (user) {
        setAuthError(null);
        setForm((prev) => ({
          ...prev,
          fullName: prev.fullName || user.displayName || '',
        }));
        try {
          const profile = await fetchUserProfile(user.uid);
          if (profile) {
            setExistingProfile(profile);
            setExistingDoc(profile.verification?.document || null);
            // Merge saved profile under any in-progress draft.
            const draft = readDraft();
            if (!draft) setForm((prev) => ({ ...prev, ...profileToFormValues(profile) }));
          }
        } catch {
          // Offline / rules — profile load is best-effort.
        }
      }
    });
    return unsub;
  }, []);

  // Autosave draft (never includes the file itself).
  useEffect(() => {
    writeDraft(form);
  }, [form]);

  const isCaregiverOnly = form.role === 'caregiver';
  const activeMethod = useMemo(
    () => VERIFICATION_METHODS.find((m) => m.value === form.verificationMethod),
    [form.verificationMethod]
  );

  const set = (name, value) => {
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const focusHeading = (msg) => {
    if (msg) setAnnounce(msg);
    requestAnimationFrame(() => headingRef.current?.focus());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGoogleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      setAnnounce('Signed in with Google. Continue building your profile.');
    } catch (err) {
      setAuthError(friendlyAuthError(err?.code));
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setStep(0);
    } catch {
      // no-op
    }
  };

  const validateStep = (target) => {
    if (target === 0) {
      if (!firebaseUser) {
        setAuthError('Sign in with Google to continue — it keeps your profile safe and portable.');
        return false;
      }
      return true;
    }
    if (target === 1) {
      const e = validateIdentityStep(form);
      setErrors((p) => ({ ...p, ...e }));
      return Object.keys(e).length === 0;
    }
    if (target === 2) {
      const e = validateAccessStep(form, isCaregiverOnly);
      setErrors((p) => ({ ...p, ...e }));
      return Object.keys(e).length === 0;
    }
    const e = {
      ...validateIdentityStep(form),
      ...validateAccessStep(form, isCaregiverOnly),
      ...validateVerificationStep(form, verificationFile, existingDoc),
    };
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goNext = () => {
    setAttempted(true);
    if (!validateStep(step)) {
      setAnnounce('Please fix the highlighted fields before continuing.');
      return;
    }
    setAttempted(false);
    setErrors({});
    const next = Math.min(step + 1, 3);
    setStep(next);
    focusHeading(`Step ${next + 1} of 4: ${STEPS[next].title}`);
  };

  const goBackStep = () => {
    setErrors({});
    setAttempted(false);
    const prev = Math.max(step - 1, 0);
    setStep(prev);
    focusHeading(`Step ${prev + 1} of 4: ${STEPS[prev].title}`);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setErrors((p) => ({ ...p, verificationDocument: 'Verification document must be 10MB or smaller.' }));
      return;
    }
    setVerificationFile(file);
    setErrors((p) => ({ ...p, verificationDocument: undefined }));
  };

  const handleFinish = async (e) => {
    e.preventDefault();
    setAttempted(true);
    setSaveError(null);
    if (!firebaseUser) {
      setStep(0);
      setAuthError('Sign in with Google first — your profile is tied to your Google account.');
      focusHeading('Sign in with Google to continue.');
      return;
    }
    const allErrors = {
      ...validateIdentityStep(form),
      ...validateAccessStep(form, isCaregiverOnly),
      ...validateVerificationStep(form, verificationFile, existingDoc),
    };
    setErrors(allErrors);
    if (Object.keys(allErrors).length > 0) {
      setAnnounce(
        isEditMode
          ? 'Please fix the highlighted fields before saving your changes.'
          : 'Please fix the highlighted fields before creating your profile.'
      );
      return;
    }
    setSaving(true);
    try {
      const payload = await saveUserProfile(firebaseUser.uid, firebaseUser, form, verificationFile, existingDoc);
      clearDraft();
      setAnnounce(
        isEditMode
          ? 'Profile updated successfully. Taking you back.'
          : 'Profile created successfully. Taking you to opportunities.'
      );
      if (typeof onComplete === 'function') onComplete({ uid: firebaseUser.uid, profile: payload });
    } catch (err) {
      console.error('Profile save failed:', err);
      setSaveError(err?.message || 'Could not save your profile. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const err = (name) => (attempted ? errors[name] : undefined);

  return (
    <div className="min-h-screen bg-[#060B1F] font-body-md text-slate-100 antialiased">
      <a
        href="#signup-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-slate-900"
      >
        {isEditMode ? 'Skip to edit-profile form' : 'Skip to sign-up form'}
      </a>
      <div aria-live="polite" role="status" className="sr-only">
        {announce}
      </div>

      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#060B1F]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <button type="button" onClick={onBack} className="flex items-center gap-2" aria-label="Go back to previous page">
            <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-[#1d4ed8] to-[#3b82f6] text-white">
              <span className="material-symbols-outlined text-[18px]">accessible_forward</span>
            </span>
            <span className="leading-tight">
              <span className="block text-[15px] font-extrabold tracking-tight text-white">AccessAble</span>
            </span>
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onExplore}
              className="hidden rounded-full border border-white/20 px-4 py-2 text-[13px] font-bold text-white hover:bg-white/10 sm:inline-flex"
            >
              Browse first
            </button>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-[13px] font-bold text-white hover:bg-white/20"
            >
              <span className="material-symbols-outlined text-[16px]" aria-hidden="true">close</span>
              Exit
            </button>
          </div>
        </div>
      </header>

      <main id="signup-main" className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-12 lg:gap-8 lg:px-8 lg:py-10">
        {/* Brand / reassurance panel */}
        <aside className="lg:col-span-5" aria-label={isEditMode ? 'Edit your profile' : 'Why create a profile'}>
          <div
            className="relative overflow-hidden rounded-3xl border border-white/10 p-5 sm:p-6 lg:sticky lg:top-20 lg:p-7"
            style={{ background: 'linear-gradient(160deg, #12245e 0%, #1d4ed8 55%, #0A1330 100%)' }}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-20"
              style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '32px 32px' }}
            />
            <div className="relative">
              <p className="inline-flex items-center gap-1.5 rounded-full bg-lime-300 px-3 py-1.5 text-[10px] font-extrabold uppercase tracking-[0.14em] text-lime-950">
                <span className="material-symbols-outlined text-[14px]" aria-hidden="true">verified</span>
                For persons with disabilities & caregivers
              </p>
              <h1 tabIndex={-1} ref={headingRef} className="mt-3 text-balance text-[24px] font-extrabold leading-tight tracking-tight text-white outline-none sm:text-[30px] lg:text-[34px]">
                {isEditMode ? 'Edit and update your access profile.' : 'Your access profile unlocks opportunities made for you.'}
              </h1>
              <p className="mt-2 max-w-md text-[13px] leading-relaxed text-blue-100 sm:text-[14px]">
                {isEditMode
                  ? 'Review your details below and save your changes — your matches and applications update right away.'
                  : 'Tell us who you are, what you need, and verify once — we will auto-match you to accessible jobs, events, grants and aid, and attach your accommodations to every application.'}
              </p>

              {/* Stepper */}
              <ol className="mt-5 space-y-2" aria-label="Sign-up progress">
                {STEPS.map((s) => {
                  const done = s.n < step || (!!firebaseUser && s.n === 0);
                  const active = s.n === step;
                  return (
                    <li
                      key={s.n}
                      aria-current={active ? 'step' : undefined}
                      className={`flex items-center gap-3 rounded-2xl border px-3.5 py-2.5 ${
                        active ? 'border-lime-300/70 bg-white/15' : done ? 'border-white/10 bg-white/5' : 'border-white/10 bg-transparent'
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          done ? 'bg-lime-300 text-lime-950' : active ? 'bg-white text-slate-900' : 'bg-white/10 text-white'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[19px]">{done ? 'check' : s.icon}</span>
                      </span>
                      <span>
                        <span className="block text-[10px] font-extrabold uppercase tracking-[0.16em] text-blue-200">
                          Step {s.n + 1} of 4
                        </span>
                        <span className="block text-[13px] font-extrabold text-white">{s.label} — {s.title}</span>
                      </span>
                    </li>
                  );
                })}
              </ol>

              <ul className="mt-5 grid grid-cols-1 gap-2 text-[12px] font-semibold text-blue-100 sm:grid-cols-2">
                {[
                  ['lock', 'Google-secured sign-in'],
                  ['auto_awesome', 'Auto-matched filters'],
                  ['support_agent', 'Accommodations attached'],
                  ['privacy_tip', 'You control visibility'],
                ].map(([icon, label]) => (
                  <li key={label} className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-lime-300" aria-hidden="true">{icon}</span>
                    {label}
                  </li>
                ))}
              </ul>

              {(form.accessNeeds.length > 0 || form.disabilityTypes.length > 0) && (
                <div className="mt-5 rounded-2xl bg-slate-950/50 p-3.5">
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-lime-300">Live personalization preview</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {form.accessNeeds.map((need) => (
                      <span key={need} className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white">
                        {ACCESS_NEED_OPTIONS.find((o) => o.value === need)?.label || need}
                      </span>
                    ))}
                    {form.accessNeeds.length === 0 && (
                      <span className="text-[12px] text-slate-300">Pick access needs to preview your filters.</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Form card */}
        <section className="lg:col-span-7" aria-label="Profile form">
          <div className="overflow-hidden rounded-3xl bg-white text-slate-900 shadow-2xl">
            {/* Progress bar */}
            <div className="border-b border-slate-100 px-5 pb-4 pt-5 sm:px-7" aria-hidden="true">
              <div className="flex items-center justify-between text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-500">
                <span>Step {step + 1} of 4 — {STEPS[step].label}</span>
                <span>{Math.round(((step + 1) / 4) * 100)}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-700 to-lime-500 transition-all"
                  style={{ width: `${((step + 1) / 4) * 100}%` }}
                />
              </div>
            </div>

            <form onSubmit={handleFinish} noValidate className="px-5 py-5 sm:px-7 sm:py-6">
              {/* ============ STEP 0 : GOOGLE ============ */}
              {step === 0 && (
                <div>
                  <h2 className="text-[20px] font-extrabold tracking-tight sm:text-[22px]">Sign in with Google</h2>
                  <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
                    Google is our secure sign-in method — no passwords to remember, and your profile
                    stays linked to an account you already own. We only read your name, email and photo.
                  </p>

                  {authLoading ? (
                    <p className="mt-5 flex items-center gap-2 text-[13px] font-bold text-slate-600">
                      <span className="material-symbols-outlined animate-spin text-[18px]" aria-hidden="true">progress_activity</span>
                      Checking sign-in status…
                    </p>
                  ) : firebaseUser ? (
                    <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                      <div className="flex items-center gap-3">
                        {firebaseUser.photoURL ? (
                          <img src={firebaseUser.photoURL} alt="" className="h-11 w-11 rounded-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-[14px] font-extrabold text-white" aria-hidden="true">
                            {(firebaseUser.displayName || firebaseUser.email || 'A').slice(0, 2).toUpperCase()}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-[14px] font-extrabold">
                            {firebaseUser.displayName || 'Google account'}
                            <span className="material-symbols-outlined text-[16px] text-emerald-600" aria-hidden="true">verified</span>
                          </p>
                          <p className="truncate text-[12px] font-medium text-slate-600">{firebaseUser.email}</p>
                        </div>
                        <button
                          type="button"
                          onClick={handleSignOut}
                          className="ml-auto shrink-0 rounded-full border border-slate-300 px-3.5 py-2 text-[12px] font-extrabold text-slate-700 hover:border-slate-900"
                        >
                          Switch
                        </button>
                      </div>
                      {existingProfile && (
                        <p className="mt-2 text-[12px] font-semibold text-emerald-800">
                          Welcome back — we found your saved profile. Continue to review or update it.
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={goNext}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-3 text-[14px] font-extrabold text-white transition-transform hover:scale-[1.01]"
                      >
                        Continue to your profile
                        <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                      </button>
                    </div>
                  ) : (
                    <div className="mt-5">
                      <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={signingIn}
                        className="inline-flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-900 bg-white px-5 py-3.5 text-[14px] font-extrabold text-slate-900 shadow-lg transition-all hover:bg-slate-900 hover:text-white disabled:opacity-60"
                      >
                        {signingIn ? (
                          <span className="material-symbols-outlined animate-spin text-[20px]" aria-hidden="true">progress_activity</span>
                        ) : (
                          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.1 3.5 2.7.2.1c2.2-2 3.8-5 3.8-8.9z" />
                            <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.6 1.2-4.1 1.2-3.2 0-5.9-2.1-6.8-5l-.1.1-3.7 2.9v.1C3.5 21.5 7.5 24 12 24z" />
                            <path fill="#FBBC05" d="M5.2 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.7.4-2.4l-.1-.2-3.6-2.8-.1.1C.5 8.6 0 10.2 0 12s.5 3.4 1.4 4.9l3.8-2.5z" />
                            <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.5 1.4 6.7l3.8 3C6.1 6.8 8.8 4.7 12 4.7z" />
                          </svg>
                        )}
                        {signingIn ? 'Connecting to Google…' : 'Continue with Google'}
                      </button>
                      <p className="mt-2 text-center text-[12px] font-medium text-slate-500">
                        Secure OAuth 2.0 · We never see your Google password
                      </p>
                    </div>
                  )}

                  {authError && (
                    <div role="alert" className="mt-4 flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-red-800">
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">error</span>
                      <p className="text-[13px] font-semibold">{authError}</p>
                    </div>
                  )}

                  <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    {[
                      ['shield_person', 'Private by default', 'Docs stay visible only to reviewers'],
                      ['bolt', '2-minute setup', 'Verify once, apply everywhere'],
                      ['groups', 'Caregiver-ready', 'Manage a loved one’s profile'],
                    ].map(([icon, title, copy]) => (
                      <div key={title} className="rounded-2xl bg-slate-50 p-3.5">
                        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-900 text-white">
                          <span className="material-symbols-outlined text-[17px]" aria-hidden="true">{icon}</span>
                        </span>
                        <p className="mt-2 text-[13px] font-extrabold">{title}</p>
                        <p className="text-[12px] font-medium text-slate-500">{copy}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ============ STEP 1 : IDENTITY ============ */}
              {step === 1 && (
                <div>
                  <h2 className="text-[20px] font-extrabold tracking-tight sm:text-[22px]">Who is this profile for?</h2>
                  <p className="mt-1 text-[13px] text-slate-600">This helps us personalize matches and address you correctly.</p>

                  <fieldset className="mt-4">
                    <legend className={LABEL_CLS}>I am signing up as *</legend>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {ROLE_OPTIONS.map((r) => (
                        <Chip key={r.value} selected={form.role === r.value} onClick={() => set('role', r.value)} icon={r.icon} label={r.label} hint={r.hint} />
                      ))}
                    </div>
                    {err('role') && <p className={ERROR_CLS}>{err('role')}</p>}
                  </fieldset>

                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS} htmlFor="su-name">Full name *</label>
                      <input id="su-name" autoComplete="name" className={`${INPUT_CLS} mt-1.5`} placeholder="e.g. Amina Wanjiru" value={form.fullName} onChange={(e) => set('fullName', e.target.value)} aria-invalid={err('fullName') ? true : undefined} />
                      {err('fullName') ? <p className={ERROR_CLS}>{err('fullName')}</p> : <p className={HINT_CLS}>Use the name you want organizers to see.</p>}
                    </div>
                    <div>
                      <label className={LABEL_CLS} htmlFor="su-dob">Date of birth</label>
                      <input id="su-dob" type="date" max={new Date().toISOString().slice(0, 10)} className={`${INPUT_CLS} mt-1.5`} value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
                      {err('dateOfBirth') && <p className={ERROR_CLS}>{err('dateOfBirth')}</p>}
                    </div>
                    <div>
                      <label className={LABEL_CLS} htmlFor="su-gender">Gender</label>
                      <select id="su-gender" className={`${INPUT_CLS} mt-1.5`} value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                        <option value="">Prefer not to say</option>
                        <option value="female">Female</option>
                        <option value="male">Male</option>
                        <option value="nonbinary">Non-binary</option>
                        <option value="self_describe">Self-describe in support needs</option>
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS} htmlFor="su-phone">Phone / WhatsApp</label>
                      <input id="su-phone" inputMode="tel" autoComplete="tel" className={`${INPUT_CLS} mt-1.5`} placeholder="+254 700 000 000" value={form.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={err('phone') ? true : undefined} />
                      {err('phone') && <p className={ERROR_CLS}>{err('phone')}</p>}
                    </div>
                    <div>
                      <label className={LABEL_CLS} htmlFor="su-county">County / location *</label>
                      <select id="su-county" className={`${INPUT_CLS} mt-1.5`} value={form.county} onChange={(e) => set('county', e.target.value)} aria-invalid={err('county') ? true : undefined}>
                        <option value="">Select county…</option>
                        {KENYA_COUNTIES.map((c) => <option key={c} value={c}>{c}</option>)}
                        <option value="Outside Kenya">Outside Kenya</option>
                      </select>
                      {err('county') && <p className={ERROR_CLS}>{err('county')}</p>}
                    </div>
                    <div>
                      <span className={LABEL_CLS} id="su-lang-label">Languages *</span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-labelledby="su-lang-label">
                        {LANGUAGE_OPTIONS.map((lang) => (
                          <PillToggle key={lang} label={lang} selected={form.languages.includes(lang)} onClick={() => set('languages', toggleList(form.languages, lang))} />
                        ))}
                      </div>
                      {err('languages') && <p className={ERROR_CLS}>{err('languages')}</p>}
                    </div>
                  </div>

                  {form.role !== 'pwd' && (
                    <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                      <h3 className="flex items-center gap-1.5 text-[14px] font-extrabold">
                        <span className="material-symbols-outlined text-[18px] text-blue-700" aria-hidden="true">family_restroom</span>
                        Caregiver details
                      </h3>
                      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                          <label className={LABEL_CLS} htmlFor="su-recipient">Care recipient’s name *</label>
                          <input id="su-recipient" className={`${INPUT_CLS} mt-1.5`} placeholder="Full name of person you support" value={form.careRecipientName} onChange={(e) => set('careRecipientName', e.target.value)} />
                        </div>
                        <div>
                          <label className={LABEL_CLS} htmlFor="su-rel">Relationship</label>
                          <select id="su-rel" className={`${INPUT_CLS} mt-1.5`} value={form.caregiverRelationship} onChange={(e) => set('caregiverRelationship', e.target.value)}>
                            <option value="">Select…</option>
                            {['Parent', 'Sibling', 'Spouse / partner', 'Child', 'Guardian', 'Professional caregiver', 'Friend', 'Other'].map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="mt-3">
                        <label className={LABEL_CLS} htmlFor="su-care-note">Authorization note</label>
                        <textarea id="su-care-note" rows={2} className={`${INPUT_CLS} mt-1.5`} placeholder="e.g. Authorized by parent to manage applications" value={form.caregiverAuthorizationNote} onChange={(e) => set('caregiverAuthorizationNote', e.target.value)} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ============ STEP 2 : ACCESS NEEDS ============ */}
              {step === 2 && (
                <div>
                  <h2 className="text-[20px] font-extrabold tracking-tight sm:text-[22px]">Personalize your experience</h2>
                  <p className="mt-1 text-[13px] text-slate-600">
                    {isCaregiverOnly
                      ? 'Optional for caregivers — add access needs for the person you support, or skip ahead.'
                      : 'Tell us what you need so every search, filter and application is pre-tuned for you.'}
                  </p>

                  {!isCaregiverOnly && (
                    <fieldset className="mt-4">
                      <legend className={LABEL_CLS}>Disability type(s) * <span className="font-medium text-slate-500">— select all that apply</span></legend>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {DISABILITY_TYPE_OPTIONS.map((d) => (
                          <Chip
                            key={d.value}
                            selected={form.disabilityTypes.includes(d.value)}
                            onClick={() => set('disabilityTypes', toggleList(form.disabilityTypes, d.value))}
                            icon={d.icon}
                            label={d.label}
                          />
                        ))}
                      </div>
                      {err('disabilityTypes') && <p className={ERROR_CLS}>{err('disabilityTypes')}</p>}
                      {form.disabilityTypes.includes('other') && (
                        <div className="mt-2">
                          <label className={LABEL_CLS} htmlFor="su-other">Briefly describe *</label>
                          <input id="su-other" className={`${INPUT_CLS} mt-1.5`} placeholder="e.g. Low vision with light sensitivity" value={form.otherDisabilityDetail} onChange={(e) => set('otherDisabilityDetail', e.target.value)} />
                          {err('otherDisabilityDetail') && <p className={ERROR_CLS}>{err('otherDisabilityDetail')}</p>}
                        </div>
                      )}
                    </fieldset>
                  )}

                  <fieldset className="mt-5">
                    <legend className={LABEL_CLS}>Assistive technology you use</legend>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ASSISTIVE_TECH_OPTIONS.map((t) => (
                        <PillToggle key={t} label={t} selected={form.assistiveTech.includes(t)} onClick={() => set('assistiveTech', toggleList(form.assistiveTech, t))} />
                      ))}
                    </div>
                  </fieldset>

                  <fieldset className="mt-5">
                    <legend className={LABEL_CLS}>Access needs * <span className="font-medium text-slate-500">— powers your smart filters</span></legend>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {ACCESS_NEED_OPTIONS.map((a) => (
                        <Chip
                          key={a.value}
                          selected={form.accessNeeds.includes(a.value)}
                          onClick={() => set('accessNeeds', toggleList(form.accessNeeds, a.value))}
                          icon={a.icon}
                          label={a.label}
                        />
                      ))}
                    </div>
                    {err('accessNeeds') && <p className={ERROR_CLS}>{err('accessNeeds')}</p>}
                  </fieldset>

                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <fieldset>
                      <legend className={LABEL_CLS}>Preferred communication *</legend>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {COMMUNICATION_OPTIONS.map((c) => (
                          <PillToggle key={c} label={c} selected={form.communicationModes.includes(c)} onClick={() => set('communicationModes', toggleList(form.communicationModes, c))} />
                        ))}
                      </div>
                      {err('communicationModes') && <p className={ERROR_CLS}>{err('communicationModes')}</p>}
                    </fieldset>
                    <fieldset>
                      <legend className={LABEL_CLS}>Opportunities you want</legend>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {INTEREST_OPTIONS.map((o) => (
                          <PillToggle key={o.value} label={o.label} selected={form.opportunityInterests.includes(o.value)} onClick={() => set('opportunityInterests', toggleList(form.opportunityInterests, o.value))} />
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {WORK_MODE_OPTIONS.map((w) => (
                          <PillToggle key={w.value} label={w.label} selected={form.workModes.includes(w.value)} onClick={() => set('workModes', toggleList(form.workModes, w.value))} />
                        ))}
                      </div>
                    </fieldset>
                  </div>

                  <div className="mt-4">
                    <label className={LABEL_CLS} htmlFor="su-support">Anything else we should know?</label>
                    <textarea
                      id="su-support"
                      rows={3}
                      className={`${INPUT_CLS} mt-1.5`}
                      placeholder="e.g. I need step-free venues, morning-only events, and materials in advance…"
                      value={form.supportNeeds}
                      onChange={(e) => set('supportNeeds', e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* ============ STEP 3 : VERIFICATION ============ */}
              {step === 3 && (
                <div>
                  <h2 className="text-[20px] font-extrabold tracking-tight sm:text-[22px]">Verify your disability</h2>
                  <p className="mt-1 text-[13px] text-slate-600">
                    Verification keeps AccessAble exclusively for persons with disabilities and helps
                    organizers trust accommodation requests. Documents are reviewed privately — never shown publicly.
                  </p>

                  <fieldset className="mt-4">
                    <legend className={LABEL_CLS}>Verification method *</legend>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {VERIFICATION_METHODS.map((m) => (
                        <Chip
                          key={m.value}
                          selected={form.verificationMethod === m.value}
                          onClick={() => set('verificationMethod', m.value)}
                          icon={m.icon}
                          label={m.label}
                          hint={m.hint}
                        />
                      ))}
                    </div>
                    {err('verificationMethod') && <p className={ERROR_CLS}>{err('verificationMethod')}</p>}
                  </fieldset>

                  {activeMethod?.needsDoc && (
                    <div className="mt-4 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50 p-4">
                      <label className={LABEL_CLS} id="su-doc-label">
                        Upload {activeMethod.label} * <span className="font-medium text-slate-500">— PDF, PNG, JPG or WEBP, max 10MB</span>
                      </label>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <button
                          type="button"
                          aria-labelledby="su-doc-label"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-[13px] font-extrabold text-white hover:bg-slate-700"
                        >
                          <span className="material-symbols-outlined text-[18px]" aria-hidden="true">upload</span>
                          {verificationFile || existingDoc ? 'Replace document' : 'Choose file'}
                        </button>
                        <span className="truncate text-[12px] font-semibold text-slate-600" aria-live="polite">
                          {verificationFile ? `${verificationFile.name} (${(verificationFile.size / 1024).toFixed(0)} KB) — ready` : existingDoc ? `${existingDoc.name || 'Saved document'} — already uploaded` : 'No file selected yet'}
                        </span>
                        {(verificationFile || existingDoc) && (
                          <button
                            type="button"
                            onClick={() => { setVerificationFile(null); setExistingDoc(null); }}
                            className="text-[12px] font-extrabold text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <input ref={fileInputRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" className="sr-only" onChange={handleFileSelect} aria-label="Verification document file" />
                      <p className={HINT_CLS}>Tip: take a clear photo of your NCPWD card or assessment — cover any details you don’t want stored beyond verification.</p>
                      {err('verificationDocument') && <p className={ERROR_CLS}>{err('verificationDocument')}</p>}
                    </div>
                  )}

                  {form.verificationMethod === 'self_declaration' && (
                    <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 px-4 py-3 text-amber-900">
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">info</span>
                      <p className="text-[13px] font-semibold">
                        Self-declared profiles can browse and save immediately. Upload a document later
                        to unlock the <strong>Verified</strong> badge organizers trust most.
                      </p>
                    </div>
                  )}

                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className={LABEL_CLS} htmlFor="su-ref">Card / reference number <span className="font-medium text-slate-500">(optional)</span></label>
                      <input id="su-ref" className={`${INPUT_CLS} mt-1.5`} placeholder="e.g. NCPWD certificate no." value={form.verificationReference} onChange={(e) => set('verificationReference', e.target.value)} />
                    </div>
                    <div>
                      <label className={LABEL_CLS} htmlFor="su-em-rel">Emergency contact relationship</label>
                      <select id="su-em-rel" className={`${INPUT_CLS} mt-1.5`} value={form.emergencyRelationship} onChange={(e) => set('emergencyRelationship', e.target.value)}>
                        <option value="">Select…</option>
                        {['Parent', 'Sibling', 'Spouse / partner', 'Child', 'Guardian', 'Caregiver', 'Friend', 'Other'].map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLS} htmlFor="su-em-name">Emergency contact name *</label>
                      <input id="su-em-name" autoComplete="off" className={`${INPUT_CLS} mt-1.5`} placeholder="e.g. Brian Otieno" value={form.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} aria-invalid={err('emergencyName') ? true : undefined} />
                      {err('emergencyName') && <p className={ERROR_CLS}>{err('emergencyName')}</p>}
                    </div>
                    <div>
                      <label className={LABEL_CLS} htmlFor="su-em-phone">Emergency contact phone *</label>
                      <input id="su-em-phone" inputMode="tel" className={`${INPUT_CLS} mt-1.5`} placeholder="+254 700 000 000" value={form.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} aria-invalid={err('emergencyPhone') ? true : undefined} />
                      {err('emergencyPhone') && <p className={ERROR_CLS}>{err('emergencyPhone')}</p>}
                    </div>
                  </div>
                  {err('careRecipientName') && <p className={ERROR_CLS}>{err('careRecipientName')}</p>}

                  <div className="mt-4 space-y-2">
                    <label className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3.5 ${err('attestAccurate') ? 'border-red-400 bg-red-50/50' : 'border-slate-200 bg-slate-50'}`}>
                      <input type="checkbox" checked={form.attestAccurate} onChange={(e) => set('attestAccurate', e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-blue-700" />
                      <span className="text-[13px] font-semibold">
                        I confirm my details — including disability information — are accurate to the best of my knowledge. *
                      </span>
                    </label>
                    {err('attestAccurate') && <p className={ERROR_CLS}>{err('attestAccurate')}</p>}
                    <label className={`flex cursor-pointer items-start gap-2.5 rounded-2xl border p-3.5 ${err('consentContact') ? 'border-red-400 bg-red-50/50' : 'border-slate-200 bg-slate-50'}`}>
                      <input type="checkbox" checked={form.consentContact} onChange={(e) => set('consentContact', e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-blue-700" />
                      <span className="text-[13px] font-semibold">
                        I consent to AccessAble contacting me about verification and matching opportunities. *
                      </span>
                    </label>
                    {err('consentContact') && <p className={ERROR_CLS}>{err('consentContact')}</p>}
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3.5">
                      <input type="checkbox" checked={form.emailUpdates} onChange={(e) => set('emailUpdates', e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-blue-700" />
                      <span className="text-[13px] font-semibold">Email me new accessible opportunities matching my profile.</span>
                    </label>
                  </div>

                  {/* Review summary */}
                  <div className="mt-4 rounded-2xl bg-slate-900 p-4 text-white">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-lime-300">Review before creating</p>
                    <dl className="mt-2 grid grid-cols-1 gap-1.5 text-[13px] sm:grid-cols-2">
                      <div><dt className="font-bold text-slate-400">Name</dt><dd className="font-extrabold">{form.fullName || '—'}</dd></div>
                      <div><dt className="font-bold text-slate-400">Role</dt><dd className="font-extrabold">{ROLE_OPTIONS.find((r) => r.value === form.role)?.label}</dd></div>
                      <div><dt className="font-bold text-slate-400">Location</dt><dd className="font-extrabold">{form.county || '—'}</dd></div>
                      <div><dt className="font-bold text-slate-400">Verification</dt><dd className="font-extrabold">{activeMethod?.label}{verificationFile || existingDoc ? ' · document attached' : ''}</dd></div>
                      <div className="sm:col-span-2"><dt className="font-bold text-slate-400">Access needs</dt><dd className="font-extrabold">{form.accessNeeds.length ? form.accessNeeds.map((n) => ACCESS_NEED_OPTIONS.find((o) => o.value === n)?.label || n).join(' · ') : '—'}</dd></div>
                    </dl>
                  </div>

                  {saveError && (
                    <div role="alert" className="mt-4 flex items-start gap-2 rounded-2xl bg-red-50 px-4 py-3 text-red-800">
                      <span className="material-symbols-outlined text-[20px]" aria-hidden="true">error</span>
                      <p className="text-[13px] font-semibold">{saveError}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Nav buttons */}
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  {step > 0 ? (
                    <button
                      type="button"
                      onClick={goBackStep}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-5 py-2.5 text-[13px] font-extrabold text-slate-700 hover:border-slate-900"
                    >
                      <span className="material-symbols-outlined text-[17px]" aria-hidden="true">arrow_back</span>
                      Back
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onBack}
                      className="inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[13px] font-bold text-slate-500 hover:text-slate-900"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                {step < 3 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    disabled={step === 0 && !firebaseUser}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-[#1d4ed8] px-6 py-3 text-[14px] font-extrabold text-white shadow-xl shadow-blue-600/25 transition-transform hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {step === 0 ? (isEditMode ? 'Edit my profile' : 'Start my profile') : 'Continue'}
                    <span className="material-symbols-outlined text-[18px]" aria-hidden="true">arrow_forward</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-lime-300 px-6 py-3 text-[14px] font-extrabold text-lime-950 shadow-xl transition-transform hover:scale-[1.02] disabled:opacity-60"
                  >
                    {saving ? (
                      <span className="material-symbols-outlined animate-spin text-[18px]" aria-hidden="true">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-[18px]" aria-hidden="true">celebration</span>
                    )}
                    {saving
                      ? (isEditMode || existingProfile ? 'Saving your changes…' : 'Creating your profile…')
                      : (isEditMode || existingProfile ? 'Save changes & go to Home' : 'Create profile & go to Home')}
                  </button>
                )}
              </div>
              <p className="mt-3 text-center text-[11px] font-medium text-slate-400">
                Protected by Google sign-in · Verification documents are private and never shown publicly
              </p>
            </form>
          </div>
        </section>
      </main>
    </div>
  );
}

export default Signup;
