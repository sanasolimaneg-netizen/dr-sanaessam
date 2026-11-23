import React, { useContext, useEffect, useMemo, useState } from 'react';
import { Icon, SubjectIcon, Modal, Breadcrumb, useToast, cx, AuthCtx } from './ui.jsx';
import { build, diagnose, SAMPLE_Q, SAMPLE_A, PROMPT, LET } from './parser.js';
import {
  SUBJECTS, NOSUBJ, subjectMeta, loadLib, saveLib, subjOf, uid, useSession, selEntries, combine, addToLibrary, getBank, mergeInto, sortQs, qKey, libStats,
  DEFAULT_OPTS, typeCounts, inRange, planCounts, planExam, fmtDate, hasPages, pageGroups, pageRows, loadExams, saveExams, histOf,
} from './store.js';
import { pageLabel, parsePageSearch, matchPage, inLesson } from './pagelogic.js';
import * as cloud from './cloud.js';

/* =========================================================
   الصفحة الرئيسية: اختيار المادة
   ========================================================= */
export function Home() {
  const lib = useMemo(() => loadLib(), []);
  const stat = k => {
    const m = lib.filter(s => subjOf(s) === k);
    const st = libStats(m);
    return { has: m.length > 0, pages: st.pages, legacy: st.legacy, q: st.q };
  };
  const { can } = useContext(AuthCtx);
  const subs = [...SUBJECTS, ...(stat('none').has ? [NOSUBJ] : [])].filter(s => can.subject(s.key));
  return (
    <main className="container home">
      <section className="hero">
        <span className="eyebrow">منصة مذاكرة</span>
        <h1>ذاكر من أسئلتك، وامتحن نفسك بالطريقة اللي تريحك</h1>
        <p>اختار المادة، ضيف ملف الأسئلة وملف الإجابات، واحفظهم. بعدها اختار ملف أو أكتر وحدد الصفحات والعدد والنوع اللي انت عاوزه.</p>
        <ul className="points">
          <li><Icon name="layers" size={18} /> اعمل امتحان من أكتر من درس</li>
          <li><Icon name="shield" size={18} /> نتايج امتحاناتك خاصة بيك ومحدش غيرك يشوفها</li>
          <li><Icon name="device" size={18} /> شغال على الموبايل والكمبيوتر</li>
        </ul>
      </section>

      <h2 className="section-title">اختار المادة</h2>
      <div className="subjects">
        <a className="subject-card" href="#/results" style={{ '--accent': '#0d9488' }}>
          <span className="badge"><Icon name="results" size={28} /></span>
          <span className="sc-body">
            <b>نتائجي</b>
            <span className="sc-meta">نتايج امتحانات كل المواد</span>
          </span>
          <Icon name="back" size={20} className="sc-arrow" />
        </a>
        {subs.map(s => {
          const st = stat(s.key);
          return (
            <a key={s.key} className="subject-card" href={'#/subject/' + s.key} style={{ '--accent': s.accent }}>
              <span className="badge"><SubjectIcon meta={s} size={28} /></span>
              <span className="sc-body">
                <b>{s.label}</b>
                <span className="sc-meta">{st.has ? `${[st.pages ? st.pages + ' صفحة' : '', st.legacy ? st.legacy + ' ملف بدون صفحات' : ''].filter(Boolean).join(' · ')} · ${st.q} سؤال` : 'لسه مفيش ملفات'}</span>
              </span>
              <Icon name="back" size={20} className="sc-arrow" />
            </a>
          );
        })}
      </div>
    </main>
  );
}

/* =========================================================
   صفحة المادة
   ========================================================= */
export function SubjectPage({ subject, startExam }) {
  const meta = subjectMeta(subject);
  const notify = useToast();
  const [lib, setLib] = useState(() => loadLib());
  const mine = useMemo(() => lib.filter(s => subjOf(s) === subject), [lib, subject]);
  const [selIds, setSelIds] = useSession('sel_' + subject, []);
  const [optsRaw, setOpts] = useSession('opts_' + subject, DEFAULT_OPTS);
  /* عدد الأسئلة بيتحدد من فهرس الصفحات بس، فمفيش عدد عام لكل صفحة */
  const opts = useMemo(() => ({ ...DEFAULT_OPTS, ...optsRaw, perMcq: '', perEssay: '' }), [optsRaw]);
  const { can } = useContext(AuthCtx);
  const [tab0, setTab] = useSession('tab_' + subject, mine.length ? 'library' : 'add');
  const [allExams, setAllExams] = useState(() => loadExams());
  const exams = useMemo(() => allExams.filter(e => e.subject === subject).sort((a, b) => b.created - a.created), [allExams, subject]);
  const picked = useMemo(() => selEntries(mine, selIds), [mine, selIds]);
  /* لو مفيش حاجة متعلّم عليها، الامتحان بيشتغل على كل محتوى المادة وتحدد من الفهرس */
  const sel = useMemo(() => (picked.length ? picked : selEntries(mine, mine.map(s => s.id))), [picked, mine]);

  const commit = next => {
    if (saveLib(next)) { setLib(loadLib()); return true; }
    notify('المتصفح مش سامح بالحفظ، جرّب تفضي مساحة أو تغيّر إعدادات الخصوصية.', 'err');
    return false;
  };

  const stats = libStats(mine);
  const qs = useMemo(() => combine(sel), [sel]);
  const plan = planCounts(qs, opts);
  const total = plan.mcq + plan.essay;
  const rangeErr = !!((opts.from && opts.to && +opts.from > +opts.to) || (opts.pFrom && opts.pTo && +opts.pFrom > +opts.pTo));
  const canStart = sel.length > 0 && total > 0 && !rangeErr;

  const defaultName = `امتحان ${meta.label} ${exams.length + 1}`;
  const commitExams = next => {
    if (saveExams(next)) { setAllExams(loadExams()); return true; }
    notify('المتصفح مش سامح بحفظ الامتحان، جرّب تفضي مساحة.', 'err');
    return false;
  };
  /* إنشاء امتحان: بيتحفظ بالاسم اللي كتبته وبيظهر في تبويب «الامتحانات» */
  const create = nameIn => {
    if (!canStart) return false;
    const planned = planExam(qs, opts).map(q => ({ ...q, user: null, self: null }));
    const name = String(nameIn || '').trim() || defaultName;
    const ex = {
      id: uid(), subject, name, created: Date.now(), qs: planned,
      mcq: planned.filter(q => q.type === 'mcq').length, essay: planned.filter(q => q.type === 'essay').length,
      attempts: 0, last: null, best: 0,
    };
    if (!commitExams([...allExams, ex])) return false;
    setTab('exams');
    notify(`تم إنشاء «${name}»`);
    return true;
  };
  const startSaved = ex => startExam(ex.qs.map(q => ({ ...q, options: q.options.slice(), user: null, self: null })), ex.name, subject, ex.id);
  /* امتحان من الأخطاء الباقية (أخطاء آخر محاولة): نتيجته بتتسجل وبتحدّث العدد المتبقي */
  const startWrong = ex => {
    const h = histOf(ex);
    const idxs = h.length ? h[h.length - 1].wrong.map(w => w.i) : [];
    const qs2 = idxs.map(i => ex.qs[i]).filter(Boolean).map(q => ({ ...q, options: q.options.slice(), user: null, self: null }));
    if (qs2.length) startExam(qs2, ex.name + ' (الأخطاء)', subject, ex.id, { kind: 'wrong', idxs });
  };
  const renameExam = (id, name) => commitExams(allExams.map(e => (e.id === id ? { ...e, name } : e)));
  const deleteExam = id => commitExams(allExams.filter(e => e.id !== id));

  const TABS = [
    { k: 'add', t: 'إضافة ملف', icon: 'plus' },
    { k: 'library', t: 'الدروس', icon: 'list', n: stats.pages + stats.legacy },
    { k: 'exam', t: 'إنشاء امتحان', icon: 'play', n: picked.length || null },
    { k: 'exams', t: 'الامتحانات', icon: 'exams', n: exams.length },
    { k: 'results', t: 'نتائجي', icon: 'results' },
  ];
  /* المستخدم بيشوف الصفحات المسموحله بس (المالك بيحدد ده) */
  const allowed = TABS.filter(t => can.tab(t.k));
  const tab = allowed.some(t => t.k === tab0) ? tab0 : (allowed[0] && allowed[0].k) || '';
  const onTabKey = e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const i = allowed.findIndex(t => t.k === tab);
    const next = allowed[(i + (e.key === 'ArrowLeft' ? 1 : allowed.length - 1)) % allowed.length];
    setTab(next.k);
    setTimeout(() => document.getElementById('tab-' + next.k)?.focus(), 0);
  };

  return (
    <main className="container subject-page" style={{ '--accent': meta.accent }}>
      <Breadcrumb items={[{ label: 'المواد', href: '#/' }, { label: meta.label }]} />
      <header className="subject-head">
        <span className="badge lg"><SubjectIcon meta={meta} size={34} /></span>
        <div>
          <h1>{meta.label}</h1>
          <p className="muted">{mine.length ? `${[stats.pages ? stats.pages + ' صفحة' : '', stats.lessons ? stats.lessons + ' درس' : '', stats.legacy ? stats.legacy + ' ملف بدون صفحات' : ''].filter(Boolean).join(' · ')} · ${stats.q} سؤال` : 'لسه مفيش دروس في المادة دي'}</p>
        </div>
      </header>

      <div className="tabs main-tabs" role="tablist" aria-label="أقسام المادة" onKeyDown={onTabKey}>
        {allowed.map(t => (
          <button key={t.k} id={'tab-' + t.k} role="tab" aria-selected={tab === t.k} aria-controls={'panel-' + t.k}
            tabIndex={tab === t.k ? 0 : -1} className={cx('tab', tab === t.k && 'on')} onClick={() => setTab(t.k)}>
            <Icon name={t.icon} size={18} /> {t.t}
            {t.n != null && <span className="count">{t.n}</span>}
          </button>
        ))}
      </div>

      {/* كل التبويبات متفتحة في الخلفية عشان اللي كتبته ما يضيعش لما تنتقل بينهم */}
      {allowed.length === 0 && <div className="card"><p>مفيش صفحات مسموحلك بيها في المادة دي. كلّم المالك.</p></div>}
      {can.tab('add') && <div className="tabpanel" id="panel-add" role="tabpanel" aria-labelledby="tab-add" hidden={tab !== 'add'}>
        <AddFile subject={subject} meta={meta} lib={lib} commit={commit}
          onSaved={r => {
            setSelIds(p => [...p, ...r.pick]);
            setTab('library');
 
            notify(r.msg);
          }} />
      </div>}
      {can.tab('library') && <div className="tabpanel" id="panel-library" role="tabpanel" aria-labelledby="tab-library" hidden={tab !== 'library'}>
        <Library meta={meta} subject={subject} lib={lib} mine={mine} selIds={selIds} setSelIds={setSelIds} setOpts={setOpts}
 
          commit={commit} goExam={() => setTab('exam')} goAdd={() => setTab('add')} />
      </div>}
      {can.tab('exam') && <div className="tabpanel" id="panel-exam" role="tabpanel" aria-labelledby="tab-exam" hidden={tab !== 'exam'}>
        <Setup sel={sel} isAll={!picked.length} qs={qs} opts={opts} setOpts={setOpts} plan={plan} total={total}
          rangeErr={rangeErr} canStart={canStart} onCreate={create} goAdd={() => setTab('add')}
 
          defaultName={defaultName} />
      </div>}
      {can.tab('exams') && <div className="tabpanel" id="panel-exams" role="tabpanel" aria-labelledby="tab-exams" hidden={tab !== 'exams'}>
        <ExamsList exams={exams} onStart={startSaved} onStartWrong={startWrong} onRename={renameExam} onDelete={deleteExam} goCreate={() => setTab('exam')} />
      </div>}

      {can.tab('results') && <div className="tabpanel" id="panel-results" role="tabpanel" aria-labelledby="tab-results" hidden={tab !== 'results'}>
        <ResultsTab subject={subject} exams={exams} active={tab === 'results'} />
      </div>}

      {tab === 'library' && can.tab('exam') && picked.length > 0 && (
        <div className="startbar">
          <div className="sb-text"><b>{picked.length}</b> محدد · {qs.length} سؤال</div>
          <button className="btn primary" onClick={() => setTab('exam')}>إنشاء امتحان <Icon name="back" size={16} className="flip" /></button>
        </div>
      )}
    </main>
  );
}

/* ---------- إضافة ملف جديد ---------- */
function AddFile({ subject, meta, lib, commit, onSaved }) {
  const [qText, setQ] = useState('');
  const [aText, setA] = useState('');
  const [lessons, setLessons] = useState([]);
  const [ask, setAsk] = useState(false);
  const notify = useToast();

  const parsed = useMemo(() => (qText.trim() ? build(qText, aText) : null), [qText, aText]);
  const diag = useMemo(() => (parsed ? diagnose(parsed, aText) : null), [parsed, aText]);
  const count = lib.filter(s => subjOf(s) === subject && !s.bank).length;
  const bank = getBank(lib, subject);

  const readFiles = async (e, set) => {
    const files = [...e.target.files].sort((x, y) => x.name.localeCompare(y.name, 'ar', { numeric: true }));
    e.target.value = '';
    if (!files.length) return;
    const texts = await Promise.all(files.map(f => f.text()));
    set(files.length > 1
      ? files.map((f, i) => '=====\n' + f.name.replace(/\.[^.]+$/, '') + '\n=====\n' + texts[i]).join('\n')
      : texts[0]);
  };

  /* الدروس: اسم + من صفحة + إلى صفحة. الصف الفاضي بيتتجاهل */
  const paged = !!parsed && hasPages(parsed.qs);
  const pgs = paged ? parsed.qs.map(q => +q.page).filter(Boolean) : [];
  /* الصفحات المتاحة للدروس: صفحات الملف الحالي + صفحات البنك الموجودة */
  const allPgs = [...pgs, ...(bank ? bank.qs.map(q => +q.page).filter(Boolean) : [])];
  const minP = allPgs.length ? Math.min(...allPgs) : '';
  const maxP = allPgs.length ? Math.max(...allPgs) : '';
  const setL = (k, patch) => setLessons(p => p.map(l => (l.k === k ? { ...l, ...patch } : l)));
  /* ممنوع رقم أكبر من آخر صفحة موجودة (والأقل من أول صفحة بيتصلّح لما تسيب الخانة) */
  const numIn = v => (v === '' ? '' : Math.min(maxP || 99999, Math.max(1, parseInt(v, 10) || 1)));
  const fixMin = (k, f) => () => { const l = lessons.find(x => x.k === k); if (l && l[f] !== '' && minP !== '' && +l[f] < minP) setL(k, { [f]: minP }); };
  const lessonQs = l => (parsed ? parsed.qs.filter(q => inLesson(q, { from: +l.from, to: +(l.to || l.from) })).length : 0);
  const inBank = l => !!bank && bank.qs.some(q => inLesson(q, l));

  /* بيرجّع الدروس الصالحة، أو رسالة خطأ */
  const checkLessons = () => {
    const out = [];
    for (const l of lessons) {
      const nm = l.name.trim();
      if (!nm && !l.from && !l.to) continue;
      if (!nm) return { err: 'اكتب اسم الدرس.' };
      if (!l.from) return { err: `حدد صفحة البداية لدرس «${nm}».` };
      const from = +l.from;
      const to = +(l.to || l.from);
      if (from > to) return { err: `صفحة البداية أكبر من النهاية في درس «${nm}».` };
      if (minP !== '' && (from < minP || to > maxP)) return { err: `صفحات درس «${nm}» لازم تكون من ${minP} إلى ${maxP} (الصفحات الموجودة بس).` };
      if (!lessonQs({ from, to }) && !inBank({ from, to })) return { err: `مفيش أسئلة في صفحات درس «${nm}» (من ${from} إلى ${to}).` };
      out.push({ id: uid(), name: nm, from, to });
    }
    return { lessons: out };
  };

  const doSave = ls => {
    const r = addToLibrary(lib, subject, parsed.qs, ls, `${meta.label} ${count + 1}`);
    setAsk(false);
    if (!r.added && !ls.length) { notify(r.dup ? `كل الأسئلة (${r.dup}) موجودة قبل كده في نفس الصفحات.` : 'مفيش حاجة اتضافت.', 'err'); return; }
    if (!commit(r.lib)) return;
    const parts = [];
    if (r.added) parts.push(`اتضاف ${r.added} سؤال`);
    if (r.dup) parts.push(`اتخطّى ${r.dup} سؤال مكرر`);
    if (ls.length) parts.push(`${ls.length} ${ls.length === 1 ? 'درس' : 'دروس'}`);
    onSaved({ msg: parts.join(' · '), pick: ls.length ? ls.map(l => l.id) : (r.legacy ? [r.legacy.id] : []) });
    setQ(''); setA(''); setLessons([]);
  };
  const clickSave = () => {
    if (!parsed || !parsed.qs.length) { notify('الصق الأسئلة أو اختار ملف الأول.', 'err'); return; }
    const c = checkLessons();
    if (c.err) { notify(c.err, 'err'); return; }
    if (diag.level !== 'ok') setAsk(true); else doSave(c.lessons);
  };
  const sample = () => { setQ(SAMPLE_Q); setA(SAMPLE_A); };

  return (
    <section className="card" aria-labelledby="add-h">
      <div className="card-head">
        <h2 id="add-h"><Icon name="plus" size={20} /> إضافة ملف جديد</h2>
        <button className="btn ghost sm" onClick={sample}>جرّب بأسئلة تجريبية</button>
      </div>

      <div className="grid2">
        <div className="field">
          <label htmlFor="qText">ملف الأسئلة</label>
          <textarea id="qText" value={qText} onChange={e => setQ(e.target.value)} placeholder="الصق الأسئلة هنا أو اختار ملف" />
          <label className="btn ghost sm filebtn"><Icon name="upload" size={16} /> اختيار ملف أو أكتر (txt)
            <input type="file" accept=".txt,.md,text/plain" multiple onChange={e => readFiles(e, setQ)} />
          </label>
        </div>
        <div className="field">
          <label htmlFor="aText">ملف الإجابات</label>
          <textarea id="aText" value={aText} onChange={e => setA(e.target.value)} placeholder="الصق الإجابات هنا أو اختار ملف" />
          <label className="btn ghost sm filebtn"><Icon name="upload" size={16} /> اختيار ملف أو أكتر (txt)
            <input type="file" accept=".txt,.md,text/plain" multiple onChange={e => readFiles(e, setA)} />
          </label>
        </div>
      </div>

      {diag && (
        <div className={cx('diag', diag.level)} role="status">
          <div className="chips">
            <span className="chip"><b>{diag.nQ}</b> سؤال</span>
            {diag.nQ > 0 && <span className="chip"><b>{diag.mc}</b> اختياري</span>}
            {diag.nQ > 0 && <span className="chip"><b>{diag.es}</b> مقالي</span>}
            <span className="chip"><b>{diag.nA}</b> إجابة</span>
          </div>
          {diag.lines.map((l, i) => <p key={i}>{l}</p>)}
          {diag.level === 'ok' && <p>الأسئلة والإجابات متطابقة وجاهزة للحفظ.</p>}
          {diag.pages && (
            <div className="pindex">
              <b>فهرس الصفحات ({diag.pages.length})</b>
              <div className="plist">
                {diag.pages.map(g => (
                  <span key={g.key} className="pchip"><b>{pageLabel(g)}</b> {g.mcq} اختياري · {g.essay} مقالي</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {paged && (
        <fieldset className="fs lessons-box">
          <legend>سمّي الدروس <span className="muted small">(اختياري{minP !== '' ? `، الصفحات من ${minP} إلى ${maxP}` : ''})</span></legend>
          <p className="muted small">حدد من صفحة وإلى صفحة (في حدود الصفحات الموجودة بس) وسمّيها باسم الدرس، وهتظهر في دروس {meta.label}. الصفحات بتترتب بالرقم، ولو الصفحة موجودة قبل كده الأسئلة الجديدة بتتضاف عليها (والسؤال المتطابق مابيتكررش).</p>
          {lessons.map(l => {
            const n = l.from ? lessonQs(l) : null;
            return (
              <div className="lesson-row" key={l.k}>
                <input type="text" value={l.name} onChange={e => setL(l.k, { name: e.target.value })} placeholder="اسم الدرس" aria-label="اسم الدرس" />
                <input type="number" min="1" inputMode="numeric" value={l.from} max={maxP || undefined} onChange={e => setL(l.k, { from: numIn(e.target.value) })} onBlur={fixMin(l.k, 'from')} placeholder={'من ' + minP} aria-label="من صفحة" />
                <input type="number" min="1" inputMode="numeric" value={l.to} max={maxP || undefined} onChange={e => setL(l.k, { to: numIn(e.target.value) })} onBlur={fixMin(l.k, 'to')} placeholder={'إلى ' + (l.from || maxP)} aria-label="إلى صفحة" />
                <button className="icon-btn danger" onClick={() => setLessons(p => p.filter(x => x.k !== l.k))} aria-label="حذف الدرس"><Icon name="trash" size={18} /></button>
                {n != null && <span className="lesson-n muted small">{n} سؤال</span>}
              </div>
            );
          })}
          <button className="btn ghost sm" onClick={() => setLessons(p => [...p, { k: uid(), name: '', from: '', to: '' }])}><Icon name="plus" size={16} /> إضافة درس</button>
        </fieldset>
      )}

      <div className="save-row">
        <button className="btn primary lg" onClick={clickSave} disabled={!parsed || !parsed.qs.length}>
          <Icon name="check" size={18} /> حفظ في {meta.label}
        </button>
      </div>

      <details className="help">
        <summary>الصيغة المطلوبة للملفين وبرومبت NotebookLM</summary>
        <p>الأرقام لازم تكون متسلسلة 1، 2، 3... في الملفين، ونفس الرقم = نفس السؤال. السؤال اللي تحته اختيارات (أ ب ج د) بيتحسب اختياري، واللي من غير اختيارات بيتحسب مقالي. لو رفعت أكتر من ملف، كل ملف بيبدأ ترقيمه من 1 واختار ملفات الأسئلة والإجابات بنفس الترتيب.</p>
        <div className="grid2">
          <div><b>مثال لملف الأسئلة</b><pre className="fmt">{SAMPLE_Q}</pre></div>
          <div><b>مثال لملف الإجابات</b><pre className="fmt">{SAMPLE_A}</pre></div>
        </div>
        <b>برومبت تكتبه في NotebookLM</b>
        <pre className="fmt">{PROMPT}</pre>
        <CopyBtn text={PROMPT} />
      </details>

      {ask && (
        <Modal title="في ملاحظات على الملف" onClose={() => setAsk(false)}
          footer={<>
            <button className="btn ghost" onClick={() => setAsk(false)} data-autofocus>ارجع وراجع</button>
            <button className="btn primary" onClick={() => doSave(checkLessons().lessons || [])}>احفظ برضه</button>
          </>}>
          <ul className="plain">{diag.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </Modal>
      )}
    </section>
  );
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => {
      navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); });
    }}>
      <Icon name={done ? 'check' : 'copy'} size={16} /> {done ? 'تم النسخ' : 'نسخ البرومبت'}
    </button>
  );
}

/* ---------- محرر سؤال (إضافة سؤال لصفحة) ---------- */
function QEditor({ page: p0, onClose, onSave }) {
  const [page, setPage] = useState(p0 || '');
  const [type, setType] = useState('mcq');
  const [text, setText] = useState('');
  const [opts, setOpts] = useState(['', '', '', '']);
  const [correct, setCorrect] = useState(null);
  const [exp, setExp] = useState('');
  const [err, setErr] = useState('');

  const setOpt = (i, v) => setOpts(o => o.map((x, k) => (k === i ? v : x)));
  const removeOpt = i => {
    setOpts(o => o.filter((_, k) => k !== i));
    setCorrect(c => (c === i ? null : c != null && c > i ? c - 1 : c));
  };

  const save = () => {
    const pg = +page;
    if (!pg) { setErr('حدد رقم الصفحة.'); return; }
    if (!text.trim()) { setErr('اكتب نص السؤال.'); return; }
    let q;
    if (type === 'mcq') {
      const kept = opts.map((o, i) => ({ o: o.trim(), i })).filter(x => x.o);
      if (kept.length < 2) { setErr('الاختياري محتاج اختيارين على الأقل.'); return; }
      const ci = kept.findIndex(x => x.i === correct);
      if (ci < 0) { setErr('حدد الإجابة الصحيحة.'); return; }
      q = { type: 'mcq', q: text.trim(), options: kept.map(x => x.o), correct: ci, exp: exp.trim(), model: '', page: String(pg), n: 0 };
    } else {
      q = { type: 'essay', q: text.trim(), options: [], correct: null, exp: '', model: exp.trim(), page: String(pg), n: 0 };
    }
    const e = onSave(q);
    if (e) setErr(e);
  };

  return (
    <Modal title="إضافة سؤال" onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>إلغاء</button>
        <button className="btn primary" onClick={save}>حفظ السؤال</button>
      </>}>
      <div className="field">
        <label htmlFor="qe-page">رقم الصفحة</label>
        <input id="qe-page" type="number" min="1" inputMode="numeric" value={page} onChange={e => setPage(e.target.value === '' ? '' : Math.max(1, parseInt(e.target.value, 10) || 1))} />
      </div>
      <div className="seg" role="radiogroup" style={{ margin: '12px 0' }}>
        {[['mcq', 'اختياري'], ['essay', 'مقالي']].map(([v, t]) => (
          <label key={v} className={cx('seg-item', type === v && 'on')}>
            <input type="radio" name="qe-type" checked={type === v} onChange={() => setType(v)} />{t}
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="qe-text">نص السؤال</label>
        <textarea id="qe-text" value={text} onChange={e => setText(e.target.value)} data-autofocus />
      </div>
      {type === 'mcq' && (
        <fieldset className="fs" style={{ marginTop: 12 }}>
          <legend>الاختيارات <span className="muted small">(علّم على الإجابة الصحيحة)</span></legend>
          {opts.map((o, i) => (
            <div className="opt-row" key={i}>
              <input type="radio" name="qe-correct" checked={correct === i} onChange={() => setCorrect(i)} aria-label={'الإجابة الصحيحة ' + LET[i]} />
              <span className="opt-letter">{LET[i]}</span>
              <input type="text" value={o} onChange={e => setOpt(i, e.target.value)} aria-label={'الاختيار ' + LET[i]} />
              {opts.length > 2 && <button className="icon-btn danger" onClick={() => removeOpt(i)} aria-label={'حذف الاختيار ' + LET[i]}><Icon name="trash" size={16} /></button>}
            </div>
          ))}
          {opts.length < 6 && <button className="btn ghost sm" onClick={() => setOpts(o => [...o, ''])}><Icon name="plus" size={16} /> اختيار تاني</button>}
        </fieldset>
      )}
      <div className="field" style={{ marginTop: 12 }}>
        <label htmlFor="qe-exp">{type === 'mcq' ? 'الشرح (اختياري)' : 'الإجابة النموذجية'}</label>
        <textarea id="qe-exp" value={exp} onChange={e => setExp(e.target.value)} />
      </div>
      {err && <p className="err-text" role="alert">{err}</p>}
    </Modal>
  );
}

/* ---------- الدروس: إجمالي الصفحات وتحتها الدروس، وفتح الصفحات لإضافة أو حذف أسئلة ---------- */
function Library({ meta, subject, lib, mine, selIds, setSelIds, setOpts, commit, goExam, goAdd }) {
  const notify = useToast();
  const { can } = useContext(AuthCtx);
  const own = can.owner || can.tab('add'); /* بيعدّل في محتواه هو؛ محتوى المالك للقراءة بس */
  const bank = mine.find(s => s.bank);
  const legacy = mine.filter(s => !s.bank);
  const [q, setQ] = useState('');
  const spec = useMemo(() => parsePageSearch(q), [q]);
  const [open, setOpen] = useState([]);
  const [del, setDel] = useState(null);
  const [delQ, setDelQ] = useState(null);
  const [editor, setEditor] = useState(null);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [ln, setLn] = useState({ name: '', from: '', to: '' });
  const [editId, setEditId] = useState(null);
  const [lerr, setLerr] = useState('');

  const isOpen = k => open.includes(k);
  const flip = k => setOpen(p => (p.includes(k) ? p.filter(x => x !== k) : [...p, k]));
  const groups = useMemo(() => (bank ? pageGroups(bank.qs) : []), [bank]);
  const hits = spec.active ? groups.filter(g => matchPage(g.page, spec)) : groups;
  const bankPages = groups.map(g => +g.page);
  const lessons = bank ? (bank.lessons || []).filter(l => !spec.active || hits.some(g => +g.page >= l.from && +g.page <= l.to)) : [];
  const showBank = !!bank && (!spec.active || hits.length > 0);
  const showLegacy = !spec.active ? legacy : [];

  const toggle = id => setSelIds(p => (p.includes(id) ? p.filter(x => x !== id) : [...p, id]));
  const visibleIds = [...(showBank ? [bank.id] : []), ...showLegacy.map(s => s.id)];
  const allSel = visibleIds.length > 0 && visibleIds.every(id => selIds.includes(id));
  const toggleAll = () => setSelIds(p => (allSel ? p.filter(id => !visibleIds.includes(id)) : [...new Set([...p, ...visibleIds])]));

  const updateBank = fn => commit(lib.map(s => (s.id === bank.id ? fn(s) : s)));

  const examOnPages = pages => {
    const want = new Set(pages.map(String));
    const lo = Math.min(...pages.map(Number));
    const hi = Math.max(...pages.map(Number));
    const off = pageGroups(combine(selEntries([bank], [bank.id]))).filter(g => g.page && +g.page >= lo && +g.page <= hi && !want.has(g.page)).map(g => g.key);
    setSelIds([bank.id]);
    setOpts(p => ({ ...p, pFrom: lo, pTo: hi, off, over: {}, perMcq: '', perEssay: '' }));
    goExam();
  };

  const saveQuestion = nq => {
    const r = addToLibrary(lib, subject, [nq], [], '');
    if (!r.added) return 'السؤال ده موجود قبل كده في نفس الصفحة.';
    if (!commit(r.lib)) return 'المتصفح مش سامح بالحفظ.';
    notify(`اتضاف السؤال في صفحة ${nq.page}`);
    setEditor(null);
    return '';
  };
  const doDeleteQ = () => {
    updateBank(b => ({ ...b, qs: sortQs(b.qs.filter((_, i) => i !== delQ)) }));
    notify('اتحذف السؤال');
    setDelQ(null);
  };
  const doDelete = () => {
    const ids = [del.id, ...(del.lessons || []).map(l => l.id)];
    if (commit(lib.filter(s => s.id !== del.id))) { setSelIds(p => p.filter(x => !ids.includes(x))); notify('اتحذف'); }
    setDel(null);
  };
  const delLesson = l => {
    if (updateBank(b => ({ ...b, lessons: (b.lessons || []).filter(y => y.id !== l.id) }))) {
      setSelIds(p => p.filter(x => x !== l.id));
      notify(`اتحذف درس «${l.name}»`);
    }
  };

  const openLesson = () => { setEditId(null); setLessonOpen(true); setLn({ name: '', from: '', to: '' }); setLerr(''); };
  const editLesson = l => { setEditId(l.id); setLessonOpen(true); setLn({ name: l.name, from: l.from, to: l.to }); setLerr(''); };
  const minB = bankPages.length ? Math.min(...bankPages) : 1;
  const maxB = bankPages.length ? Math.max(...bankPages) : 1;
  const saveLesson = () => {
    const name = ln.name.trim();
    const from = +ln.from;
    const to = +(ln.to || ln.from);
    if (!name) { setLerr('اكتب اسم الدرس.'); return; }
    if (!from) { setLerr('حدد صفحة البداية.'); return; }
    if (from > to) { setLerr('صفحة البداية أكبر من النهاية.'); return; }
    if (from < minB || to > maxB) { setLerr(`الصفحات المتاحة من ${minB} إلى ${maxB} بس.`); return; }
    if (!bank.qs.some(x => inLesson(x, { from, to }))) { setLerr('مفيش أسئلة في الصفحات دي.'); return; }
    if (editId) {
      if (updateBank(b => ({ ...b, lessons: (b.lessons || []).map(y => (y.id === editId ? { ...y, name, from, to } : y)) }))) {
        notify(`اتعدّل درس «${name}»`);
        setLessonOpen(false);
      }
      return;
    }
    const l = { id: uid(), name, from, to };
    if (updateBank(b => ({ ...b, lessons: [...(b.lessons || []), l] }))) {
      setSelIds(p => [...p, l.id]);
      notify(`اتضاف درس «${name}»`);
      setLessonOpen(false);
    }
  };
  /* ممنوع رقم أكبر من آخر صفحة موجودة */
  const numField = k => e => setLn({ ...ln, [k]: e.target.value === '' ? '' : Math.min(maxB, Math.max(1, parseInt(e.target.value, 10) || 1)) });
  const fixLn = k => () => { if (ln[k] !== '' && +ln[k] < minB) setLn(p => ({ ...p, [k]: minB })); };

  /* قايمة الصفحات (كلها أو نطاق درس) بالترتيب الرقمي */
  const renderPages = (scope, from, to) => {
    const list = hits.filter(g => from == null || (+g.page >= from && +g.page <= to));
    if (!list.length) return <p className="muted small pad">مفيش صفحات هنا.</p>;
    return (
      <div className="page-list">
        {list.map(g => {
          const k = 'p:' + scope + ':' + g.page;
          const on = isOpen(k);
          const items = on ? bank.qs.map((x, i) => ({ x, i })).filter(o => o.x.page === g.page) : [];
          return (
            <div key={g.page} className={cx('page-row', on && 'open')}>
              <button className="page-toggle" aria-expanded={on} onClick={() => flip(k)}>
                <Icon name="back" size={16} className="chev" />
                <b>صفحة {g.page}</b>
              </button>
              {on && (
                <div className="page-body">
                  <ul className="qlist">
                    {items.map(({ x, i }) => (
                      <li key={i} className={cx('qitem', x.type)}>
                        <span className={cx('qtype', x.type)}>{x.type === 'mcq' ? 'اختياري' : 'مقالي'}</span>
                        <span className="qtext">{x.q}</span>
                        {own && !x._sh && <button className="icon-btn danger" onClick={() => setDelQ(i)} aria-label="حذف السؤال"><Icon name="trash" size={16} /></button>}
                      </li>
                    ))}
                  </ul>
                  {own && <button className="btn ghost sm" onClick={() => setEditor({ page: g.page })}><Icon name="plus" size={16} /> إضافة سؤال</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const empty = mine.length === 0;
  const bc = bank ? typeCounts(bank.qs) : { mcq: 0, essay: 0 };
  const searchMsg = spec.active
    ? (hits.length || showLegacy.length
      ? `${hits.length} صفحة مطابقة ${spec.multi ? 'للأرقام دي' : 'لـ ' + spec.tokens[0].s}.`
      : 'مفيش صفحات بالأرقام دي. (الملفات اللي من غير أرقام صفحات مش بتظهر في بحث الصفحات.)')
    : 'علّم على «كل الصفحات» أو على درس عشان تعمل منه امتحان. للبحث بأكتر من رقم اكتبهم بينهم / مثلًا 1/2/4/6.';

  return (
    <section className="card" aria-labelledby="lib-h">
      <div className="card-head">
        <h2 id="lib-h"><Icon name="list" size={20} /> دروس {meta.label}</h2>
        <div className="row">
          {own && bank && <button className="btn ghost sm" onClick={() => setEditor({ page: '' })}><Icon name="plus" size={16} /> سؤال</button>}
          {visibleIds.length > 0 && <button className="btn ghost sm" onClick={toggleAll}>{allSel ? 'إلغاء التحديد' : 'تحديد الكل'}</button>}
        </div>
      </div>

      {empty ? (
        <div className="empty">
          <Icon name="file" size={34} />
          <p>مفيش دروس لسه.</p>
          {own && <button className="btn primary" onClick={goAdd}><Icon name="plus" size={16} /> ضيف أول ملف</button>}
        </div>
      ) : (
        <>
          <div className="searchbox">
            <label htmlFor="psearch" className="sr">ابحث برقم الصفحة</label>
            <input id="psearch" type="search" inputMode="text" value={q} onChange={e => setQ(e.target.value)} placeholder="ابحث برقم الصفحة: 56 أو 1/2/4/6 أو 5-8" />
            {q && <button className="btn ghost sm" onClick={() => setQ('')}>مسح</button>}
          </div>
          <p className="muted small">{searchMsg}</p>

          <ul className="files">
            {showBank && (
              <li className={cx('file', selIds.includes(bank.id) && 'on')}>
                <div className="file-row">
                  <label className="file-main">
                    <input type="checkbox" checked={selIds.includes(bank.id)} onChange={() => toggle(bank.id)} />
                    <span className="file-info">
                      <b>إجمالي الصفحات</b>
                      <span className="muted small">{groups.length} صفحة (من {Math.min(...bankPages)} إلى {Math.max(...bankPages)}) · {bank.qs.length} سؤال · {bc.mcq} اختياري · {bc.essay} مقالي</span>
                    </span>
                  </label>
                  {own && !bank.shOnly && <button className="icon-btn danger" onClick={() => setDel(bank)} aria-label="حذف كل الصفحات" title="حذف كل الصفحات"><Icon name="trash" size={18} /></button>}
                </div>

                <div className="sec-head">
                  <b>الدروس</b>
                  {own && <button className="btn ghost sm" onClick={openLesson}><Icon name="plus" size={16} /> درس جديد</button>}
                </div>
                {lessons.length === 0 ? (
                  <p className="muted small pad">{spec.active ? 'مفيش دروس فيها الصفحات دي.' : own ? 'لسه مفيش دروس. اضغط «درس جديد» وحدد من صفحة وإلى صفحة وسمّيه.' : 'لسه مفيش دروس.'}</p>
                ) : (
                  <ul className="lessons">
                    {lessons.map(l => {
                      const inL = bank.qs.filter(x => inLesson(x, l));
                      const lc = typeCounts(inL);
                      const np = new Set(inL.map(x => x.page)).size;
                      const lon = selIds.includes(bank.id) || selIds.includes(l.id);
                      const lo = isOpen('l:' + l.id);
                      return (
                        <li key={l.id} className={cx('lesson', lon && 'on')}>
                          <div className="file-row">
                            <label className="file-main">
                              <input type="checkbox" checked={lon} disabled={selIds.includes(bank.id)} onChange={() => toggle(l.id)} />
                              <span className="file-info">
                                <b>{l.name}</b>
                                <span className="muted small">{l.from === l.to ? 'صفحة ' + l.from : `من صفحة ${l.from} إلى ${l.to}`} · {np} صفحة · {inL.length} سؤال · {lc.mcq} اختياري · {lc.essay} مقالي</span>
                              </span>
                            </label>
                            <button className="icon-btn" aria-expanded={lo} onClick={() => flip('l:' + l.id)} aria-label={'فتح صفحات ' + l.name} title="فتح الصفحات"><Icon name="back" size={16} className={cx('chev', lo && 'dn')} /></button>
                            {own && !l._sh && <button className="icon-btn" onClick={() => editLesson(l)} aria-label={'تعديل درس ' + l.name} title="تعديل الاسم والصفحات"><Icon name="edit" size={18} /></button>}
                            {own && !l._sh && <button className="icon-btn danger" onClick={() => delLesson(l)} aria-label={'حذف درس ' + l.name}><Icon name="trash" size={18} /></button>}
                          </div>
                          {lo && renderPages('l' + l.id, l.from, l.to)}
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="sec-head">
                  <button className="page-toggle all" aria-expanded={spec.active || isOpen('bank')} onClick={() => flip('bank')}>
                    <Icon name="back" size={16} className="chev" /> <b>{spec.active ? 'الصفحات المطابقة' : 'كل الصفحات'}</b> <span className="muted small">({hits.length})</span>
                  </button>
                  {spec.multi && hits.length > 1 && (
                    <button className="btn ghost sm" onClick={() => examOnPages(hits.map(g => g.page))}>امتحان في الصفحات دي ({hits.length}) <Icon name="back" size={14} className="flip" /></button>
                  )}
                </div>
                {(spec.active || isOpen('bank')) && renderPages('b')}
              </li>
            )}

            {showLegacy.map(s => {
              const c = typeCounts(s.qs);
              const on = selIds.includes(s.id);
              return (
                <li key={s.id} className={cx('file', on && 'on')}>
                  <div className="file-row">
                    <label className="file-main">
                      <input type="checkbox" checked={on} onChange={() => toggle(s.id)} />
                      <span className="file-info">
                        <b>{s.name}</b>
                        <span className="muted small">ملف بدون أرقام صفحات · {s.qs.length} سؤال · {c.mcq} اختياري · {c.essay} مقالي{s.created ? ' · ' + fmtDate(s.created) : ''}</span>
                      </span>
                    </label>
                    {own && !s._sh && <button className="icon-btn danger" onClick={() => setDel(s)} aria-label={'حذف ' + s.name}><Icon name="trash" size={18} /></button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {editor && <QEditor page={editor.page} onClose={() => setEditor(null)} onSave={saveQuestion} />}

      {lessonOpen && bank && (
        <Modal title={editId ? 'تعديل الدرس' : 'درس جديد'} onClose={() => setLessonOpen(false)}
          footer={<>
            <button className="btn ghost" onClick={() => setLessonOpen(false)}>إلغاء</button>
            <button className="btn primary" onClick={saveLesson}>{editId ? 'حفظ التعديل' : 'حفظ الدرس'}</button>
          </>}>
          <div className="field">
            <label htmlFor="ln-name">اسم الدرس</label>
            <input id="ln-name" type="text" value={ln.name} onChange={e => setLn({ ...ln, name: e.target.value })} placeholder="مثال: الانقسام الميتوزي" data-autofocus />
          </div>
          <div className="grid2 tight" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="ln-from">من صفحة</label>
              <input id="ln-from" type="number" min={minB} max={maxB} inputMode="numeric" value={ln.from} placeholder={String(minB)} onChange={numField('from')} onBlur={fixLn('from')} />
            </div>
            <div className="field">
              <label htmlFor="ln-to">إلى صفحة</label>
              <input id="ln-to" type="number" min={minB} max={maxB} inputMode="numeric" value={ln.to} placeholder={String(ln.from || maxB)} onChange={numField('to')} onBlur={fixLn('to')} />
            </div>
          </div>
          <p className="muted small">الصفحات المتاحة من {minB} إلى {maxB}، ومينفعش تحدد صفحة برّه الحدود دي.</p>
          {lerr && <p className="err-text" role="alert">{lerr}</p>}
        </Modal>
      )}

      {delQ != null && bank && bank.qs[delQ] && (
        <Modal title="حذف السؤال" onClose={() => setDelQ(null)}
          footer={<>
            <button className="btn ghost" onClick={() => setDelQ(null)} data-autofocus>إلغاء</button>
            <button className="btn danger-solid" onClick={doDeleteQ}>احذف</button>
          </>}>
          <p>هتحذف السؤال ده من صفحة {bank.qs[delQ].page}:</p>
          <p className="muted">{bank.qs[delQ].q}</p>
        </Modal>
      )}

      {del && (
        <Modal title={del.bank ? 'حذف كل الصفحات' : 'حذف الملف'} onClose={() => setDel(null)}
          footer={<>
            <button className="btn ghost" onClick={() => setDel(null)} data-autofocus>إلغاء</button>
            <button className="btn danger-solid" onClick={doDelete}>احذف</button>
          </>}>
          <p>{del.bank ? `هتحذف كل الصفحات اللي ضفتها (${del.qs.filter(q => !q._sh).length} سؤال)` : `هتحذف «${del.name}» (${del.qs.length} سؤال)`}{(del.lessons || []).filter(l => !l._sh).length ? ` ومعاها ${del.lessons.filter(l => !l._sh).length} درس` : ''} نهائيًا من حسابك. محتوى المالك مش هيتأثر.</p>
        </Modal>
      )}
    </section>
  );
}

/* ---------- إعداد الامتحان ---------- */
function Setup({ sel, isAll, qs, opts, setOpts, plan, total, rangeErr, canStart, onCreate, goAdd, defaultName }) {
  const o = opts;
  const [naming, setNaming] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [pq, setPq] = useState('');
  const pspec = parsePageSearch(pq);
  const set = patch => setOpts(p => ({ ...p, ...patch }));
  const paged = plan.paged;
  const rc = { mcq: plan.avail.rangeMcq, essay: plan.avail.rangeEssay };
  const any = rc.mcq + rc.essay;

  /* لو النوع المختار مش موجود في الملفات المحددة نرجع لـ "الكل" */
  useEffect(() => {
    if (!sel.length || !any) return;
    if ((o.mode === 'mcq' && !rc.mcq) || (o.mode === 'essay' && !rc.essay)) set({ mode: 'all' });
  }, [rc.mcq, rc.essay, o.mode, sel.length]);

  if (!sel.length) {
    return (
      <div className="card setup empty-setup">
        <h2>إنشاء امتحان</h2>
        <p className="muted">لسه مفيش أسئلة في المادة دي. ضيف ملف الأول وبعدها هنا هتظبط الصفحات ونوع الأسئلة وعددها.</p>
        <button className="btn primary" onClick={goAdd}><Icon name="plus" size={16} /> ضيف ملف</button>
      </div>
    );
  }

  const MODES = [
    { v: 'all', t: 'الاتنين', off: !any },
    { v: 'mcq', t: 'اختياري', off: !rc.mcq },
    { v: 'essay', t: 'مقالي', off: !rc.essay },
  ];
  const num = k => e => { const v = e.target.value; set({ [k]: v === '' ? '' : Math.max(1, parseInt(v, 10) || 1) }); };
  const clamp = (k, max) => () => { if (o[k] !== '' && max > 0 && +o[k] > max) set({ [k]: max }); };

  const pageNums = paged ? pageGroups(qs).filter(g => g.page).map(g => +g.page) : [];
  const minP = pageNums.length ? Math.min(...pageNums) : '';
  const maxP = pageNums.length ? Math.max(...pageNums) : '';
  const pRangeErr = !!(o.pFrom && o.pTo && +o.pFrom > +o.pTo);
  const idx = paged ? pageRows(qs, o, true) : [];
  const multiSrc = new Set(idx.map(r => r.g.src)).size > 1;
  const view = pspec.active ? idx.filter(r => matchPage(r.g.page, pspec)) : idx;
  const overOf = key => (o.over || {})[key] || {};
  const setOver = (key, k, max) => e => {
    const v = e.target.value;
    const val = v === '' ? '' : Math.min(max || 9999, Math.max(1, parseInt(v, 10) || 1));
    set({ over: { ...o.over, [key]: { ...overOf(key), [k]: val } } });
  };
  const toggleOff = key => set({ off: o.off.includes(key) ? o.off.filter(x => x !== key) : [...o.off, key] });

  return (
    <div className="card setup">
      <h2>إنشاء امتحان</h2>

      <div className="source">
        <span className="muted small">المصدر ({isAll ? 'كل محتوى المادة' : `${sel.length} ${sel.every(e => e.lesson) ? 'درس' : 'اختيار'}`} · {qs.length} سؤال)</span>
        <div className="tags">{sel.map(e => <span key={e.id} className="tag">{e.name}</span>)}</div>
      </div>

      <fieldset className="fs">
        <legend>نوع الأسئلة</legend>
        <div className="seg" role="radiogroup">
          {MODES.map(m => (
            <label key={m.v} className={cx('seg-item', o.mode === m.v && 'on', m.off && 'off')}>
              <input type="radio" name="mode" value={m.v} checked={o.mode === m.v} disabled={m.off} onChange={() => set({ mode: m.v })} />
              {m.t}
            </label>
          ))}
        </div>
      </fieldset>

      {paged ? (
        <>
          <fieldset className="fs">
            <legend>نطاق الصفحات {pageNums.length > 0 && <span className="muted small">(من {minP} إلى {maxP})</span>}</legend>
            <div className="grid2 tight">
              <div className="field">
                <label htmlFor="pFrom">من صفحة</label>
                <input id="pFrom" type="number" min="1" value={o.pFrom} placeholder={String(minP)} onChange={num('pFrom')} aria-invalid={pRangeErr} />
              </div>
              <div className="field">
                <label htmlFor="pTo">إلى صفحة</label>
                <input id="pTo" type="number" min="1" value={o.pTo} placeholder={String(maxP)} onChange={num('pTo')} aria-invalid={pRangeErr} />
              </div>
            </div>
            {pRangeErr && <p className="err-text">رقم صفحة البداية أكبر من رقم النهاية.</p>}
          </fieldset>

          <fieldset className="fs">
            <legend>فهرس الصفحات <span className="muted small">({plan.rows.length} صفحة في الامتحان)</span></legend>
            <p className="muted small">علّم على الصفحات اللي عاوزها، واكتب عدد الأسئلة لأي صفحة في الجدول (سيبه فاضي لو عاوز كل أسئلتها).</p>
            <div className="searchbox sm">
              <label htmlFor="pidxq" className="sr">دوّر على صفحة في الفهرس</label>
              <input id="pidxq" type="search" inputMode="numeric" value={pq} onChange={e => setPq(e.target.value)} placeholder="دوّر على صفحة: 56 أو 1/2/4/6" />
            </div>
            {view.length ? (
              <div className="pidx-table">
                <div className="prow head"><span>الصفحة</span><span>اختياري</span><span>مقالي</span></div>
                {view.map((r, i) => (
                  <React.Fragment key={r.g.key}>
                    {multiSrc && (i === 0 || view[i - 1].g.src !== r.g.src) && <div className="pfile">{r.g.src || 'بدون اسم'}</div>}
                    <div className={cx('prow', !r.on && 'off')}>
                      <label className="pl">
                        <input type="checkbox" checked={r.on} onChange={() => toggleOff(r.g.key)} aria-label={'تضمين ' + pageLabel(r.g)} />
                        <span><b>{pageLabel(r.g)}</b><span className="muted small"> {r.g.mcq} اختياري · {r.g.essay} مقالي</span></span>
                      </label>
                      <input type="number" min="1" max={r.maxM || undefined} value={overOf(r.g.key).m ?? ''} placeholder={r.maxM ? String(r.defM) : '-'}
                        disabled={!r.on || !r.maxM} onChange={setOver(r.g.key, 'm', r.maxM)} aria-label={'عدد الاختياري من ' + pageLabel(r.g)} />
                      <input type="number" min="1" max={r.maxE || undefined} value={overOf(r.g.key).e ?? ''} placeholder={r.maxE ? String(r.defE) : '-'}
                        disabled={!r.on || !r.maxE} onChange={setOver(r.g.key, 'e', r.maxE)} aria-label={'عدد المقالي من ' + pageLabel(r.g)} />
                    </div>
                  </React.Fragment>
                ))}
              </div>
            ) : <p className="muted small">{pspec.active ? 'مفيش صفحة بالرقم ده في النطاق.' : 'مفيش صفحات في النطاق ده.'}</p>}
          </fieldset>
        </>
      ) : (
        <>
          <div className="grid2 tight">
            <div className="field">
              <label htmlFor="nMcq">عدد الاختياري <span className="muted small">من {plan.avail.mcq}</span></label>
              <input id="nMcq" type="number" min="1" max={plan.avail.mcq || undefined} value={o.nMcq} placeholder="الكل"
                disabled={!plan.avail.mcq} onChange={num('nMcq')} onBlur={clamp('nMcq', plan.avail.mcq)} />
            </div>
            <div className="field">
              <label htmlFor="nEssay">عدد المقالي <span className="muted small">من {plan.avail.essay}</span></label>
              <input id="nEssay" type="number" min="1" max={plan.avail.essay || undefined} value={o.nEssay} placeholder="الكل"
                disabled={!plan.avail.essay} onChange={num('nEssay')} onBlur={clamp('nEssay', plan.avail.essay)} />
            </div>
          </div>

          <fieldset className="fs">
            <legend>نطاق الأسئلة <span className="muted small">(اختياري، من 1 إلى {qs.length})</span></legend>
            <div className="grid2 tight">
              <div className="field">
                <label htmlFor="from">من سؤال رقم</label>
                <input id="from" type="number" min="1" max={qs.length} value={o.from} placeholder="1" onChange={num('from')} aria-invalid={rangeErr} />
              </div>
              <div className="field">
                <label htmlFor="to">إلى سؤال رقم</label>
                <input id="to" type="number" min="1" max={qs.length} value={o.to} placeholder={String(qs.length)} onChange={num('to')} aria-invalid={rangeErr} />
              </div>
            </div>
            {rangeErr && <p className="err-text">رقم البداية أكبر من رقم النهاية.</p>}
            {sel.length > 1 && <p className="muted small">الترقيم بعد جمع الملفات المحددة بالترتيب من الأقدم للأحدث.</p>}
          </fieldset>
        </>
      )}

      <label className="check"><input type="checkbox" checked={o.shuffle} onChange={e => set({ shuffle: e.target.checked })} />
        <span>ترتيب واختيار عشوائي للأسئلة <span className="muted small">(لو حددت عدد أقل من المتاح بيتسحب عشوائي)</span></span></label>
      <label className="check"><input type="checkbox" checked={o.shuffleOpts} onChange={e => set({ shuffleOpts: e.target.checked })} />
        <span>خلط ترتيب الاختيارات <span className="muted small">(لا تفعّله لو فيه اختيارات زي «جميع ما سبق»)</span></span></label>

      <div className={cx('summary', !canStart && 'bad')}>
        {canStart
          ? <><b>{total}</b> سؤال في الامتحان <span className="muted small">({plan.mcq} اختياري + {plan.essay} مقالي{paged ? ` من ${plan.rows.length} صفحة` : ''})</span></>
          : <span>{rangeErr ? 'صحّح النطاق الأول.' : 'مفيش أسئلة بالاختيارات دي، غيّر النوع أو النطاق.'}</span>}
      </div>
      <button className="btn primary lg block" disabled={!canStart} onClick={() => { setNameVal(''); setNaming(true); }}><Icon name="plus" size={18} /> إنشاء الامتحان</button>
      <p className="muted small center-note">هتكتب اسم الامتحان قبل ما يتنشأ، وبعدها بيتحفظ في تبويب «الامتحانات».</p>

      {naming && (
        <Modal title="اسم الامتحان" onClose={() => setNaming(false)}
          footer={<>
            <button className="btn ghost" onClick={() => setNaming(false)}>رجوع</button>
            <button className="btn primary" onClick={() => { if (onCreate(nameVal)) setNaming(false); }}><Icon name="check" size={16} /> إنشاء الامتحان</button>
          </>}>
          <div className="field">
            <label htmlFor="examName">اكتب اسم الامتحان</label>
            <input id="examName" type="text" maxLength={80} value={nameVal} placeholder={defaultName} data-autofocus
              onChange={e => setNameVal(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && onCreate(nameVal)) setNaming(false); }} />
            <span className="muted small">لو سبته فاضي هيتسمّى «{defaultName}».</span>
          </div>
          <p className="muted small" style={{ marginTop: 12 }}>{total} سؤال ({plan.mcq} اختياري + {plan.essay} مقالي)</p>
        </Modal>
      )}
    </div>
  );
}

/* ---------- نتائجي: نتايج الامتحانات (والمالك يقدر يشوف نتايج أي مستخدم) ---------- */
/* subject = null معناها كل المواد (صفحة نتائجي الرئيسية) */
function ResultsTab({ subject, exams, active }) {
  const { can } = useContext(AuthCtx);
  const notify = useToast();
  const [who, setWho] = useState('me');
  const [users, setUsers] = useState(null);
  const [other, setOther] = useState(null);
  const [review, setReview] = useState(null);

  useEffect(() => {
    if (!can.owner || !active || users) return;
    cloud.listAccounts().then(l => setUsers(l.filter(a => a.role !== 'owner'))).catch(e => { setUsers([]); notify(cloud.friendlyError(e), 'err'); });
  }, [can.owner, active, users, notify]);

  useEffect(() => {
    if (who === 'me') { setOther(null); return undefined; }
    let live = true;
    setOther({ loading: true, items: [] });
    cloud.getUserView(who).then(v => {
      if (!live) return;
      const base = exams.filter(e => !e._sh).map(e => ({ ...e, history: undefined, last: null, best: 0, attempts: 0 }));
      const ids = new Set(base.map(e => e.id));
      const items = [...base, ...v.exams.filter(e => !ids.has(e.id) && (!subject || e.subject === subject))]
        .map(e => (v.results[e.id] ? { ...e, ...v.results[e.id] } : e))
        .sort((a, b) => (b.created || 0) - (a.created || 0));
      setOther({ loading: false, items });
    }).catch(e => { if (live) { setOther({ loading: false, items: [] }); notify(cloud.friendlyError(e), 'err'); } });
    return () => { live = false; };
  }, [who, subject]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewing = who === 'me' ? null : (users || []).find(u => u.uid === who);
  const items = who === 'me' ? exams : (other ? other.items : []);
  const solved = items.filter(e => histOf(e).length);
  const lastOf = e => { const h = histOf(e); return h[h.length - 1]; };
  const avg = solved.length ? Math.round(solved.reduce((t, e) => t + (lastOf(e).pct || 0), 0) / solved.length) : 0;
  const best = solved.reduce((m, e) => Math.max(m, ...histOf(e).filter(h => h.kind === 'full').map(h => h.pct), 0), 0);

  return (
    <section className="exams-list" aria-labelledby="res-h">
      <div className="card-head">
        <h2 id="res-h"><Icon name="results" size={20} className="ic" /> {viewing ? 'نتايج ' + (viewing.name || viewing.identifier) : 'نتائجي'}</h2>
        {can.owner && (
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="res-who" className="sr">عرض نتايج</label>
            <select id="res-who" value={who} onChange={e => setWho(e.target.value)}>
              <option value="me">نتايجي أنا</option>
              {(users || []).map(u => <option key={u.uid} value={u.uid}>{u.name || u.identifier}</option>)}
            </select>
          </div>
        )}
      </div>

      {other && other.loading && <p className="muted">جاري التحميل...</p>}
      {!(other && other.loading) && items.length === 0 && (
        <div className="card setup empty-setup"><p className="muted">مفيش امتحانات {subject ? 'في المادة دي ' : ''}لسه.</p></div>
      )}
      {!(other && other.loading) && items.length > 0 && (
        <div className="card">
          <p><b>{solved.length}</b> امتحان اتحل من {items.length}
            {solved.length > 0 && <> · متوسط آخر النتايج <b>{avg}%</b> · أعلى نتيجة <b>{best}%</b></>}</p>
        </div>
      )}
      {!(other && other.loading) && items.map(ex => {
        const hist = histOf(ex);
        const last = hist[hist.length - 1] || {};
        return (
          <article key={ex.id} className="card exam-item">
            <div className="ei-main">
              <h3>{ex.name} {ex._sh && <span className="count">من المالك</span>}</h3>
              <div className="muted small">{!subject && subjectMeta(ex.subject) ? subjectMeta(ex.subject).label + ' · ' : ''}{ex.qs ? ex.qs.length + ' سؤال · ' : ''}{hist.length ? `${hist.length} محاولة` : 'لسه ما اتحلش'}</div>
              {hist.length > 0 && last.total > 0 && (
                <div className={cx('ei-score', last.pct >= 50 ? 'ok' : 'bad')}>
                  آخر نتيجة: <b>{last.right} / {last.total}</b> ({last.pct}%)
                  {ex.best > 0 && ex.best > last.pct && last.kind === 'full' && <span className="muted small"> · أعلى نتيجة {ex.best}%</span>}
                </div>
              )}
              {hist.length > 0 && (
                <div className="ei-hist">
                  <span className="muted small">المحاولات بالترتيب (دوس على أي محاولة تشوف أخطاءها):</span>
                  <div className="hist-list">
                    {hist.map((h, k) => (
                      <button key={h.aid} className={cx('hist-chip', h.pct >= 50 ? 'ok' : 'bad')} onClick={() => setReview({ ex, h, n: k + 1 })}>
                        <b>{k + 1}</b>{h.kind === 'wrong' ? ' · أخطاء' : ''} · {h.right}/{h.total} · {h.pct}%
                        <span className="hist-w">{h.wrong.length ? h.wrong.length + ' خطأ' : 'من غير أخطاء'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </article>
        );
      })}
      {review && <ReviewWrong ex={review.ex} h={review.h} n={review.n} onClose={() => setReview(null)} />}
    </section>
  );
}

/* صفحة نتائجي الرئيسية: نتايج كل المواد */
export function ResultsPage() {
  const { can } = useContext(AuthCtx);
  const exams = useMemo(() => loadExams().filter(e => can.subject(e.subject)).sort((a, b) => (b.created || 0) - (a.created || 0)), [can]);
  return (
    <main className="container">
      <Breadcrumb items={[{ label: 'المواد', href: '#/' }, { label: 'نتائجي' }]} />
      <ResultsTab subject={null} exams={exams} active />
    </main>
  );
}

/* ---------- الامتحانات المنشأة ---------- */
function ExamsList({ exams, onStart, onStartWrong, onRename, onDelete, goCreate }) {
  const { can } = useContext(AuthCtx);
  const canMake = can.owner || can.tab('exam');
  const [renaming, setRenaming] = useState(null);
  const [nm, setNm] = useState('');
  const [del, setDel] = useState(null);
  const [review, setReview] = useState(null);

  if (!exams.length) {
    return (
      <div className="card setup empty-setup">
        <h2>الامتحانات</h2>
        <p className="muted">{canMake ? 'لسه مفيش امتحانات في المادة دي. أنشئ امتحان وسمّيه وهيظهر هنا.' : 'لسه مفيش امتحانات في المادة دي. هتظهر هنا أول ما المالك ينشئها.'}</p>
        {canMake && <button className="btn primary" onClick={goCreate}><Icon name="plus" size={16} /> إنشاء امتحان</button>}
      </div>
    );
  }
  const submitRename = () => {
    const v = nm.trim();
    if (!v) return;
    onRename(renaming.id, v);
    setRenaming(null);
  };
  return (
    <section className="exams-list">
      <div className="card-head">
        <h2><Icon name="exams" size={20} className="ic" /> الامتحانات <span className="count">{exams.length}</span></h2>
        {canMake && <button className="btn sm" onClick={goCreate}><Icon name="plus" size={16} /> امتحان جديد</button>}
      </div>
      {exams.map(ex => {
        const hist = histOf(ex);
        const last = hist[hist.length - 1] || {};
        const left = last.wrong ? last.wrong.length : 0;
        return (
        <article key={ex.id} className="card exam-item">
          <div className="ei-main">
            <h3>{ex.name} {ex._sh && <span className="count">من المالك</span>}</h3>
            <div className="muted small">
              {ex.qs.length} سؤال ({ex.mcq} اختياري{ex.essay ? ` + ${ex.essay} مقالي` : ''}) · اتعمل {fmtDate(ex.created)}
              {hist.length ? ` · ${hist.length} محاولة (نتايجك انت بس)` : ' · لسه ما حلتهوش'}
            </div>
            {hist.length > 0 && last.total > 0 && (
              <div className={cx('ei-score', last.pct >= 50 ? 'ok' : 'bad')}>
                آخر نتيجة: <b>{last.right} / {last.total}</b> ({last.pct}%)
                {ex.best > 0 && ex.best > last.pct && last.kind === 'full' && <span className="muted small"> · أعلى نتيجة {ex.best}%</span>}
              </div>
            )}
            {hist.length > 0 && (
              <div className="ei-hist">
                <span className="muted small">النتايج بالترتيب (دوس على أي نتيجة تشوف أخطاءها):</span>
                <div className="hist-list">
                  {hist.map((h, k) => (
                    <button key={h.aid} className={cx('hist-chip', h.pct >= 50 ? 'ok' : 'bad')} onClick={() => setReview({ ex, h, n: k + 1 })}
                      aria-label={`نتيجة المحاولة ${k + 1}: ${h.right} من ${h.total}، ${h.wrong.length} خطأ`}>
                      <b>{k + 1}</b>{h.kind === 'wrong' ? ' · أخطاء' : ''} · {h.right}/{h.total} · {h.pct}%
                      <span className="hist-w">{h.wrong.length ? h.wrong.length + ' خطأ' : 'من غير أخطاء'}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="ei-actions">
            <button className="btn primary" onClick={() => onStart(ex)}>
              <Icon name={hist.length ? 'retry' : 'play'} size={16} /> {hist.length ? 'حلّه تاني' : 'ابدأ'}
            </button>
            {left > 0 && (
              <button className="btn" onClick={() => onStartWrong(ex)} title="امتحان من الأخطاء المتبقية (أخطاء آخر محاولة)">
                <Icon name="shuffle" size={16} /> الأخطاء فقط <span className="count">{left}</span>
              </button>
            )}
            {!ex._sh && <button className="icon-btn" aria-label={'تغيير اسم ' + ex.name} title="تغيير الاسم" onClick={() => { setRenaming(ex); setNm(ex.name); }}><Icon name="edit" size={18} /></button>}
            {!ex._sh && <button className="icon-btn danger" aria-label={'حذف ' + ex.name} title="حذف" onClick={() => setDel(ex)}><Icon name="trash" size={18} /></button>}
          </div>
        </article>
        );
      })}
      {review && <ReviewWrong ex={review.ex} h={review.h} n={review.n} onClose={() => setReview(null)} />}
      {renaming && (
        <Modal title="تغيير اسم الامتحان" onClose={() => setRenaming(null)}
          footer={<>
            <button className="btn ghost" onClick={() => setRenaming(null)}>إلغاء</button>
            <button className="btn primary" disabled={!nm.trim()} onClick={submitRename}>حفظ</button>
          </>}>
          <div className="field">
            <label htmlFor="renameExam">الاسم الجديد</label>
            <input id="renameExam" type="text" maxLength={80} value={nm} data-autofocus onChange={e => setNm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submitRename(); }} />
          </div>
        </Modal>
      )}
      {del && (
        <Modal title="حذف الامتحان" onClose={() => setDel(null)}
          footer={<>
            <button className="btn ghost" onClick={() => setDel(null)} data-autofocus>إلغاء</button>
            <button className="btn danger-solid" onClick={() => { onDelete(del.id); setDel(null); }}>احذف</button>
          </>}>
          <p>هتحذف «<b>{del.name}</b>» ونتايجه. الأسئلة نفسها في المادة مش هتتأثر.</p>
        </Modal>
      )}
    </section>
  );
}

/* ---------- أخطاء محاولة معيّنة وقتها ---------- */
function ReviewWrong({ ex, h, n, onClose }) {
  const items = h.wrong.map(w => ({ q: ex.qs[w.i], u: w.u, i: w.i })).filter(x => x.q);
  return (
    <Modal title={`أخطاء المحاولة ${n}${h.kind === 'wrong' ? ' (امتحان الأخطاء)' : ''}`} onClose={onClose}
      footer={<button className="btn primary" onClick={onClose} data-autofocus>تمام</button>}>
      <p className="muted small">{h.right} / {h.total} ({h.pct}%) · {fmtDate(h.at)}</p>
      {items.length === 0 ? <p>مفيش أخطاء في المحاولة دي.</p> : (
        <ol className="plain rv-list">
          {items.map(({ q, u, i }) => (
            <li key={i} className="rv-item">
              <div className="rv-q">{q.q}{q.page ? <span className="muted small"> · صفحة {q.page}</span> : null}</div>
              <div className="rv-a bad">إجابتك: {u == null ? 'ما جاوبتش' : `${LET[u]}) ${q.options[u]}`}</div>
              <div className="rv-a ok">الإجابة الصحيحة: {LET[q.correct]}) {q.options[q.correct]}</div>
              {q.exp && <div className="muted small rv-exp">الشرح: {q.exp}</div>}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
