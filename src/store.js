/* المواد، التخزين (السحابة عبر cloud.js)، ومنطق دمج الملفات وتكوين الامتحان */
import { useState } from 'react';
import { hasPages, pageGroups, inLesson } from './pagelogic.js';

export { hasPages, pageGroups };

export const SUBJECTS = [
  { key: 'arabic', label: 'اللغة العربية', icon: 'ar', accent: '#d97706' },
  { key: 'english', label: 'اللغة الإنجليزية', icon: 'en', accent: '#2563eb' },
  { key: 'biology', label: 'الأحياء', icon: 'leaf', accent: '#16a34a' },
  { key: 'chemistry', label: 'الكيمياء', icon: 'flask', accent: '#9333ea' },
  { key: 'physics', label: 'الفيزياء', icon: 'atom', accent: '#e11d48' },
];
export const NOSUBJ = { key: 'none', label: 'ملفات قديمة بدون مادة', icon: 'file', accent: '#64748b' };
export const subjectMeta = k => SUBJECTS.find(s => s.key === k) || (k === 'none' ? NOSUBJ : null);

/* ---------- التخزين ---------- */
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* مصدر البيانات: بعد تسجيل الدخول بنربط نسخة السحابة (cloud.js → sync.js) هنا. الواجهة بتفضل متزامنة وسريعة. */
let backend = null;
const EMPTY = { getLib: () => '[]', setLib() {}, getExams: () => '[]', setExams() {}, getSharedLib: () => '[]', getSharedExams: () => '[]', getProfile: () => ({ name: '', photo: '' }), setProfile() {}, getPrompt: () => '', setPrompt() {}, getResults: () => ({}), setResult() {} };
export const attachBackend = b => { backend = b; };
export const detachBackend = () => { backend = null; };
const bk = () => backend || EMPTY;

/* محتوى المالك (المشترك) بيتدمج مع محتوى المستخدم الخاص وقت العرض بس، وعناصره متعلّم عليها _sh ومابتتخزنش في حساب المستخدم */
export function saveLib(l) {
  try {
    const out = [];
    l.forEach(s => {
      if (s._sh) return;
      if (!s.bank) { out.push(s); return; }
      const qs = s.qs.filter(q => !q._sh);
      const lessons = (s.lessons || []).filter(x => !x._sh);
      const { shOnly, _shSrc, ...rest } = s;
      const hasSrc = (rest.sources || []).length > 0;
      if (shOnly && !qs.length && !lessons.length && !hasSrc) return;
      out.push({ ...rest, qs, lessons });
    });
    bk().setLib(JSON.stringify(out));
    return true;
  } catch { return false; }
}
function withShared(own) {
  let sh = [];
  try { sh = JSON.parse(bk().getSharedLib() || '[]'); } catch { sh = []; }
  if (!sh.length) return own;
  const out = own.slice();
  sh.forEach(s => {
    if (!s.bank) { out.push({ ...s, _sh: 1 }); return; }
    const k = subjOf(s);
    const sq = (s.qs || []).map(q => ({ ...q, _sh: 1 }));
    const sl = (s.lessons || []).map(x => ({ ...x, _sh: 1 }));
    const i = out.findIndex(x => x.bank && subjOf(x) === k);
    /* مصادر المالك وتعيينها للصفحات بتتعرض مع مصادر المستخدم، ومابتتخزنش في حسابه (_shSrc / _shPageSrc) */
    const shSrc = { _shSrc: s.sources || [] };
    if (i < 0) out.push({ ...s, qs: sq, lessons: sl, shOnly: true, sources: [], ...shSrc });
    else out[i] = { ...out[i], qs: sortQs([...sq, ...out[i].qs]), lessons: [...sl, ...(out[i].lessons || [])], ...shSrc };
  });
  return out;
}
export function loadLib() {
  try {
    let l = JSON.parse(bk().getLib() || '[]');
    let changed = false;
    l.forEach(s => { if (!s.id) { s.id = uid(); changed = true; } });
    const m = migrate(l);
    if (m.changed) { l = m.lib; changed = true; }
    if (changed) saveLib(l);
    return withShared(l);
  } catch { return []; }
}
export const subjOf = s => (SUBJECTS.some(x => x.key === s.subject) ? s.subject : 'none');

/* ---------- بنك الصفحات ----------
   لكل مادة بنك واحد (bank:true) فيه كل الأسئلة اللي ليها رقم صفحة، مرتبة برقم الصفحة،
   والأسئلة الجديدة بتتضاف على نفس الصفحة، والسؤال المتطابق (في نفس الصفحة) مابيتكررش.
   الأسئلة اللي من غير رقم صفحة بتفضل في ملفات قديمة منفصلة. */
export const BANK_NAME = 'كل الصفحات';
export const getBank = (lib, subject) => lib.find(s => s.bank && subjOf(s) === subject);

/* ---------- المصادر ----------
   المصدر حقل في الدرس (lesson.source)، وbank.sources = قايمة أسماء المصادر اللي اتضافت (بتظهر في القايمة المنسدلة).
   مصدر الصفحة = مصدر أول درس بيشملها. */
export const NOSRC = '__none__';
export const sourcesOf = bank => [...new Set([
  ...((bank && bank.sources) || []), ...((bank && bank._shSrc) || []),
  ...(((bank && bank.lessons) || []).map(l => l.source).filter(Boolean)),
])];
export const srcOfPage = (bank, page) => {
  const l = ((bank && bank.lessons) || []).find(x => x.source && +page >= x.from && +page <= x.to);
  return l ? l.source : '';
};

/* مفتاح مقارنة السؤال: من غير تشكيل وهمزات ومسافات وعلامات */
export const qKey = q => String(q.q || '').toLowerCase()
  .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  .replace(/[^\p{L}\p{N}]+/gu, '');

/* ترتيب بالرقم (ثابت جوه الصفحة الواحدة) وترقيم الأسئلة جوه كل صفحة */
export function sortQs(qs) {
  const out = qs.map((q, i) => ({ q, i })).sort((a, b) => ((+a.q.page || 0) - (+b.q.page || 0)) || a.i - b.i).map(x => x.q);
  const cnt = {};
  return out.map(q => { cnt[q.page] = (cnt[q.page] || 0) + 1; return q.n === cnt[q.page] ? q : { ...q, n: cnt[q.page] }; });
}

/* بيدخّل الأسئلة اللي ليها صفحات على البنك (مع تخطي المتطابق)، واللي من غير صفحات بتتحفظ كملف قديم */
export function mergeInto(bank, qs) {
  const seen = new Set((bank ? bank.qs : []).map(q => q.page + '\u0001' + qKey(q)));
  const add = [];
  let dup = 0;
  qs.forEach(q => {
    const k = q.page + '\u0001' + qKey(q);
    if (qKey(q) && seen.has(k)) { dup++; return; }
    seen.add(k);
    add.push({ ...q, src: '' });
  });
  return { qs: sortQs([...(bank ? bank.qs : []), ...add]), added: add.length, dup };
}

export function addToLibrary(lib, subject, qs, lessons, fallbackName) {
  const paged = qs.filter(q => q.page);
  const loose = qs.filter(q => !q.page);
  let next = lib.slice();
  let added = 0;
  let dup = 0;
  let bank = getBank(lib, subject);
  if (paged.length || (lessons.length && bank)) {
    const m = mergeInto(bank, paged);
    added += m.added; dup += m.dup;
    if (bank) {
      bank = { ...bank, qs: m.qs, lessons: [...(bank.lessons || []), ...lessons] };
      next = next.map(s => (s.id === bank.id ? bank : s));
    } else {
      bank = { id: uid(), subject, bank: true, name: BANK_NAME, created: Date.now(), qs: m.qs, lessons };
      next.push(bank);
    }
  }
  let legacy = null;
  if (loose.length) {
    legacy = { id: uid(), subject, name: fallbackName, created: Date.now(), qs: loose, lessons: [] };
    next.push(legacy);
    added += loose.length;
  }
  return { lib: next, added, dup, bank, legacy };
}

/* ملفات اتحفظت قبل كده بصفحات: بتتدمج في بنك المادة، وتفضل الأسئلة من غير صفحة في ملف قديم */
function migrate(list) {
  if (!list.some(s => !s.bank && s.qs.some(q => q.page))) return { changed: false, lib: list };
  const banks = {};
  const out = [];
  list.forEach(s => { if (s.bank) { banks[subjOf(s)] = s; out.push(s); } });
  orderSets(list.filter(s => !s.bank)).forEach(s => {
    const paged = s.qs.filter(q => q.page);
    if (!paged.length) { out.push(s); return; }
    const k = subjOf(s);
    const m = mergeInto(banks[k], paged);
    const lessons = [...((banks[k] && banks[k].lessons) || []), ...(s.lessons || [])];
    if (banks[k]) {
      const nb = { ...banks[k], qs: m.qs, lessons };
      out[out.indexOf(banks[k])] = nb; banks[k] = nb;
    } else {
      banks[k] = { id: uid(), subject: k, bank: true, name: BANK_NAME, created: s.created || Date.now(), qs: m.qs, lessons };
      out.push(banks[k]);
    }
    const loose = s.qs.filter(q => !q.page);
    if (loose.length) out.push({ ...s, qs: loose, lessons: [] });
  });
  return { changed: true, lib: out };
}

/* أرقام للعرض: عدد الصفحات والأسئلة والدروس والملفات القديمة */
export function libStats(sets) {
  const bank = sets.find(s => s.bank);
  const pages = bank ? new Set(bank.qs.map(q => q.page)).size : 0;
  return {
    pages, q: sets.reduce((a, s) => a + s.qs.length, 0),
    legacy: sets.filter(s => !s.bank).length, lessons: bank ? (bank.lessons || []).length : 0,
  };
}

/* حالة بتفضل طول ما التبويب مفتوح (اختيار الملفات وإعدادات الامتحان) */
export function useSession(key, init) {
  const [v, setV] = useState(() => {
    try { const r = sessionStorage.getItem(key); return r ? JSON.parse(r) : init; } catch { return init; }
  });
  const set = next => setV(prev => {
    const n = typeof next === 'function' ? next(prev) : next;
    try { sessionStorage.setItem(key, JSON.stringify(n)); } catch { /* مش مشكلة */ }
    return n;
  });
  return [v, set];
}

/* ---------- ترتيب ودمج الملفات ---------- */
/* الأقدم الأول (حسب وقت الحفظ). الملفات القديمة اللي من غير تاريخ تعتبر الأقدم وبتحافظ على ترتيبها */
export const orderSets = sets =>
  sets.map((s, i) => ({ s, i })).sort((a, b) => ((a.s.created || 0) - (b.s.created || 0)) || a.i - b.i).map(x => x.s);

/* اللي اتحدد للامتحان: ملف كامل، أو درس (نطاق صفحات) من ملف. لو الملف كله متحدد بنتجاهل دروسه */
export function selEntries(sets, ids) {
  const out = [];
  orderSets(sets).forEach(s => {
    if (ids.includes(s.id)) out.push({ id: s.id, name: s.name, set: s, lesson: null });
    else (s.lessons || []).forEach(l => { if (ids.includes(l.id)) out.push({ id: l.id, name: l.name, set: s, lesson: l }); });
  });
  return out;
}

export function combine(entries) {
  const out = [];
  const seen = new Set();
  entries.forEach(e => e.set.qs.forEach((q, i) => {
    if (e.lesson && !inLesson(q, e.lesson)) return;
    const k = e.set.id + ':' + i;
    if (seen.has(k)) return; // درسين متداخلين مايكررووش السؤال
    seen.add(k);
    out.push({ ...JSON.parse(JSON.stringify(q)), src: e.lesson ? e.name : (e.set.bank ? '' : (q.src || e.name)), source: e.set.bank ? srcOfPage(e.set, q.page) : '' });
  }));
  return out;
}

/* اسم تلقائي للملف من صفحاته (مفيش حقل اسم) */
export function autoName(qs, fallback) {
  const pg = qs.map(q => +q.page).filter(Boolean);
  if (!pg.length) return fallback;
  const a = Math.min(...pg);
  const b = Math.max(...pg);
  return a === b ? 'صفحة ' + a : `صفحات ${a}–${b}`;
}

/* ---------- تكوين الامتحان ---------- */
export const DEFAULT_OPTS = {
  mode: 'all', nMcq: '', nEssay: '', from: '', to: '', shuffle: false, shuffleOpts: false,
  /* لو الملفات فيها صفحات: نطاق الصفحات، والعدد من كل صفحة، وتعديل لصفحة بعينها، وصفحات مستبعدة */
  pFrom: '', pTo: '', perMcq: '', perEssay: '', over: {}, off: [],
  /* امتحان شامل: عدد الأسئلة من كل نوع بيتسحب عشوائي من الصفحات المحددة، وsrcs = تصفية بالمصدر (فاضية = كل المصادر) */
  comp: false, cMcq: '', cEssay: '', srcs: [],
};

export const typeCounts = qs => ({
  mcq: qs.filter(q => q.type === 'mcq').length,
  essay: qs.filter(q => q.type === 'essay').length,
});

/* الترقيم هنا هو ترقيم الأسئلة بعد دمج الملفات المحددة بالترتيب */
export function inRange(qs, from, to) {
  return qs.map((q, i) => ({ ...q, idx: i + 1 })).filter(q => (!from || q.idx >= from) && (!to || q.idx <= to));
}

/* المتاح فعلًا بعد تطبيق النطاق ونوع الأسئلة */
export function available(qs, o) {
  const c = typeCounts(inRange(qs, +o.from || 0, +o.to || 0));
  return { rangeMcq: c.mcq, rangeEssay: c.essay, mcq: o.mode === 'essay' ? 0 : c.mcq, essay: o.mode === 'mcq' ? 0 : c.essay };
}

/* ---------- الصفحات ---------- */
const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const cap = (want, max) => (+want > 0 ? Math.min(+want, max) : max);

/* صفحات النطاق المطلوب (ممكن نشمل المستبعدة عشان تفضل ظاهرة في الفهرس) */
export function pageScope(qs, o, withOff) {
  const from = +o.pFrom || 0;
  const to = +o.pTo || 0;
  const off = o.off || [];
  const sf = o.comp ? (o.srcs || []) : [];
  return pageGroups(qs).filter(g => {
    if (sf.length && !sf.includes(g.source || NOSRC)) return false;
    if (!withOff && off.includes(g.key)) return false;
    if (!g.page) return !from && !to;
    const p = +g.page;
    return (!from || p >= from) && (!to || p <= to);
  });
}

/* لكل صفحة: العدد اللي هيتسحب (تعديل الصفحة الأول، وبعدين العدد العام لكل صفحة) */
export function pageRows(qs, o, withOff) {
  const over = o.over || {};
  const off = o.off || [];
  const pick = (a, b) => (a !== undefined && a !== '' ? a : b);
  return pageScope(qs, o, withOff).map(g => {
    const ov = over[g.key] || {};
    const on = !off.includes(g.key);
    const maxM = o.mode === 'essay' ? 0 : g.mcq;
    const maxE = o.mode === 'mcq' ? 0 : g.essay;
    return {
      g, on, maxM, maxE,
      defM: cap(o.perMcq, maxM), defE: cap(o.perEssay, maxE),
      mcq: on ? cap(pick(ov.m, o.perMcq), maxM) : 0,
      essay: on ? cap(pick(ov.e, o.perEssay), maxE) : 0,
    };
  });
}

/* مجموعة الأسئلة اللي بيتسحب منها الامتحان الشامل (الصفحات المحددة، أو النطاق لو الملفات من غير صفحات) */
export function poolOf(qs, o) {
  if (hasPages(qs)) {
    const keys = new Set(pageScope(qs, o, false).map(g => g.key));
    return qs.filter(q => keys.has((q.src || '') + '\u0001' + (q.page || '')));
  }
  return inRange(qs, +o.from || 0, +o.to || 0);
}

/* العدد اللي هيتسحب فعلًا من كل نوع */
export function planCounts(qs, o) {
  if (o.comp) {
    const c = typeCounts(poolOf(qs, o));
    const avail = { mcq: o.mode === 'essay' ? 0 : c.mcq, essay: o.mode === 'mcq' ? 0 : c.essay, rangeMcq: c.mcq, rangeEssay: c.essay };
    const w = v => Math.max(0, +v || 0);
    const paged = hasPages(qs);
    return { paged, comp: true, rows: [], pages: paged ? pageScope(qs, o, false).length : 0, mcq: Math.min(w(o.cMcq), avail.mcq), essay: Math.min(w(o.cEssay), avail.essay), avail };
  }
  if (hasPages(qs)) {
    const rows = pageRows(qs, o, false);
    const sc = pageScope(qs, o, false);
    return {
      paged: true, rows,
      mcq: sum(rows, r => r.mcq), essay: sum(rows, r => r.essay),
      avail: { mcq: sum(rows, r => r.maxM), essay: sum(rows, r => r.maxE), rangeMcq: sum(sc, g => g.mcq), rangeEssay: sum(sc, g => g.essay) },
    };
  }
  const a = available(qs, o);
  return { paged: false, mcq: cap(o.nMcq, a.mcq), essay: cap(o.nEssay, a.essay), avail: a };
}

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export function planExam(qs, o) {
  const c = planCounts(qs, o);
  const pick = (arr, n) => { const a = arr.slice(); if (o.shuffle) shuffleArr(a); return a.slice(0, n); };
  let mcq = [];
  let essay = [];
  if (c.comp) {
    /* شامل: سحب عشوائي دايمًا من كل الصفحات المحددة مع بعض */
    const pool = poolOf(qs, o);
    mcq = shuffleArr(pool.filter(q => q.type === 'mcq')).slice(0, c.mcq);
    essay = shuffleArr(pool.filter(q => q.type === 'essay')).slice(0, c.essay);
  } else if (c.paged) {
    c.rows.forEach(r => {
      const inG = qs.filter(q => (q.src || '') === r.g.src && (q.page || '') === r.g.page);
      mcq.push(...pick(inG.filter(q => q.type === 'mcq'), r.mcq));
      essay.push(...pick(inG.filter(q => q.type === 'essay'), r.essay));
    });
    if (o.shuffle) { shuffleArr(mcq); shuffleArr(essay); }
  } else {
    const r = inRange(qs, +o.from || 0, +o.to || 0);
    mcq = pick(o.mode === 'essay' ? [] : r.filter(q => q.type === 'mcq'), c.mcq);
    essay = pick(o.mode === 'mcq' ? [] : r.filter(q => q.type === 'essay'), c.essay);
  }
  const list = [...mcq, ...essay].map(q => ({ ...q, options: q.options.slice(), user: null, self: null }));
  if (o.shuffleOpts) {
    list.forEach(q => {
      if (q.type !== 'mcq' || q.correct == null) return;
      const order = shuffleArr(q.options.map((_, k) => k));
      q.options = order.map(k => q.options[k]);
      q.correct = order.indexOf(q.correct);
    });
  }
  return list;
}

export const fmtDate = ts => (ts ? new Date(ts).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/* ---------- الامتحانات المنشأة (بتتحفظ في حساب المستخدم) ---------- */
/* امتحانات المالك بتظهر لكل المستخدمين (علامتها _sh) ومعاها امتحانات المستخدم الخاصة. النتايج محفوظة لكل مستخدم لوحده وبتتدمج هنا وقت القراءة بس */
export function loadExams() {
  try {
    const own = JSON.parse(bk().getExams() || '[]');
    const sh = JSON.parse(bk().getSharedExams() || '[]');
    const l = [...(Array.isArray(sh) ? sh : []).map(e => ({ ...e, _sh: true })), ...(Array.isArray(own) ? own : [])];
    const rs = bk().getResults() || {};
    return l.map(e => (rs[e.id] ? { ...e, ...rs[e.id] } : { ...e, history: undefined, last: null, best: 0, attempts: 0 }));
  } catch { return []; }
}
export function saveExams(l) {
  try {
    /* النتايج ماتتخزنش جوه الامتحان المشترك */
    bk().setExams(JSON.stringify(l.filter(e => !e._sh).map(({ history, last, best, attempts, ...e }) => ({ ...e, qs: (e.qs || []).map(({ _sh, ...q }) => q) }))));
    return true;
  } catch { return false; }
}
/* سجل المحاولات: كل محاولة = {aid, at, kind:'full'|'wrong', pct, right, total, essays, wrong:[{i, u}]}
   i = رقم السؤال في الامتحان المحفوظ، u = اختيارك وقتها. (الامتحانات القديمة اللي ليها last بس بتتحوّل لمحاولة واحدة) */
export function histOf(ex) {
  if (Array.isArray(ex.history)) return ex.history;
  if (ex.last && ex.last.total != null) {
    const l = ex.last;
    return [{ aid: 'legacy', at: l.at || ex.created, kind: 'full', pct: l.pct, right: l.right, total: l.total, essays: l.essays || 0, wrong: (l.wrong || []).map(i => ({ i, u: undefined })) }];
  }
  return [];
}
/* بيسجل (أو بيحدّث) محاولة على الامتحان المحفوظ. الأخطاء المتبقية = أخطاء آخر محاولة */
export function recordResult(id, entry) {
  if (!id) return;
  const prev = loadExams().find(e => e.id === id);
  if (!prev) return;
  const hist = histOf(prev).filter(h => h.aid !== entry.aid);
  hist.push(entry);
  const full = hist.filter(h => h.kind === 'full');
  bk().setResult(id, { history: hist, last: entry, best: full.length ? Math.max(...full.map(h => h.pct)) : 0, attempts: hist.length });
}

/* ---------- برومبت NotebookLM (بيتعدّل ويتحفظ لكل مستخدم) ---------- */
export const loadPrompt = () => String(bk().getPrompt() || '');
export function savePrompt(text) {
  try { bk().setPrompt(String(text || '')); return true; } catch { return false; }
}

/* ---------- ملف المستخدم (الاسم والصورة) ---------- */
export function loadProfile() {
  const p = bk().getProfile() || {};
  return { name: p.name || '', photo: p.photo || '' };
}
export function saveProfile(p) {
  try { bk().setProfile({ name: p.name || '', photo: p.photo || '' }); return true; } catch { return false; }
}
