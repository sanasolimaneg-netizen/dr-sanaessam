/* الربط بـ Firebase: تسجيل الدخول (Google وإيميل/باسورد) + تخزين بيانات كل مستخدم في Firestore.
   كل بيانات المستخدم تحت المسار  users/{uid}/...  وقواعد الحماية بتسمح لصاحب الحساب بس. */
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, EmailAuthProvider, reauthenticateWithCredential, updatePassword,
} from 'firebase/auth';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
} from 'firebase/firestore';
import { firebaseConfig, OWNER_UID } from './firebase-config.js';
import { createSync } from './sync.js';
import { attachBackend, detachBackend } from './store.js';
import { toEmail, normId } from './accounts.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
/* نسخة تانية من التطبيق بنستخدمها بس لإنشاء حسابات المستخدمين من غير ما المالك يتسجّل خروج */
const secAuth = getAuth(initializeApp(firebaseConfig, 'secondary'));
auth.languageCode = 'ar';
let db;
try {
  /* كاش على الجهاز عشان الموقع يفضل شغال لو النت قطع لحظات */
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch { db = getFirestore(app); }

const pad = k => String(k).padStart(4, '0');
const adapter = {
  async listEntities(uid, col) {
    const snap = await getDocs(collection(db, 'users', uid, col));
    return Promise.all(snap.docs.map(async d => {
      const meta = d.data();
      const { chunks, ...rest } = meta;
      const n = chunks || 0;
      let qs = [];
      if (n) {
        const cs = await getDocs(collection(db, 'users', uid, col, d.id, 'chunks'));
        qs = cs.docs.sort((a, b) => (a.id < b.id ? -1 : 1)).flatMap(c => c.data().qs || []);
      }
      return { e: { ...rest, id: d.id, qs }, n };
    }));
  },
  async writeEntity(uid, col, id, meta, chunks, oldN) {
    const b = writeBatch(db);
    b.set(doc(db, 'users', uid, col, id), meta);
    chunks.forEach((qs, k) => b.set(doc(db, 'users', uid, col, id, 'chunks', pad(k)), { qs }));
    for (let k = chunks.length; k < oldN; k++) b.delete(doc(db, 'users', uid, col, id, 'chunks', pad(k)));
    await b.commit();
  },
  async deleteEntity(uid, col, id, n) {
    const b = writeBatch(db);
    for (let k = 0; k < n; k++) b.delete(doc(db, 'users', uid, col, id, 'chunks', pad(k)));
    b.delete(doc(db, 'users', uid, col, id));
    await b.commit();
  },
  async getProfile(uid) {
    const s = await getDoc(doc(db, 'users', uid, 'meta', 'profile'));
    return s.exists() ? s.data() : null;
  },
  async setProfile(uid, p) { await setDoc(doc(db, 'users', uid, 'meta', 'profile'), p); },
  /* نتايج الامتحانات: مستند لكل امتحان تحت users/{uid}/results، وخاصة بصاحبها */
  async listResults(uid) {
    const snap = await getDocs(collection(db, 'users', uid, 'results'));
    return snap.docs.map(d => ({ id: d.id, data: d.data() }));
  },
  async setResult(uid, id, r) { await setDoc(doc(db, 'users', uid, 'results', id), JSON.parse(JSON.stringify(r))); },
};

let current = null;
let errHandler = () => {};
export const onSyncError = fn => { errHandler = fn; };

window.addEventListener('beforeunload', e => {
  if (current && current.pending()) { e.preventDefault(); e.returnValue = ''; }
});

export const watchAuth = cb => onAuthStateChanged(auth, cb);

/* بعد تسجيل الدخول: بنحمّل بيانات المستخدم من Firestore ونربطها بالتطبيق */
export async function attach(user, account) {
  /* الدروس والامتحانات بتتقرا من المالك (مشتركة)، والنتايج والملف الشخصي من حساب المستخدم نفسه */
  const sync = createSync(adapter, user.uid, { sharedUid: OWNER_UID, onError: e => errHandler(e) });
  await sync.load();
  const nm = (account && account.name) || user.displayName;
  if (!sync.getProfile().name && nm) sync.setProfile({ name: nm, photo: sync.getProfile().photo });
  current = sync;
  attachBackend(sync);
}
export function detach() { current = null; detachBackend(); }
export async function logout() {
  try { if (current) await current.flush(); } catch { /* هنكمّل الخروج */ }
  detach();
  try { sessionStorage.clear(); } catch { /* مش مشكلة */ }
  await signOut(auth);
}

export const signInEmail = (idOrEmail, pw) => signInWithEmailAndPassword(auth, toEmail(idOrEmail), pw);
export const signInGoogle = () => signInWithPopup(auth, new GoogleAuthProvider());
export const resetPassword = email => sendPasswordResetEmail(auth, normId(email));
export const hasPassword = () => !!(auth.currentUser && auth.currentUser.providerData.some(p => p.providerId === 'password'));

/* ---------- الحسابات والصلاحيات (accounts/{uid}) ---------- */
export async function getAccount(uid) {
  const s = await getDoc(doc(db, 'accounts', uid));
  return s.exists() ? s.data() : null;
}
/* حساب المالك بيفعّل نفسه: القواعد بتسمح بده لـ UID المالك بس */
export async function claimOwner(user) {
  const a = { role: 'owner', active: true, name: user.displayName || '', identifier: normId(user.email), perms: null, mustChange: false, createdAt: Date.now() };
  await setDoc(doc(db, 'accounts', user.uid), a);
  return a;
}
export async function listAccounts() {
  const s = await getDocs(collection(db, 'accounts'));
  return s.docs.map(d => ({ uid: d.id, ...d.data() }));
}
export async function createAccount({ identifier, name, password, perms, mustChange }) {
  const id = normId(identifier);
  const email = toEmail(id);
  let uid;
  try {
    uid = (await createUserWithEmailAndPassword(secAuth, email, password)).user.uid;
  } catch (e) {
    if (e && e.code === 'auth/email-already-in-use') {
      /* ممكن يكون اتعمل قبل كده ومحفظناش صلاحياته: لو كلمة السر نفسها هنكمّل عليه */
      try { uid = (await signInWithEmailAndPassword(secAuth, email, password)).user.uid; } catch { throw e; }
      if (await getAccount(uid)) throw e;
    } else throw e;
  }
  try { await signOut(secAuth); } catch { /* مش مهم */ }
  const acc = { role: 'user', active: true, identifier: id, name: (name || '').trim(), perms, mustChange: !!mustChange, createdAt: Date.now(), createdBy: auth.currentUser.uid };
  await setDoc(doc(db, 'accounts', uid), acc);
  return { uid, ...acc };
}
/* للمالك: نتايج مستخدم معيّن وامتحاناته الخاصة (القواعد بتسمح للمالك بالقراءة) */
export async function getUserView(uid) {
  const [rs, ex] = await Promise.all([adapter.listResults(uid), adapter.listEntities(uid, 'exams')]);
  return { results: Object.fromEntries(rs.map(r => [r.id, r.data])), exams: ex.map(x => x.e) };
}
export const updateAccount = (uid, patch) => updateDoc(doc(db, 'accounts', uid), patch);

/* حذف مستخدم (للمالك): بيمسح بياناته ونتايجه وحسابه من التطبيق. سجل الدخول نفسه (Authentication) بيتمسح يدويًا من Firebase Console
   لأن المتصفح مايقدرش يحذف مستخدم تاني. من غير مستند الحساب مايقدرش يقرا ولا يكتب أي حاجة. */
export async function deleteAccount(uid) {
  if (uid === OWNER_UID || uid === auth.currentUser.uid) throw { code: 'app/cannot-delete-owner' };
  const refs = [];
  for (const col of ['results', 'meta']) (await getDocs(collection(db, 'users', uid, col))).docs.forEach(d => refs.push(d.ref));
  for (const col of ['sets', 'exams']) {
    for (const d of (await getDocs(collection(db, 'users', uid, col))).docs) {
      (await getDocs(collection(db, 'users', uid, col, d.id, 'chunks'))).docs.forEach(c => refs.push(c.ref));
      refs.push(d.ref);
    }
  }
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach(r => b.delete(r));
    await b.commit();
  }
  await deleteDoc(doc(db, 'accounts', uid));
}
export const clearMustChange = uid => updateDoc(doc(db, 'accounts', uid), { mustChange: false });

/* تغيير كلمة السر: لازم كلمة السر الحالية (إعادة تحقق) */
export async function changePassword(current, next) {
  const u = auth.currentUser;
  if (!u || !u.email) throw { code: 'auth/no-user' };
  if (!hasPassword()) throw { code: 'app/no-password' };
  await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current));
  await updatePassword(u, next);
}

const MSG = {
  'auth/invalid-credential': 'الإيميل أو كلمة السر غلط.',
  'auth/wrong-password': 'كلمة السر غلط.',
  'auth/user-not-found': 'مفيش حساب بالإيميل ده.',
  'auth/invalid-email': 'الإيميل مكتوب غلط.',
  'auth/email-already-in-use': 'اسم المستخدم أو الإيميل ده موجود قبل كده.',
  'auth/weak-password': 'كلمة السر ضعيفة، لازم 6 حروف أو أرقام على الأقل.',
  'auth/missing-password': 'اكتب كلمة السر.',
  'auth/too-many-requests': 'محاولات كتير، استنى شوية وجرّب تاني.',
  'auth/network-request-failed': 'مفيش اتصال بالنت.',
  'auth/popup-closed-by-user': 'قفلت نافذة جوجل قبل ما تكمّل.',
  'auth/cancelled-popup-request': 'قفلت نافذة جوجل قبل ما تكمّل.',
  'auth/user-disabled': 'الحساب ده موقوف.',
  'app/no-password': 'حسابك مسجّل بجوجل ومالوش كلمة سر.',
  'app/user-exists': 'اسم المستخدم ده موجود قبل كده.',
  'app/cannot-delete-owner': 'مينفعش تحذف حساب المالك.',
  'auth/requires-recent-login': 'سجّل خروج وادخل تاني وجرّب.',
  'auth/popup-blocked': 'المتصفح منع نافذة جوجل، اسمح بالنوافذ المنبثقة وجرّب تاني.',
  'auth/unauthorized-domain': 'دومين الموقع مش مضاف في Firebase (Authentication ← Settings ← Authorized domains).',
  'auth/operation-not-allowed': 'طريقة الدخول دي مش مفعّلة في Firebase (Authentication ← Sign-in method).',
  'permission-denied': 'مفيش صلاحية للقراءة/الكتابة: تأكد من تفعيل Firestore ولصق قواعد الحماية (firestore.rules).',
  unavailable: 'مفيش اتصال بقاعدة البيانات، تأكد من النت.',
};
export const friendlyError = e => {
  const c = (e && e.code) || '';
  return MSG[c] || MSG[c.replace('firestore/', '')] || 'حصلت مشكلة، جرّب تاني. ' + (c ? `(${c})` : '');
};
