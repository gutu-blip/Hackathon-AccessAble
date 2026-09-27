import React, { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { onValue, ref as dbRef } from 'firebase/database';
import { auth, db } from '../firebase';

/**
 * MobileBottomNav — shared mobile-only bottom navigation bar.
 * Rendered on every page except the landing page (mobile devices only,
 * `lg:hidden`). Mirrors the Home.js bottom nav behaviour:
 * Browse / Post / Saved / Profile (single-select radio group).
 *
 * Props:
 * - active: 'browse' | 'post' | 'saved' | 'profile'
 * - onBrowse, onPost, onSaved, onProfile: navigation callbacks
 * - savedCount: optional override (otherwise subscribed from RTDB /saved/{uid})
 */
function MobileBottomNav({ active = 'browse', onBrowse, onPost, onSaved, onProfile, savedCount }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [savedIds, setSavedIds] = useState([]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setCurrentUser(user || null));
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setSavedIds([]);
      return undefined;
    }
    const savedRef = dbRef(db, `saved/${currentUser.uid}`);
    const unsub = onValue(
      savedRef,
      (snapshot) => {
        const value = snapshot.exists() ? snapshot.val() : null;
        if (!value || typeof value !== 'object') {
          setSavedIds([]);
          return;
        }
        setSavedIds(Object.keys(value));
      },
      () => setSavedIds([])
    );
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [currentUser?.uid]);

  const count = typeof savedCount === 'number' ? savedCount : savedIds.length;
  const photo = currentUser?.photoURL || null;

  const tabClass = (key) =>
    `flex flex-col items-center justify-center min-w-[60px] min-h-[44px] rounded-xl px-2.5 py-0.5 active:scale-95 transition-transform duration-150 ${
      active === key ? 'bg-primary-container text-on-primary' : 'text-on-surface-variant hover:bg-surface-container'
    }`;

  return (
    <nav
      role="radiogroup"
      aria-label="Primary"
      className="lg:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-2 py-1.5 max-w-md mx-auto right-0 bg-surface-container-lowest shadow-lg border-t border-surface-container"
      onKeyDown={(e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        const radios = Array.from(e.currentTarget.querySelectorAll('[role="radio"]'));
        const idx = radios.indexOf(document.activeElement);
        if (idx === -1) return;
        e.preventDefault();
        const next = e.key === 'ArrowRight' ? (idx + 1) % radios.length : (idx - 1 + radios.length) % radios.length;
        radios[next]?.focus();
      }}
    >
      <button
        role="radio"
        aria-checked={active === 'browse'}
        aria-label="Browse"
        tabIndex={active === 'browse' ? 0 : -1}
        onClick={onBrowse}
        className={tabClass('browse')}
        type="button"
      >
        <span className={`material-symbols-outlined text-[22px] leading-none ${active === 'browse' ? 'material-symbols-fill' : ''}`}>
          explore
        </span>
        <span className="text-[11px] leading-[14px] font-bold">Browse</span>
      </button>
      <button
        role="radio"
        aria-checked={active === 'post'}
        aria-label="Post"
        tabIndex={active === 'post' ? 0 : -1}
        onClick={onPost}
        className={tabClass('post')}
        type="button"
      >
        <span className={`material-symbols-outlined text-[22px] leading-none ${active === 'post' ? 'material-symbols-fill' : ''}`}>
          add_circle
        </span>
        <span className="text-[11px] leading-[14px] font-bold">Post</span>
      </button>
      <button
        role="radio"
        aria-checked={active === 'saved'}
        aria-label="Saved"
        tabIndex={active === 'saved' ? 0 : -1}
        onClick={onSaved}
        className={`${tabClass('saved')} relative`}
        type="button"
      >
        <span className={`material-symbols-outlined text-[22px] leading-none ${active === 'saved' ? 'material-symbols-fill' : ''}`}>
          bookmark
        </span>
        {count > 0 && (
          <span className="absolute top-0.5 right-2.5 w-4 h-4 bg-secondary-container text-on-secondary-container text-[10px] font-extrabold rounded-full flex items-center justify-center">
            {count}
          </span>
        )}
        <span className="text-[11px] leading-[14px] font-bold">Saved</span>
      </button>
      <button
        role="radio"
        aria-checked={active === 'profile'}
        aria-label="Profile — edit your profile"
        tabIndex={active === 'profile' ? 0 : -1}
        onClick={onProfile}
        className={tabClass('profile')}
        type="button"
      >
        {photo ? (
          <img src={photo} alt="Profile" referrerPolicy="no-referrer" className="w-[22px] h-[22px] rounded-full object-cover" />
        ) : (
          <span className="material-symbols-outlined text-[22px] leading-none">person</span>
        )}
        <span className="text-[11px] leading-[14px] font-bold">Profile</span>
      </button>
    </nav>
  );
}

export default MobileBottomNav;
