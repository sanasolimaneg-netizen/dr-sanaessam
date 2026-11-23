import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Icon, Toasts, ToastCtx, AuthCtx } from './ui.jsx';
import * as cloud from './cloud.js';
import { LoginPage, NoAccountScreen, BlockedScreen, MustChangeScreen } from './auth.jsx';
import { UsersPage } from './users.jsx';
import { makeCan } from './accounts.js';
import { Home, SubjectPage, ResultsPage } from './pages.jsx';
import { ExamPage, ResultPage } from './exam.jsx';
import { subjectMeta, uid } from './store.js';
import { OWNER_UID } from './firebase-config.js';
import { ProfileButton } from './profile.jsx';

function useHash() {
  const [h, setH] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const f = () => setH(window.location.hash || '#/');
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

function Header() {
  const { can, logout } = React.useContext(AuthCtx);
  return (
    <>
    <header className="site-header">
      <div className="container sh-in">
        <a className="brand" href="#/" aria-label="امتحان المذاكرة، الصفحة الرئيسية">
          <span className="logo"><Icon name="logo" size={22} /></span>
          <span>امتحان المذاكرة</span>
        </a>
        <ProfileButton />
      </div>
    </header>
    <nav className="subnav" aria-label="التنقل">
      <div className="container subnav-in">
        <a className="nav-link" href="#/"><Icon name="home" size={22} /> المواد</a>
        <a className="nav-link" href="#/results"><Icon name="results" size={22} /> نتائجي</a>
        {can.owner && <a className="nav-link" href="#/users"><Icon name="user" size={22} /> المستخدمون</a>}
        {can.owner && <a className="nav-link" href="#/users/new"><Icon name="plus" size={22} /> إضافة مستخدم</a>}
        <button type="button" className="nav-link out" onClick={logout}><Icon name="logout" size={22} /> تسجيل الخروج</button>
      </div>
    </nav>
    </>
  );
}

function NoAccess() {
  return (
    <main className="container home">
      <section className="hero">
        <h1>مش مسموحلك بالصفحة دي</h1>
        <p>المالك هو اللي بيحدد الصفحات المتاحة لكل مستخدم. كلّمه لو محتاج صلاحية.</p>
        <a className="btn primary" href="#/">رجوع للمواد</a>
      </section>
    </main>
  );
}

function App() {
  const hash = useHash();
  const [r, arg] = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [exam, setExam] = useState(null);
  const [toasts, setToasts] = useState([]);
  const { can } = React.useContext(AuthCtx);

  const notify = useCallback((text, kind = 'ok') => {
    const id = uid();
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3800);
  }, []);
  useEffect(() => { cloud.onSyncError(e => notify('مقدرناش نحفظ تغييراتك في حسابك: ' + cloud.friendlyError(e), 'err')); return () => cloud.onSyncError(() => {}); }, [notify]);
  const go = useCallback(p => { window.location.hash = '#/' + p; }, []);
  /* extra: {kind:'wrong', idxs} لو الامتحان من الأخطاء بس (idxs = أرقامها في الامتحان المحفوظ) */
  const startExam = useCallback((qs, name, subject, id, extra) => { setExam({ qs, name, subject, id, kind: 'full', idxs: null, ...extra, aid: uid() }); go('exam'); }, [go]);

  const needsExam = (r === 'exam' || r === 'result') && !exam;
  useEffect(() => { if (needsExam) window.location.replace('#/'); }, [needsExam]);
  useEffect(() => { window.scrollTo(0, 0); }, [hash]);

  let page;
  let title = 'امتحان المذاكرة';
  if (r === 'users') {
    page = can.owner ? <UsersPage openNew={arg === 'new'} /> : <NoAccess />;
    title = 'المستخدمون · امتحان المذاكرة';
  } else if (r === 'results') {
    page = <ResultsPage />;
    title = 'نتائجي · امتحان المذاكرة';
  } else if (r === 'subject' && subjectMeta(arg) && !can.subject(arg)) {
    page = <NoAccess />;
  } else if (r === 'subject' && subjectMeta(arg)) {
    page = <SubjectPage key={arg} subject={arg} startExam={startExam} />;
    title = subjectMeta(arg).label + ' · امتحان المذاكرة';
  } else if (r === 'exam' && exam) {
    page = <ExamPage exam={exam} setExam={setExam} go={go} />;
    title = 'امتحان · ' + exam.name;
  } else if (r === 'result' && exam) {
    page = <ResultPage exam={exam} setExam={setExam} go={go} />;
    title = 'النتيجة · ' + exam.name;
  } else {
    page = <Home />;
  }
  useEffect(() => { document.title = title; }, [title]);

  return (
    <ToastCtx.Provider value={notify}>
      {r !== 'exam' && <Header />}
      {page}
      <footer className="site-footer">
        <div className="container">نتايج امتحاناتك محفوظة في حسابك وبتظهر على أي جهاز تسجّل منه، ومحدش غيرك بيشوفها.</div>
      </footer>
      <Toasts items={toasts} />
    </ToastCtx.Provider>
  );
}

/* الدخول: تحميل ← تسجيل دخول ← فحص الحساب (مفعّل؟ موقوف؟ لازم يغيّر كلمة السر؟) ← تحميل بياناته ← التطبيق */
function Root() {
  const [st, setSt] = useState({ phase: 'boot', user: null, account: null, msg: '' });
  const [retry, setRetry] = useState(0);
  const ready = React.useRef('');

  const open = useCallback(async (user, account) => {
    if (account.mustChange) { setSt({ phase: 'mustchange', user, account, msg: '' }); return; }
    setSt({ phase: 'data', user, account, msg: '' });
    await cloud.attach(user, account);
    ready.current = user.uid;
    setSt({ phase: 'ready', user, account, msg: '' });
  }, []);

  useEffect(() => cloud.watchAuth(async user => {
    if (!user) { ready.current = ''; cloud.detach(); setSt({ phase: 'out', user: null, account: null, msg: '' }); return; }
    if (ready.current === user.uid) return;
    setSt({ phase: 'data', user, account: null, msg: '' });
    try {
      let account = await cloud.getAccount(user.uid);
      /* المالك بيتفعّل تلقائي أول ما يدخل (القواعد بتسمح بده لـ UID المالك بس) */
      if (!account && user.uid === OWNER_UID) account = await cloud.claimOwner(user);
      if (!account) { setSt({ phase: 'noaccount', user, account: null, msg: '' }); return; }
      if (account.active === false && user.uid !== OWNER_UID) { setSt({ phase: 'blocked', user, account, msg: '' }); return; }
      await open(user, account);
    } catch (e) { setSt({ phase: 'error', user, account: null, msg: cloud.friendlyError(e) }); }
  }), [retry, open]);

  const logout = useCallback(() => { window.location.hash = '#/'; return cloud.logout(); }, []);
  const can = React.useMemo(() => makeCan(st.account, !!st.user && st.user.uid === OWNER_UID), [st.account, st.user]);

  if (st.phase === 'out') return <LoginPage />;
  if (st.phase === 'noaccount') {
    return <NoAccountScreen user={st.user} onLogout={logout}
      onClaim={async () => { const a = await cloud.claimOwner(st.user); await open(st.user, a); }} />;
  }
  if (st.phase === 'blocked') return <BlockedScreen onLogout={logout} />;
  if (st.phase === 'mustchange') {
    return <MustChangeScreen onLogout={logout}
      onDone={async () => { await cloud.clearMustChange(st.user.uid); await open(st.user, { ...st.account, mustChange: false }); }} />;
  }
  if (st.phase === 'error') {
    return (
      <main className="login-wrap">
        <div className="card login">
          <h2>مقدرناش نحمّل بياناتك</h2>
          <p className="err-text" role="alert">{st.msg}</p>
          <button className="btn primary block" onClick={() => { ready.current = ''; setRetry(n => n + 1); }}><Icon name="retry" size={16} /> جرّب تاني</button>
          <div className="login-links"><button className="link" onClick={logout}>تسجيل الخروج</button></div>
        </div>
      </main>
    );
  }
  if (st.phase !== 'ready') return <div className="boot" role="status">{st.phase === 'data' ? 'جاري تحميل بياناتك...' : 'جاري التحميل...'}</div>;
  return (
    <AuthCtx.Provider value={{ user: st.user, account: st.account, can, logout }}>
      <App key={st.user.uid} />
    </AuthCtx.Provider>
  );
}

createRoot(document.getElementById('root')).render(<Root />);
