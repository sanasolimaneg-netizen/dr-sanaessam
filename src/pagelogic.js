/* تجميع الأسئلة حسب الصفحة (والملف اللي جت منه) */

export const hasPages = qs => qs.some(q => q.page);

/* كل مجموعة = صفحة واحدة من ملف واحد، مع عدد الاختياري والمقالي فيها */
export function pageGroups(qs) {
  const map = new Map();
  const srcOrder = [];
  qs.forEach(q => {
    const src = q.src || '';
    const page = q.page || '';
    const key = src + '\u0001' + page;
    if (!map.has(key)) {
      map.set(key, { key, src, page, source: q.source || '', mcq: 0, essay: 0 });
      if (!srcOrder.includes(src)) srcOrder.push(src);
    }
    map.get(key)[q.type === 'mcq' ? 'mcq' : 'essay']++;
  });
  return [...map.values()].sort((a, b) =>
    (srcOrder.indexOf(a.src) - srcOrder.indexOf(b.src)) ||
    ((a.page === '' ? 1 : 0) - (b.page === '' ? 1 : 0)) ||
    ((+a.page || 0) - (+b.page || 0)));
}

export const pageLabel = g => (g.page ? 'صفحة ' + g.page : 'من غير صفحة');

/* ---------- البحث برقم الصفحة ----------
   رقم واحد (56): بيطابق أي صفحة بتبدأ بيه.
   أرقام بينها / أو , أو مسافة (1/2/4/6): بيطابق الصفحات دي بالظبط.
   نطاق (5-8): كل الصفحات من 5 لـ 8، وممكن يتخلط مع الأرقام (1/4-6/9). */
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const normDigits = s => String(s).replace(/[٠-٩]/g, d => AR_DIGITS.indexOf(d));

export function parsePageSearch(v) {
  const t = normDigits(v).replace(/(\d)\s*[-–—]\s*(?=\d)/g, '$1-');
  const tokens = [];
  t.split(/[\/,،\s]+/).forEach(x => {
    const r = x.match(/^(\d+)-(\d+)$/);
    if (r) tokens.push({ a: Math.min(+r[1], +r[2]), b: Math.max(+r[1], +r[2]) });
    else {
      const d = x.replace(/\D/g, '');
      if (d) tokens.push({ a: +d, b: +d, s: String(+d) });
    }
  });
  const multi = tokens.length > 1 || /[\/,،]/.test(t) || /\d-\d/.test(t);
  return { active: tokens.length > 0, multi, tokens };
}

export function matchPage(page, spec) {
  if (!page || !spec.active) return false;
  if (!spec.multi) return page.startsWith(spec.tokens[0].s);
  const p = +page;
  return spec.tokens.some(t => p >= t.a && p <= t.b);
}

/* الأسئلة اللي صفحتها جوه نطاق درس */
export const inLesson = (q, l) => !!q.page && +q.page >= l.from && +q.page <= l.to;
