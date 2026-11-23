/* قراءة ملفات الأسئلة والإجابات وتحويلها لأسئلة جاهزة */
import { pageGroups, hasPages } from './pagelogic.js';

export const LET = ['أ', 'ب', 'ج', 'د', 'هـ', 'و'];
const LMAP = { 'أ': 0, 'ا': 0, 'إ': 0, a: 0, 'ب': 1, b: 1, 'ج': 2, c: 2, 'د': 3, d: 3 };
const AR = '٠١٢٣٤٥٦٧٨٩';
const norm = s => String(s).replace(/\r/g, '').replace(/[٠-٩]/g, d => AR.indexOf(d)).replace(/\*\*|__/g, '');

const HEAD = /^\s*(?:(?:السؤال|سؤال|س|Q|#)\s*)?(\d+)\s*[\.\)\-:：–]\s*(.*)$/i;
const HEADW = /^\s*(?:السؤال|سؤال|الإجابة|الاجابة|إجابة|اجابة|الجواب|جواب|Q)\s*(\d+)\s*[\.\)\-:：–]?\s*(.*)$/i;
const SECW = '(?:أولا|أولاً|ثانيا|ثانياً|ثالثا|ثالثاً|رابعا|رابعاً|خامسا|خامساً)';
const SEC = new RegExp('^\\s*' + SECW + '\\s*[:：]');
const SEP = /^\s*[=\-]{3,}\s*$/;
const PAGE = /[\(\[]\s*(?:صفحة|صفحه|ص)\s*[\d\s\-–,،و]+[\)\]]/g;
const OPT = /^\s*\(?([أاإبجدabcdABCD])\s*[\)\.\-:：]\s*(\S.*)$/;
/* سطر فيه رقم الصفحة لوحده: [صفحة 56] أو === صفحة 56 === أو صفحة 56: */
const PAGELINE = /^[ \t]*[\[\(=\-#*]*[ \t]*(?:الصفحة|صفحة|صفحه)[ \t]*(\d+)[ \t]*[\]\)=\-*:：]*[ \t]*$/gm;
const SENT = /\u27E6(\d*)\u27E7/g;
const BRK = '\\[\\s*(?:(?:الإجابة|الاجابة|إجابة|اجابة|الجواب|جواب)\\s*)?(?:(?:السؤال|سؤال|س|ج|Q|A)\\s*)?(\\d+)\\s*\\]';

/* تقسيم النص لبنود مرقمة. بيقبل: "1." و "سؤال 1:" و "[سؤال 1]" وبيتجاهل (صفحة 56)
   وبيبدأ ترقيم جديد بعد خطوط الفصل (=====) وبعد عناوين الأقسام (أولاً: ... ثانياً: ...) */
function splitItems(text) {
  let t = norm(text)
    .replace(PAGELINE, '\n\u27E6P$1\u27E7\n')
    .replace(PAGE, m => ' \u27E6' + ((m.match(/\d+/) || [''])[0]) + '\u27E7 ')
    .replace(/^[ \t]*```.*$/gm, '');
  t = t.replace(new RegExp('[ \\t]*(' + BRK.replace('(\\d+)', '\\d+') + ')', 'gi'), '\n$1');
  t = t.replace(new RegExp('[ \\t]+(' + SECW + '\\s*[:：])', 'g'), '\n$1');
  t = t.replace(/[ \t]+([أبجدa-d])\)\s/g, '\n$1) ');
  const items = [];
  const meta = [];
  const rej = [];
  let cur = null;
  let base = 0; // أول بند في الصفحة/الملف الحالي (الترقيم بيبدأ من 1)
  let sbase = 0; // أول بند في القسم الحالي (أولاً / ثانياً)
  let page = '';
  const HB = new RegExp('^\\s*' + BRK + '\\s*(.*)$', 'i');
  const lines = t.split('\n');
  // لو الملف بيستخدم عناوين بأقواس [سؤال N] نعتمد عليها بس، وأي نقط مرقمة (1. 2. 3.) جوه الإجابة تفضل جزء منها
  const strong = lines.some(l => HB.test(l));
  for (const raw of lines) {
    const pm = raw.match(/^\s*\u27E6P(\d+)\u27E7\s*$/);
    if (pm) { page = pm[1]; cur = null; base = sbase = items.length; continue; }
    if (SEP.test(raw)) { cur = null; base = sbase = items.length; page = ''; continue; }
    if (SEC.test(raw)) { cur = null; sbase = items.length; continue; }
    const mb = raw.match(HB);
    const m = mb || (strong ? null : (raw.match(HEADW) || raw.match(HEAD)));
    const n = m ? +m[1] : 0;
    if (m && (mb || n === items.length - base + 1 || n === items.length - sbase + 1 || n === items.length + 1)) {
      cur = [mb ? mb[2] : m[2]];
      items.push(cur);
      meta.push({ page, n });
    } else {
      if (m) rej.push(raw.trim().slice(0, 60));
      if (cur) cur.push(raw);
    }
  }
  items.rej = rej;
  items.meta = meta;
  return items;
}

function parseQuestions(text) {
  const raw = splitItems(text);
  const out = raw.map((lines0, ix) => {
    let inlinePage = '';
    const lines = lines0.map(ln => ln.replace(SENT, (m, d) => { if (!inlinePage && d) inlinePage = d; return ' '; }));
    const q = [];
    const opts = [];
    let inOpt = false;
    for (const ln of lines) {
      const m = ln.match(OPT);
      if (m) { opts.push(m[2].trim()); inOpt = true; }
      else if (inOpt && ln.trim()) opts[opts.length - 1] += ' ' + ln.trim();
      else if (!inOpt) q.push(ln);
    }
    let qt = q.join('\n').trim();
    const forcedEssay = /^\[?\s*مقالي/.test(qt);
    qt = qt.replace(/^\[\s*(?:مقالي|اختياري)[^\]]*\]\s*/, '').replace(/[ \t]{2,}/g, ' ').trim();
    const mcq = opts.length >= 2 && !forcedEssay;
    const mt = raw.meta[ix] || { page: '', n: ix + 1 };
    return { type: mcq ? 'mcq' : 'essay', q: qt, options: mcq ? opts : [], correct: null, exp: '', model: '', page: mt.page || inlinePage, n: mt.n };
  });
  out.rej = raw.rej;
  return out;
}

function parseAnswers(text) {
  const raw = splitItems(text);
  const out = raw.map(lines =>
    lines.join('\n').replace(SENT, ' ').trim().replace(/^(?:الإجابة الصحيحة|الاجابة الصحيحة|الإجابة النموذجية|الإجابة|الاجابة|الجواب|Answer)\s*[:：\-]?\s*/i, '')
  );
  out.rej = raw.rej;
  out.meta = raw.meta;
  return out;
}

/* دمج الأسئلة مع إجاباتها بنفس الترتيب */
export function build(qText, aText) {
  const qs = parseQuestions(qText);
  const ans = parseAnswers(aText);
  /* لو الأسئلة والإجابات فيهم أرقام صفحات، بنطابق بالصفحة ورقم السؤال، وإلا بنطابق بالترتيب */
  const byKey = qs.length > 0 && ans.length > 0 && qs.every(q => q.page) && ans.meta.every(m => m.page);
  const amap = new Map();
  if (byKey) ans.forEach((_, i) => { const k = ans.meta[i].page + '|' + ans.meta[i].n; if (!amap.has(k)) amap.set(k, i); });
  const used = new Set();
  const missing = [];
  qs.forEach((q, i) => {
    let ai = i;
    if (byKey) {
      ai = amap.get(q.page + '|' + q.n);
      if (ai == null) { missing.push({ page: q.page, n: q.n }); return; }
      used.add(ai);
    }
    const a = ans[ai];
    if (!a) return;
    if (q.type === 'mcq') {
      const m = a.match(/^\(?([أاإبجدabcdABCD])(?![؀-ۿa-zA-Z])\s*[\)\.\-:：–]?\s*([\s\S]*)$/);
      if (m) {
        q.correct = LMAP[m[1].toLowerCase()];
        q.exp = m[2].trim();
        if (q.correct >= q.options.length) q.correct = null;
        else {
          const ot = q.options[q.correct].replace(/[\s\.]+$/, '');
          if (ot && q.exp.startsWith(ot)) q.exp = q.exp.slice(ot.length);
          q.exp = q.exp.replace(/^[\s\.\-:：]+/, '').replace(/^(?:ملاحظة|ملاحظه|الشرح|التفسير|التوضيح)\s*[:：]\s*/, '');
        }
      } else {
        const k = q.options.findIndex(o => a.startsWith(o));
        if (k >= 0) { q.correct = k; q.exp = a.slice(q.options[k].length).replace(/^[\s\-:：\.]+/, ''); }
        else q.exp = a;
      }
    } else q.model = a;
  });
  const extra = byKey ? ans.map((_, i) => i).filter(i => !used.has(i)).map(i => ({ page: ans.meta[i].page, n: ans.meta[i].n })) : [];
  return { qs, ans, qRej: qs.rej || [], aRej: ans.rej || [], byKey, missing, extra };
}

/* تقرير بسيط للمستخدم عن اللي اتعرف من الملفين */
export function diagnose(p, aText) {
  const { qs, ans, qRej, aRej } = p;
  const nQ = qs.length;
  const nA = ans.length;
  const mc = qs.filter(q => q.type === 'mcq').length;
  const noKey = qs.filter(q => q.type === 'mcq' && q.correct == null);
  const hasA = aText.trim().length > 0;
  const lines = [];
  if (!nQ) {
    return { level: 'err', nQ: 0, nA, mc: 0, es: 0, lines: ['مفيش أسئلة اتعرفت. اتأكد إن كل سؤال له عنوان زي [سؤال 1] أو 1. وبالتسلسل.'] };
  }
  let level = 'ok';
  if (!hasA) {
    level = 'warn';
    lines.push('لسه ما حطيتش ملف الإجابات، التصحيح مش هيشتغل من غيره.');
  } else if (p.byKey) {
    const lab = x => `صفحة ${x.page} سؤال ${x.n}`;
    if (p.missing.length) {
      level = 'warn';
      lines.push(`${p.missing.length} سؤال مالهوش إجابة بنفس رقم الصفحة والسؤال، مثلًا: ` + p.missing.slice(0, 3).map(lab).join('، '));
    }
    if (p.extra.length) {
      level = 'warn';
      lines.push(`${p.extra.length} إجابة مالهاش سؤال مطابق، مثلًا: ` + p.extra.slice(0, 3).map(lab).join('، '));
    }
    if (noKey.length) {
      level = 'warn';
      const bad = noKey.slice(0, 3);
      lines.push(`${noKey.length} سؤال اختياري من غير إجابة صحيحة معروفة (الإجابة قدامه مفيهاش حرف أ/ب/ج/د في أولها). مثلًا: ` + bad.map(q => `صفحة ${q.page} سؤال ${q.n}`).join('، '));
    }
  } else {
    if (nA !== nQ) {
      level = 'warn';
      lines.push(nA < nQ
        ? `الإجابات ناقصة ${nQ - nA}، وقفت عند الإجابة رقم ${nA}، والأسئلة من ${nA + 1} لحد ${nQ} من غير إجابة.`
        : `الإجابات زيادة ${nA - nQ} عن عدد الأسئلة.`);
      if (nA && nA < nQ) {
        const last = ans[nA - 1];
        lines.push(`آخر إجابة اتعرفت بتنتهي بـ: «…${last.slice(-70)}»` + (last.length > 700 ? ' ← الإجابة دي طويلة بشكل غريب، غالبًا الإجابات اللي بعدها مش متعرفة لأن عنوانها مكتوب بشكل مختلف.' : ''));
      }
    }
    if (noKey.length) {
      level = 'warn';
      const bad = qs.map((q, i) => ({ q, i })).filter(x => x.q.type === 'mcq' && x.q.correct == null).slice(0, 3);
      lines.push(`${noKey.length} سؤال اختياري من غير إجابة صحيحة معروفة (الإجابة قدامه مفيهاش حرف أ/ب/ج/د في أولها). مثلًا: ` + bad.map(({ q, i }) => `سؤال ${i + 1} «${q.q.slice(0, 30)}…»`).join('، '));
    }
  }
  if (aRej.length) lines.push('سطور شبه العناوين في الإجابات واتجاهلت بسبب الترقيم: ' + aRej.slice(0, 3).map(x => '«' + x + '»').join('، '));
  if (qRej.length) lines.push('سطور شبه العناوين في الأسئلة واتجاهلت بسبب الترقيم: ' + qRej.slice(0, 3).map(x => '«' + x + '»').join('، '));
  return { level, nQ, nA, mc, es: nQ - mc, lines, pages: hasPages(qs) ? pageGroups(qs) : null };
}

export const SAMPLE_Q = `[صفحة 56]
أولاً: أسئلة الاختيار من متعدد
[السؤال 1]
ما وحدة قياس القوة في النظام الدولي للوحدات؟
أ) الجول
ب) النيوتن
ج) الواط
د) الباسكال
[السؤال 2]
أي مما يلي ينتج عن عملية البناء الضوئي؟
أ) ثاني أكسيد الكربون
ب) النيتروجين
ج) الأكسجين والجلوكوز
د) الهيدروجين فقط
ثانياً: أسئلة المقال
[السؤال 3]
اشرح نص قانون نيوتن الثاني للحركة مع كتابة صيغته الرياضية.

[صفحة 57]
أولاً: أسئلة الاختيار من متعدد
[السؤال 1]
ما الكمية الفيزيائية التي تقاس بالواط؟
أ) القوة
ب) الشغل
ج) القدرة
د) الضغط
ثانياً: أسئلة المقال
[السؤال 2]
عرّف الشغل واذكر وحدة قياسه.`;

export const SAMPLE_A = `[صفحة 56]
[السؤال 1]
الاجابة: ب) النيوتن
ملاحظة: القوة تقاس بالنيوتن، والجول للشغل والطاقة، والواط للقدرة، والباسكال للضغط.
[السؤال 2]
الاجابة: ج) الأكسجين والجلوكوز
ملاحظة: في البناء الضوئي يمتص النبات ثاني أكسيد الكربون والماء بوجود الضوء وينتج الجلوكوز ويطلق الأكسجين.
[السؤال 3]
الاجابة: تتناسب القوة المحصلة المؤثرة على جسم طرديا مع العجلة التي يكتسبها. الصيغة: ق = ك × ع.

[صفحة 57]
[السؤال 1]
الاجابة: ج) القدرة
ملاحظة: الواط وحدة قياس القدرة.
[السؤال 2]
الاجابة: الشغل هو حاصل ضرب القوة في الإزاحة في اتجاهها، ويقاس بالجول.`;

export const PROMPT = `اعمل لي أسئلة امتحان على الصفحات من [رقم] إلى [رقم] من المصدر المحدد، في ملفين منفصلين، بالصيغة دي بالظبط ومن غير جداول ولا تنسيق إضافي.

لكل صفحة اعمل [عدد] سؤال اختيار من متعدد و[عدد] سؤال مقالي (لو الصفحة معلوماتها تكفي).

ابدأ كل صفحة بسطر لوحده فيه رقم الصفحة بالشكل ده: [صفحة 56]
وترقيم الأسئلة يبدأ من 1 من جديد مع كل صفحة، ويكمل بالتسلسل من الاختياري للمقالي جوه نفس الصفحة.

الملف الأول (الأسئلة):
[صفحة 56]
أولاً: أسئلة الاختيار من متعدد
[السؤال 1]
نص السؤال
أ) ...
ب) ...
ج) ...
د) ...
ثانياً: أسئلة المقال
[السؤال 2]
نص السؤال
[صفحة 57]
أولاً: أسئلة الاختيار من متعدد
[السؤال 1]
...

الملف الثاني (الإجابات) بنفس أرقام الصفحات والأسئلة بالظبط:
[صفحة 56]
[السؤال 1]
الاجابة: ب) نص الاختيار الصحيح.
ملاحظة: شرح مختصر ليه ده هو الصح.
[السؤال 2]
الاجابة: الإجابة النموذجية كاملة.
[صفحة 57]
[السؤال 1]
...

قواعد مهمة:
- اكتب سطر [صفحة رقم] في الملفين لكل صفحة، وابدأ ترقيم أسئلتها من 1.
- لكل سؤال في ملف الأسئلة إجابة واحدة بنفس رقم الصفحة ونفس رقم السؤال في ملف الإجابات.
- ممنوع أي عناوين تانية غير [صفحة رقم] و[السؤال رقم]، وممنوع تكرار أي إجابة.
- كل سؤال اختياري له 4 اختيارات (أ ب ج د) وإجابة صحيحة واحدة بس.
- وزّع حرف الإجابة الصحيحة بشكل متنوع: ممنوع نفس الحرف يتكرر كإجابة صحيحة في سؤالين ورا بعض، وخلي أ وب وج ود موزعين بالتساوي تقريبًا في كل صفحة، ومن غير ترتيب منتظم (زي أ ب ج د أ ب ج د). راجع ده قبل ما تكتب الملف.
- اعتمد على المصدر المحدد بس، ولا تضيف معلومات من خارجه.`;
