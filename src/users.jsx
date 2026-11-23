import React, { useEffect, useMemo, useState } from 'react';
import * as cloud from './cloud.js';
import { Icon, Modal, Breadcrumb, useToast, cx } from './ui.jsx';
import { SUBJECTS } from './store.js';
import { TAB_DEFS, allPerms, validId, normId, genPassword, permsSummary, isRealEmail } from './accounts.js';

/* اختيار الصلاحيات: المواد المسموحة + الصفحات (التبويبات) المسموحة */
function PermsEditor({ value, onChange }) {
  /* بنستخدم الصيغة الدالّية عشان أي ضغطتين ورا بعض ما يضيّعوش بعض */
  const toggle = (key, k) => onChange(v => {
    const cur = new Set(v[key]);
    cur.has(k) ? cur.delete(k) : cur.add(k);
    return { ...v, [key]: [...cur] };
  });
  const all = (key, list) => onChange(v => ({ ...v, [key]: v[key].length === list.length ? [] : list }));
  const subs = SUBJECTS.map(s => s.key);
  const tabs = TAB_DEFS.map(t => t.k);
  return (
    <div className="perms">
      <fieldset>
        <legend>المواد المسموحة <button type="button" className="link small" onClick={() => all('subjects', subs)}>{value.subjects.length === subs.length ? 'إلغاء الكل' : 'تحديد الكل'}</button></legend>
        <div className="checks">
          {SUBJECTS.map(s => (
            <label key={s.key} className="check"><input type="checkbox" checked={value.subjects.includes(s.key)} onChange={() => toggle('subjects', s.key)} /> {s.label}</label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>الصفحات المسموحة جوه المادة <button type="button" className="link small" onClick={() => all('tabs', tabs)}>{value.tabs.length === tabs.length ? 'إلغاء الكل' : 'تحديد الكل'}</button></legend>
        <div className="checks">
          {TAB_DEFS.map(t => (
            <label key={t.k} className="check"><input type="checkbox" checked={value.tabs.includes(t.k)} onChange={() => toggle('tabs', t.k)} /> {t.t}</label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function NewUserModal({ onClose, onCreated }) {
  const notify = useToast();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [pw, setPw] = useState(() => genPassword());
  const [show, setShow] = useState(true);
  const [must, setMust] = useState(true);
  const [perms, setPerms] = useState(allPerms());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(null);

  const submit = async () => {
    setErr('');
    if (!validId(id)) return setErr('اسم المستخدم لازم إنجليزي (3 لـ 20 حرف أو رقم، ومسموح . _ -) أو إيميل صحيح.');
    if (pw.length < 6) return setErr('كلمة السر لازم 6 حروف أو أرقام على الأقل.');
    setBusy(true);
    try {
      const acc = await cloud.createAccount({ identifier: id, name, password: pw, perms, mustChange: must });
      setDone({ id: normId(id), pw });
      onCreated(acc);
    } catch (e) { setErr(cloud.friendlyError(e)); }
    setBusy(false);
  };

  if (done) {
    const text = `اسم المستخدم: ${done.id}\nكلمة السر: ${done.pw}`;
    return (
      <Modal title="اتعمل المستخدم" onClose={onClose} footer={<button className="btn primary" onClick={onClose} data-autofocus>تمام</button>}>
        <p>اكتب البيانات دي وادّيهاله، كلمة السر <b>مش هتظهر تاني</b>:</p>
        <pre className="cred" dir="ltr">{text}</pre>
        <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(text).then(() => notify('اتنسخت'), () => notify('مقدرتش أنسخ، انسخها بإيدك.', 'err')); }}><Icon name="copy" size={16} /> نسخ</button>
        {must && <p className="muted small" style={{ marginTop: 10 }}>هيطلب منه يغيّر كلمة السر أول ما يدخل.</p>}
      </Modal>
    );
  }
  return (
    <Modal title="مستخدم جديد" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>إلغاء</button>
        <button className="btn primary" onClick={submit} disabled={busy}>{busy ? 'استنى...' : 'إنشاء المستخدم'}</button>
      </>}>
      <div className="field">
        <label htmlFor="nu-id">اسم المستخدم</label>
        <input id="nu-id" type="text" dir="ltr" autoCapitalize="none" spellCheck="false" value={id} data-autofocus onChange={e => setId(e.target.value)} placeholder="مثلًا: sara أو sara@gmail.com" />
        <span className="muted small">إنجليزي بدون مسافات. لو كتبت إيميل حقيقي يقدر يستعيد كلمة السر بنفسه.</span>
      </div>
      <div className="field">
        <label htmlFor="nu-name">الاسم اللي هيظهر (اختياري)</label>
        <input id="nu-name" type="text" maxLength={40} value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="nu-pw">كلمة السر</label>
        <div className="row-inline">
          <input id="nu-pw" type={show ? 'text' : 'password'} dir="ltr" value={pw} onChange={e => setPw(e.target.value)} />
          <button type="button" className="btn ghost sm" onClick={() => setPw(genPassword())}>توليد</button>
          <button type="button" className="btn ghost sm" onClick={() => setShow(s => !s)}>{show ? 'إخفاء' : 'إظهار'}</button>
        </div>
      </div>
      <label className="check"><input type="checkbox" checked={must} onChange={e => setMust(e.target.checked)} /> يغيّر كلمة السر أول ما يدخل</label>
      <PermsEditor value={perms} onChange={setPerms} />
      {err && <p className="err-text" role="alert">{err}</p>}
    </Modal>
  );
}

function EditUserModal({ acc, onClose, onSaved }) {
  const [name, setName] = useState(acc.name || '');
  const [perms, setPerms] = useState({ subjects: (acc.perms && acc.perms.subjects) || [], tabs: (acc.perms && acc.perms.tabs) || [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await cloud.updateAccount(acc.uid, { name: name.trim(), perms }); onSaved({ ...acc, name: name.trim(), perms }); } catch (e) { setErr(cloud.friendlyError(e)); }
    setBusy(false);
  };
  return (
    <Modal title={'تعديل ' + (acc.name || acc.identifier)} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>إلغاء</button>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'استنى...' : 'حفظ'}</button>
      </>}>
      <p className="muted small" dir="ltr">{acc.identifier}{isRealEmail(acc.identifier) ? '' : ' (اسم مستخدم)'}</p>
      <div className="field">
        <label htmlFor="eu-name">الاسم</label>
        <input id="eu-name" type="text" maxLength={40} value={name} onChange={e => setName(e.target.value)} />
      </div>
      <PermsEditor value={perms} onChange={setPerms} />
      {err && <p className="err-text" role="alert">{err}</p>}
    </Modal>
  );
}

/* صفحة المستخدمين (للمالك بس) */
export function UsersPage() {
  const notify = useToast();
  const [list, setList] = useState(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setErr('');
    try { setList(await cloud.listAccounts()); } catch (e) { setErr(cloud.friendlyError(e)); setList([]); }
  };
  useEffect(() => { load(); }, []);

  const sorted = useMemo(() => (list || []).slice().sort((a, b) => (a.role === 'owner' ? -1 : 0) - (b.role === 'owner' ? -1 : 0) || (a.createdAt || 0) - (b.createdAt || 0)), [list]);
  const patch = acc => setList(l => l.map(x => (x.uid === acc.uid ? acc : x)));
  const toggle = async acc => {
    try { await cloud.updateAccount(acc.uid, { active: !acc.active }); patch({ ...acc, active: !acc.active }); notify(acc.active ? 'اتوقف الحساب' : 'اتفعّل الحساب'); } catch (e) { notify(cloud.friendlyError(e), 'err'); }
  };

  return (
    <main className="container users-page">
      <Breadcrumb items={[{ label: 'المواد', href: '#/' }, { label: 'المستخدمون' }]} />
      <div className="card-head">
        <h1 className="h1s"><Icon name="user" size={24} className="ic" /> المستخدمون</h1>
        <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> مستخدم جديد</button>
      </div>
      {err && <p className="err-text" role="alert">{err}</p>}
      {list === null && <p className="muted">جاري التحميل...</p>}
      <div className="exams-list">
        {sorted.map(a => (
          <article key={a.uid} className={cx('card exam-item', a.active === false && 'off')}>
            <div className="ei-main">
              <h3>{a.name || a.identifier} {a.role === 'owner' && <span className="count">المالك</span>} {a.active === false && <span className="count off-badge">موقوف</span>}</h3>
              <div className="muted small" dir="ltr" style={{ textAlign: 'right' }}>{a.identifier}</div>
              <div className="muted small">{permsSummary(a)}</div>
            </div>
            {a.role !== 'owner' && (
              <div className="ei-actions">
                <button className="btn" onClick={() => setEditing(a)}><Icon name="edit" size={16} /> الصلاحيات</button>
                <button className={cx('btn', a.active !== false && 'danger-ghost')} onClick={() => toggle(a)}>{a.active === false ? 'تفعيل' : 'إيقاف'}</button>
              </div>
            )}
          </article>
        ))}
        {list && list.length === 0 && !err && <p className="muted">لسه مفيش مستخدمين.</p>}
      </div>
      {adding && <NewUserModal onClose={() => setAdding(false)} onCreated={acc => setList(l => [...(l || []), acc])} />}
      {editing && <EditUserModal acc={editing} onClose={() => setEditing(null)} onSaved={acc => { patch(acc); setEditing(null); notify('اتحفظت الصلاحيات'); }} />}
    </main>
  );
}
