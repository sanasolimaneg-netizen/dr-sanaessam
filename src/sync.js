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

export function createSync(adapter, uid, { onError = () => {}, delay = 700, retryMs = 8000 } = {}) {
  const cache = { lib: '[]', exams: '[]', profile: { name: '', photo: '' } };
  const synced = { sets: new Map(), exams: new Map() };
  const dirty = { lib: false, exams: false, profile: false };
  let timer = null;
  let running = null;
  let again = false;
  let fails = 0;

  async function load() {
    for (const [key, col] of Object.entries(COLS)) {
      const list = await adapter.listEntities(uid, col);
      const ents = list.map(x => x.e).sort(byOrder);
      cache[key] = JSON.stringify(ents);
      const ns = new Map(list.map(x => [x.e.id, x.n]));
      /* التوقيع بيتحسب من نسخة الكاش نفسها عشان ترتيب الحقول يفضل ثابت */
      synced[col] = new Map(JSON.parse(cache[key]).map(e => [e.id, { sig: JSON.stringify(e), n: ns.get(e.id) || 0 }]));
    }
    const p = await adapter.getProfile(uid);
    cache.profile = { name: (p && p.name) || '', photo: (p && p.photo) || '' };
  }

  async function pushAll() {
    if (dirty.profile) {
      dirty.profile = false;
      try { await adapter.setProfile(uid, cache.profile); } catch (e) { dirty.profile = true; throw e; }
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

  const pending = () => dirty.lib || dirty.exams || dirty.profile || !!running || !!timer;
  /* بيرفع أي تغييرات لسه ماترفعتش (قبل تسجيل الخروج مثلًا) */
  async function flush() {
    for (let i = 0; i < 3 && (dirty.lib || dirty.exams || dirty.profile || running); i++) await run();
  }
  const mark = key => { dirty[key] = true; schedule(); };

  return {
    load, flush, pending,
    getLib: () => cache.lib, setLib: s => { cache.lib = s; mark('lib'); },
    getExams: () => cache.exams, setExams: s => { cache.exams = s; mark('exams'); },
    getProfile: () => cache.profile, setProfile: p => { cache.profile = p; mark('profile'); },
  };
}
