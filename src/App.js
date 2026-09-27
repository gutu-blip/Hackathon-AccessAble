import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import Landing from './Landing';
import Home from './Home';
import Details from './Details';
import SubmissionForm from './SubmissionForm';
import Signup from './Signup';
import MobileBottomNav from './components/MobileBottomNav';

function App() {
  // Landing is the default entry: it sells the AccessAble mission,
  // then funnels users into the catalogue (home) or posting flow.
  const [page, setPage] = useState('landing');
  const [pageHistory, setPageHistory] = useState([]);
  const [selectedOpportunity, setSelectedOpportunity] = useState(null);
  // Signup mode: 'create' for new profiles (from Landing),
  // 'edit' when opened from Home (mobile Profile tab / desktop dropdown)
  // so Signup renders in edit mode for updating profile details.
  const [signupMode, setSignupMode] = useState('create');
  // Home catalogue tab to land on when navigating home via bottom nav
  // (browse vs saved). Passed as initialView so Saved tab works globally.
  const [homeView, setHomeView] = useState('browse');
  // AI filter handoff from Landing's Gemini discovery (parseNaturalLanguageQuery
  // result or Access-Match profile). Forwarded to Home as initialAiFilter so
  // PWDs land in the catalogue with their access filters already applied.
  const [aiFilter, setAiFilter] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => setCurrentUser(user || null));
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const navigate = (next) => {
    if (page === next) return;
    setPageHistory((prev) => [...prev.slice(-20), page]);
    setPage(next);
    window.scrollTo({ top: 0 });
  };

  // Back to the immediate previous page (not a hardcoded destination).
  const goBack = (fallback = 'home') => {
    const prev = pageHistory[pageHistory.length - 1];
    if (!prev) {
      setPage(fallback);
      window.scrollTo({ top: 0 });
      return;
    }
    setPageHistory((h) => h.slice(0, -1));
    setPage(prev);
    window.scrollTo({ top: 0 });
  };

  const goHome = (view = 'browse') => {
    setHomeView(view);
    navigate('home');
  };

  const goPost = () => navigate('submission');

  const goProfile = () => {
    setSignupMode('edit');
    navigate('signup');
  };

  const handleViewDetails = (opportunity) => {
    setSelectedOpportunity(opportunity || null);
    navigate('details');
  };

  if (page === 'details') {
    return (
      <div className="relative">
        <Details
          opportunity={selectedOpportunity}
          opportunityId={selectedOpportunity?.id || null}
          onBack={() => goBack('home')}
          onPostOpportunity={goPost}
          onSelectOpportunity={(opp) => setSelectedOpportunity(opp)}
          onBrowse={() => goHome('browse')}
          onSaved={() => goHome('saved')}
          onEditProfile={goProfile}
        />
      </div>
    );
  }

  if (page === 'submission') {
    return (
      <div className="relative">
        <SubmissionForm
          onBack={() => goBack('home')}
          onBrowse={() => goHome('browse')}
          currentUser={currentUser}
        />
        {/* Mobile bottom nav on all pages except landing */}
        <div className="h-20 lg:hidden" aria-hidden="true" />
        <MobileBottomNav
          active="post"
          onBrowse={() => goHome('browse')}
          onPost={goPost}
          onSaved={() => goHome('saved')}
          onProfile={goProfile}
        />
      </div>
    );
  }

  if (page === 'signup') {
    const isEdit = signupMode === 'edit';
    return (
      <div className="relative">
        <Signup
          mode={signupMode}
          onBack={() => goBack(isEdit ? 'home' : 'landing')}
          onExplore={() => goHome('browse')}
          onComplete={() => goHome('browse')}
        />
        {/* Mobile bottom nav on all pages except landing */}
        <div className="h-20 lg:hidden" aria-hidden="true" />
        <MobileBottomNav
          active="profile"
          onBrowse={() => goHome('browse')}
          onPost={goPost}
          onSaved={() => goHome('saved')}
          onProfile={goProfile}
        />
      </div>
    );
  }

  if (page === 'home') {
    return (
      <div className="relative">
        <Home
          initialView={homeView}
          initialAiFilter={aiFilter}
          onAiFilterConsumed={() => setAiFilter(null)}
          onViewDetails={handleViewDetails}
          onPostOpportunity={goPost}
          onGoLanding={() => navigate('landing')}
          onEditProfile={goProfile}
          onViewChange={(v) => {
            if (v === 'saved' || v === 'browse') setHomeView(v);
          }}
        />
      </div>
    );
  }

  return (
    <Landing
      onExplore={(parsed) => {
        // Landing passes its Gemini-parsed filters (or undefined for plain browse).
        if (parsed && typeof parsed === 'object' && (parsed.searchKeywords !== undefined || parsed.quickFilter)) {
          setAiFilter(parsed);
        } else {
          setAiFilter(null);
        }
        goHome('browse');
      }}
      onPostOpportunity={goPost}
      onSignUp={() => {
        setSignupMode('create');
        navigate('signup');
      }}
    />
  );
}

export default App;
