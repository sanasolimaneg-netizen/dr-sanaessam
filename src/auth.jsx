import React, { useState } from 'react';
import * as cloud from './cloud.js';
import { Icon } from './ui.jsx';
import { isRealEmail } from './accounts.js';

/* صفحة تسجيل الدخول: اسم المستخدم (أو الإيميل) + كلمة السر، أو جوجل (للمالك). الحسابات بينشئها المالك بس */
export function LoginPage() {
  const [reset, setReset] = useState(false);
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  const run = async fn => {
    setBusy(true); setErr(''); setInfo('');
    try { await fn(); } catch (e) { setErr(cloud.friendlyError(e)); }
    setBusy(false);
  };
  const submit = e => {
    e.preventDefault();
    if (!id.trim()) { setErr('اكتب اسم المستخدم.'); return; }
    if (reset) {
      if (!isRealEmail(id)) { setErr('استعادة كلمة السر بتشتغل للحسابات اللي بإيميل حقيقي بس. اطلب من المالك.'); return; }
      return run(async () => { await cloud.resetPassword(id); setInfo('بعتنالك رابط إعادة تعيين كلمة السر على الإيميل (شوف الـ Spam كمان).'); });
    }
    if (!pw) { setErr('اكتب كلمة السر.'); return; }
    return run(() => cloud.signInEmail(id, pw));
  };

  return (
    <main className="login-wrap">
      <div className="card login">
        <div className="login-brand">
          <span className="logo"><Icon name="logo" size={28} /></span>
          <h1>امتحان المذاكرة</h1>
        </div>
        <h2>{reset ? 'نسيت كلمة السر' : 'تسجيل الدخول'}</h2>

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="lg-id">اسم المستخدم</label>
            <input id="lg-id" type="text" autoComplete="username" dir="ltr" autoCapitalize="none" spellCheck="false" value={id} onChange={e => setId(e.target.value)} placeholder="اسم المستخدم أو الإيميل" />
          </div>
          {!reset && (
            <div className="field">
              <label htmlFor="lg-pw">كلمة السر</label>
              <input id="lg-pw" type="password" autoComplete="current-password" dir="ltr" value={pw} onChange={e => setPw(e.target.value)} />
            </div>
          )}
          {err && <p className="err-text" role="alert">{err}</p>}
          {info && <p className="ok-text" role="status">{info}</p>}
          <button className="btn primary lg block" type="submit" disabled={busy}>
            {busy ? 'استنى...' : reset ? 'ابعت رابط الاستعادة' : 'دخول'}
          </button>
        </form>

        {!reset && (
          <>
            <div className="or"><span>أو</span></div>
            <button className="btn block google" type="button" disabled={busy} onClick={() => run(() => cloud.signInGoogle())}>
              <span className="g" aria-hidden="true">G</span> دخول المالك بحساب Google
            </button>
          </>
        )}

        <div className="login-links">
          <button className="link" onClick={() => { setReset(r => !r); setErr(''); setInfo(''); }}>{reset ? 'رجوع لتسجيل الدخول' : 'نسيت كلمة السر'}</button>
        </div>
        <p className="muted small" style={{ marginTop: 14 }}>الحسابات بينشئها المالك. لو مفيش عندك حساب كلّم المالك.</p>
      </div>
    </main>
  );
}

/* نموذج تغيير كلمة السر (في الملف الشخصي وفي شاشة «لازم تغيّر كلمة السر» أول دخول) */
export function ChangePasswordForm({ onDone, submitLabel = 'تغيير كلمة السر' }) {
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [nw2, setNw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setErr(''); setOk(false);
    if (!cur) return setErr('اكتب كلمة السر الحالية.');
    if (nw.length < 6) return setErr('كلمة السر الجديدة لازم 6 حروف أو أرقام على الأقل.');
    if (nw !== nw2) return setErr('كلمة السر الجديدة والتأكيد مش زي بعض.');
    if (nw === cur) return setErr('كلمة السر الجديدة لازم تختلف عن الحالية.');
    setBusy(true);
    try {
      await cloud.changePassword(cur, nw);
      setCur(''); setNw(''); setNw2(''); setOk(true);
      if (onDone) await onDone();
    } catch (ex) {
      const c = ex && ex.code;
      setErr(c === 'auth/invalid-credential' || c === 'auth/wrong-password' ? 'كلمة السر الحالية غلط.' : cloud.friendlyError(ex));
    }
    setBusy(false);
  };

  return (
    <form className="pw-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="pw-cur">كلمة السر الحالية</label>
        <input id="pw-cur" type="password" autoComplete="current-password" dir="ltr" value={cur} onChange={e => setCur(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="pw-new">كلمة السر الجديدة</label>
        <input id="pw-new" type="password" autoComplete="new-password" dir="ltr" value={nw} onChange={e => setNw(e.target.value)} placeholder="6 حروف أو أرقام على الأقل" />
      </div>
      <div className="field">
        <label htmlFor="pw-new2">تأكيد كلمة السر الجديدة</label>
        <input id="pw-new2" type="password" autoComplete="new-password" dir="ltr" value={nw2} onChange={e => setNw2(e.target.value)} />
      </div>
      {err && <p className="err-text" role="alert">{err}</p>}
      {ok && <p className="ok-text" role="status">اتغيّرت كلمة السر.</p>}
      <button className="btn primary" type="submit" disabled={busy}>{busy ? 'استنى...' : submitLabel}</button>
    </form>
  );
}

/* شاشات الحالات: حساب مش مفعّل / موقوف / لازم تغيّر كلمة السر */
export function NoAccountScreen({ user, onClaim, onLogout }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const claim = async () => {
    setBusy(true); setErr('');
    try { await onClaim(); } catch (e) {
      setErr(e && e.code === 'permission-denied'
        ? 'الحساب ده مش حساب المالك. لو انت المالك، تأكد إن الـ UID اللي تحت هو نفسه الموجود في قواعد Firestore (OWNER_UID).'
        : cloud.friendlyError(e));
    }
    setBusy(false);
  };
  return (
    <main className="login-wrap">
      <div className="card login">
        <h2>حسابك مش مفعّل</h2>
        <p>الحساب ده لسه ما اتعملش أو اتحذف. الحسابات بينشئها المالك، اطلب منه ينشئلك حساب.</p>
        <p className="muted small">لو انت المالك وده أول دخول، انسخ الـ UID ده وحطه في قواعد Firestore مكان <code>OWNER_UID</code>، وبعدها اضغط الزرار.</p>
        <div className="uid-box" dir="ltr">{user.uid}</div>
        {err && <p className="err-text" role="alert">{err}</p>}
        <button className="btn primary block" onClick={claim} disabled={busy}>{busy ? 'استنى...' : 'أنا المالك، فعّل حسابي'}</button>
        <div className="login-links"><button className="link" onClick={onLogout}>تسجيل الخروج</button></div>
      </div>
    </main>
  );
}
export function BlockedScreen({ onLogout }) {
  return (
    <main className="login-wrap">
      <div className="card login">
        <h2>الحساب موقوف</h2>
        <p>حسابك اتوقف من المالك. كلّمه لو عاوز تفعّله تاني.</p>
        <div className="login-links"><button className="link" onClick={onLogout}>تسجيل الخروج</button></div>
      </div>
    </main>
  );
}
export function MustChangeScreen({ onDone, onLogout }) {
  return (
    <main className="login-wrap">
      <div className="card login">
        <h2>غيّر كلمة السر</h2>
        <p className="muted">ده أول دخول ليك. اختار كلمة سر جديدة خاصة بيك قبل ما تكمّل.</p>
        <ChangePasswordForm onDone={onDone} submitLabel="حفظ وإكمال" />
        <div className="login-links"><button className="link" onClick={onLogout}>تسجيل الخروج</button></div>
      </div>
    </main>
  );
}
