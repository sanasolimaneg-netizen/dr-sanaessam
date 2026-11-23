/* منطق الحسابات والصلاحيات (من غير Firebase عشان يتختبر لوحده) */
import { SUBJECTS } from './store.js';

/* صفحات المادة (التبويبات) اللي المالك بيتحكم فيها */
/* المالك بيحدد لكل مستخدم الصفحات المسموحة. اللي المستخدم يضيفه وينشئه بيبقى خاص بيه بس، ومحتوى المالك بيظهرله هو والباقي */
export const TAB_DEFS = [
  { k: 'add', t: 'إضافة ملف' },
  { k: 'library', t: 'الدروس' },
  { k: 'exam', t: 'إنشاء امتحان' },
  { k: 'exams', t: 'الامتحانات' },
];
export const USER_DOMAIN = 'users.dr-sana.app';

export const allPerms = () => ({ subjects: SUBJECTS.map(s => s.key), tabs: TAB_DEFS.map(t => t.k) });
export const normId = v => String(v || '').trim().toLowerCase();
/* اسم مستخدم إنجليزي (3-20 حرف/رقم/نقطة/شرطة) أو إيميل حقيقي */
export const validId = v => {
  const x = normId(v);
  return x.includes('@') ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x) : /^[a-z0-9][a-z0-9._-]{2,19}$/.test(x);
};
/* اسم المستخدم بيتحوّل لإيميل داخلي عشان Firebase، والإيميل الحقيقي بيتستخدم زي ما هو */
export const toEmail = v => { const x = normId(v); return x.includes('@') ? x : `${x}@${USER_DOMAIN}`; };
export const isRealEmail = v => normId(v).includes('@');

export function genPassword(len = 8) {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint32Array(len);
  (globalThis.crypto || { getRandomValues: x => x.fill(Math.floor(Math.random() * 4e9)) }).getRandomValues(a);
  return Array.from(a, n => chars[n % chars.length]).join('');
}

/* account: {role:'owner'|'user', active, perms:{subjects,tabs}} — المالك ليه كل حاجة */
export function makeCan(account, isOwnerUid = false) {
  const owner = isOwnerUid || (!!account && account.role === 'owner');
  const subj = new Set(owner ? [...SUBJECTS.map(s => s.key), 'none'] : (account && account.perms && account.perms.subjects) || []);
  /* «نتائجي» متاحة لكل مستخدم لأنها نتايجه هو بس */
  const tabs = new Set([...(owner ? TAB_DEFS.map(t => t.k) : (account && account.perms && account.perms.tabs) || []), 'results']);
  return { owner, subject: k => subj.has(k), tab: k => tabs.has(k) };
}

export function permsSummary(acc) {
  if (acc.role === 'owner') return 'كل الصلاحيات';
  const p = acc.perms || {};
  const subs = SUBJECTS.filter(s => (p.subjects || []).includes(s.key)).map(s => s.label);
  const tabs = TAB_DEFS.filter(t => (p.tabs || []).includes(t.k)).map(t => t.t);
  return `المواد: ${subs.length === SUBJECTS.length ? 'كلها' : subs.join('، ') || 'ولا واحدة'} · الصفحات: ${tabs.length === TAB_DEFS.length ? 'كلها' : tabs.join('، ') || 'ولا واحدة'}`;
}
