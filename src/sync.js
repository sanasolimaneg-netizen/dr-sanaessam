/* مزامنة بيانات المستخدم (المكتبة والامتحانات والملف الشخصي) مع قاعدة البيانات.
   الواجهة بتشتغل على نسخة في الذاكرة (سريعة ومتزامنة)، وده بيرفع التغييرات للسحابة في الخلفية
   (بس اللي اتغيّر). مستند Firestore حده الأقصى 1 ميجا، فالأسئلة بتتقسّم لأجزاء (chunks) صغيرة. */

export const MAX_BYTES = 600000;
const enc = new TextEncoder();
const bytes = v => enc.encode(JSON.stringify(v)).length;

/* بيقسّم قايمة أسئلة لأجزاء حجم كل واحد أقل من MAX_BYTES */
export function splitQs(qs) {
  const out = [];
  let cur = [];
  let size = 0;
  for (const q of qs || []) {
    const b = bytes(q) + 2;
    if (cur.length && size + b > MAX_BYTES) { out.push(cur); cur = []; size = 0; }
    cur.push(q);
    size += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* adapter: {
     listEntities(uid, col) -> [{ e, n }]        e = الكيان كامل (والأسئلة مجمّعة)، n = عدد الأجزاء المخزّنة
     writeEntity(uid, col, id, meta, chunks, oldN)
     deleteEntity(uid, col, id, n)
     getProfile(uid) -> {name, photo} | null
     setProfile(uid, p)
   } */
const COLS = { lib: 'sets', exams: 'exams' };
const byOrder = (a, b) => ((a.created || 0) - (b.created || 0)) || String(a.id).localeCompare(String(b.id));

/* uid = المستخدم الحالي: بياناته الخاصة (الدروس والامتحانات اللي هو عملها، نتايجه، ملفه الشخصي).
   sharedUid = المالك: دروسه وامتحاناته بتتقرا (قراءة بس) وبتظهر لكل المستخدمين. لو المستخدم هو المالك مفيش محتوى مشترك منفصل. */
const RES_KEYS = ['history', 'last', 'best', 'attempts'];
const hasRes = e => RES_KEYS.some(k => k in e);
const stripRes = e => { const { history, last, best, attempts, ...rest } = e; return rest; };

export function createSync(adapter, uid, { sharedUid = uid, onError = () => {}, delay = 700, retryMs = 8000 } = {}) {
  const hasShared = sharedUid !== uid;
  const cache = { lib: '[]', exams: '[]', sharedLib: '[]', sharedExams: '[]', profile: { name: '', photo: '' }, prompt: '', results: {} };
  const resDirty = new Set();
  const synced = { sets: new Map(), exams: new Map() };
  const dirty = { lib: false, exams: false, profile: false, prompt: false };
  let timer = null;
  let running = null;
  let again = false;
  let fails = 0;

  async function load() {
    const rs = await adapter.listResults(uid);
    cache.results = Object.fromEntries(rs.map(r => [r.id, r.data]));
    for (const [key, col] of Object.entries(COLS)) {
      const list = await adapter.listEntities(uid, col);
      const stripped = new Set();
      /* نتايج قديمة كانت متخزنة جوه الامتحان نفسه: بنفصلها عشان النتايج تبقى خاصة بكل مستخدم */
      const ents = list.map(x => {
        const e = x.e;
        if (col !== 'exams' || !hasRes(e)) return e;
        stripped.add(e.id);
        if (!cache.results[e.id]) { const { history, last, best, attempts } = e; cache.results[e.id] = { history, last, best, attempts }; resDirty.add(e.id); }
        return stripRes(e);
      }).sort(byOrder);
      cache[key] = JSON.stringify(ents);
      const ns = new Map(list.map(x => [x.e.id, x.n]));
      /* التوقيع بيتحسب من نسخة الكاش نفسها عشان ترتيب الحقول يفضل ثابت */
      synced[col] = new Map(JSON.parse(cache[key]).map(e => [e.id, { sig: stripped.has(e.id) ? '' : JSON.stringify(e), n: ns.get(e.id) || 0 }]));
      if (stripped.size) dirty[key] = true;
    }
    if (hasShared) {
      /* محتوى المالك: قراءة بس */
      const sl = await adapter.listEntities(sharedUid, 'sets');
      cache.sharedLib = JSON.stringify(sl.map(x => x.e).sort(byOrder));
      const se = await adapter.listEntities(sharedUid, 'exams');
      cache.sharedExams = JSON.stringify(se.map(x => stripRes(x.e)).sort(byOrder));
    }
    const p = await adapter.getProfile(uid);
    cache.profile = { name: (p && p.name) || '', photo: (p && p.photo) || '' };
    cache.prompt = await adapter.getPrompt(uid);
    if (dirty.lib || dirty.exams || resDirty.size) schedule();
  }

  async function pushAll() {
    if (dirty.profile) {
      dirty.profile = false;
      try { await adapter.setProfile(uid, cache.profile); } catch (e) { dirty.profile = true; throw e; }
    }
    if (dirty.prompt) {
      dirty.prompt = false;
      try { await adapter.setPrompt(uid, cache.prompt); } catch (e) { dirty.prompt = true; throw e; }
    }
    for (const id of [...resDirty]) {
      resDirty.delete(id);
      try { await adapter.setResult(uid, id, cache.results[id]); } catch (e) { resDirty.add(id); throw e; }
    }
    for (const [key, col] of Object.entries(COLS)) {
      if (!dirty[key]) continue;
      dirty[key] = false;
      try {
        const arr = JSON.parse(cache[key]);
        const seen = new Set();
        for (const e of arr) {
          if (!e || !e.id) continue;
          seen.add(e.id);
          const sig = JSON.stringify(e);
          const prev = synced[col].get(e.id);
          if (prev && prev.sig === sig) continue;
          const { qs, ...meta } = e;
          const chunks = splitQs(qs);
          await adapter.writeEntity(uid, col, e.id, { ...meta, chunks: chunks.length }, chunks, prev ? prev.n : 0);
          synced[col].set(e.id, { sig, n: chunks.length });
        }
        for (const [id, prev] of [...synced[col]]) {
          if (seen.has(id)) continue;
          await adapter.deleteEntity(uid, col, id, prev.n);
          synced[col].delete(id);
        }
      } catch (e) { dirty[key] = true; throw e; }
    }
  }

  function schedule(ms) { clearTimeout(timer); timer = setTimeout(run, ms == null ? delay : ms); }

  function run() {
    clearTimeout(timer);
    timer = null;
    if (running) { again = true; return running; }
    running = (async () => {
      do {
        again = false;
        try { await pushAll(); fails = 0; } catch (e) {
          fails++;
          onError(e, fails);
          if (fails < 5) schedule(retryMs);
        }
      } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  const pending = () => dirty.lib || dirty.exams || dirty.profile || dirty.prompt || resDirty.size > 0 || !!running || !!timer;
  /* بيرفع أي تغييرات لسه ماترفعتش (قبل تسجيل الخروج مثلًا) */
  async function flush() {
    for (let i = 0; i < 3 && (dirty.lib || dirty.exams || dirty.profile || dirty.prompt || resDirty.size || running); i++) await run();
  }
  const mark = key => { dirty[key] = true; schedule(); };

  return {
    load, flush, pending,
    getLib: () => cache.lib, setLib: s => { cache.lib = s; mark('lib'); },
    getExams: () => cache.exams, setExams: s => { cache.exams = s; mark('exams'); },
    getSharedLib: () => cache.sharedLib, getSharedExams: () => cache.sharedExams,
    getProfile: () => cache.profile, setProfile: p => { cache.profile = p; mark('profile'); },
    getPrompt: () => cache.prompt, setPrompt: t => { cache.prompt = t; mark('prompt'); },
    getResults: () => cache.results,
    setResult: (id, r) => { cache.results = { ...cache.results, [id]: r }; resDirty.add(id); schedule(); },
  };
}
