import React, { useContext, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, Modal, useToast, cx, AuthCtx } from './ui.jsx';
import { loadProfile, saveProfile } from './store.js';
import * as cloud from './cloud.js';
import { ChangePasswordForm } from './auth.jsx';

/* الصورة الدايرية: الصورة لو موجودة، وإلا أول حرف من الاسم، وإلا أيقونة شخص */
export function Avatar({ name, photo, size = 36 }) {
  const ch = (name || '').trim().charAt(0);
  return (
    <span className={cx('avatar', photo && 'has-img')} style={{ width: size, height: size, fontSize: size * 0.45 }} aria-hidden="true">
      {photo ? <img src={photo} alt="" /> : ch ? ch : <Icon name="user" size={size * 0.55} />}
    </span>
  );
}

/* بنصغّر الصورة ونقصّها مربعة (٢٥٦×٢٥٦) عشان تتحفظ بحجم صغير */
function toSquareDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(c.toDataURL('image/jpeg', 0.85));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}

/* زرار الهيدر: الصورة + الاسم، والضغط عليه بيفتح التعديل */
export function ProfileButton() {
  const [prof, setProf] = useState(() => loadProfile());
  const [open, setOpen] = useState(false);
  const empty = !prof.name && !prof.photo;
  return (
    <>
      <button className="profile-btn" onClick={() => setOpen(true)} aria-label={empty ? 'أضف اسمك وصورتك' : 'تعديل الملف الشخصي: ' + prof.name}>
        <Avatar name={prof.name} photo={prof.photo} size={56} />
        <span className="pn">{prof.name || 'أضف اسمك'}</span>
      </button>
      {open && createPortal(<ProfileModal initial={prof} onClose={() => setOpen(false)} onSaved={p => { setProf(p); setOpen(false); }} />, document.body)}
    </>
  );
}

function ProfileModal({ initial, onClose, onSaved }) {
  const notify = useToast();
  const { user, account, logout } = useContext(AuthCtx);
  const [name, setName] = useState(initial.name);
  const [photo, setPhoto] = useState(initial.photo);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const pick = async e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { notify('اختار ملف صورة (jpg أو png).', 'err'); return; }
    setBusy(true);
    try { setPhoto(await toSquareDataUrl(f)); } catch { notify('مقدرتش أقرأ الصورة دي، جرّب صورة تانية.', 'err'); }
    setBusy(false);
  };
  const save = () => {
    const p = { name: name.trim(), photo };
    if (saveProfile(p)) notify('اتحفظ الملف الشخصي');
    else notify('اتغيّر الاسم والصورة، بس المتصفح مش سامح بحفظهم فهيختفوا لما تقفل الصفحة.', 'err');
    onSaved(p);
  };

  return (
    <Modal title="الملف الشخصي" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>إلغاء</button>
        <button className="btn primary" onClick={save} disabled={busy}><Icon name="check" size={16} /> حفظ</button>
      </>}>
      <div className="profile-edit">
        <Avatar name={name} photo={photo} size={96} />
        <div className="pe-actions">
          <label className="btn ghost sm filebtn"><Icon name="upload" size={16} /> {photo ? 'تغيير الصورة' : 'اختيار صورة'}
            <input ref={fileRef} type="file" accept="image/*" onChange={pick} />
          </label>
          {photo && <button className="btn ghost sm" onClick={() => setPhoto('')}><Icon name="trash" size={16} /> حذف الصورة</button>}
        </div>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="pname">الاسم</label>
        <input id="pname" type="text" maxLength={40} value={name} placeholder="اكتب اسمك" data-autofocus
          onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
        <span className="muted small">الاسم والصورة بيتحفظوا في حسابك.</span>
      </div>
      {user && (
        <div className="acct">
          <span className="muted small" dir="ltr">{(account && account.identifier) || user.email}</span>
          <button className="btn ghost sm" onClick={logout}>تسجيل الخروج</button>
        </div>
      )}
      {cloud.hasPassword() && (
        <div className="pw-section">
          <h3>تغيير كلمة السر</h3>
          <ChangePasswordForm />
        </div>
      )}
    </Modal>
  );
}
