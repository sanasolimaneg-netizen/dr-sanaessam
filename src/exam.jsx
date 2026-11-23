import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon, Modal, Breadcrumb, cx } from './ui.jsx';
import { LET } from './parser.js';
import { subjectMeta, recordResult, uid } from './store.js';

const answered = q => (q.type === 'mcq' ? q.user != null : !!(q.user && q.user.trim()));
const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const jump = i => {
  const el = document.getElementById('q-' + i);
  if (el) el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
};

/* =========================================================
   صفحة الامتحان
   ========================================================= */
const QCard = React.memo(function QCard({ q, i, onAnswer }) {
  return (
    <section className="card qcard" id={'q-' + i} aria-label={'سؤال ' + (i + 1)}>
      <div className="qhead">
        <span className="qn">{i + 1}</span>
        <div className="qtext">{q.q}</div>
        <span className="tag">{q.type === 'mcq' ? 'اختياري' : 'مقالي'}{q.page ? ' · صفحة ' + q.page : ''}</span>
      </div>
      {q.type === 'mcq'
        ? <div className="opts" role="radiogroup" aria-label={'اختيارات سؤال ' + (i + 1)}>
          {q.options.map((o, k) => (
            <label key={k} className={cx('opt', q.user === k && 'sel')}>
              <input type="radio" name={'q' + i} checked={q.user === k} onChange={() => onAnswer(i, k)} />
              <span className="l">{LET[k]}</span>
              <span className="ot">{o}</span>
            </label>
          ))}
        </div>
        : <textarea className="essay" value={q.user || ''} onChange={e => onAnswer(i, e.target.value)} placeholder="اكتب إجابتك هنا" aria-label={'إجابة سؤال ' + (i + 1)} />}
    </section>
  );
});

function NavGrid({ qs, onPick }) {
  return (
    <div className="navgrid">
      {qs.map((q, i) => (
        <button key={i} className={cx('navchip', answered(q) && 'done')} onClick={() => onPick(i)}
          aria-label={`سؤال ${i + 1}${answered(q) ? ' (متجاوب)' : ''}`}>{i + 1}</button>
      ))}
    </div>
  );
}

export function ExamPage({ exam, setExam, go }) {
  const { qs } = exam;
  const meta = subjectMeta(exam.subject);
  const n = qs.filter(answered).length;
  const left = qs.length - n;
  const [modal, setModal] = useState(null);

  const onAnswer = useCallback((i, v) => {
    setExam(e => ({ ...e, qs: e.qs.map((q, k) => (k === i ? { ...q, user: v } : q)) }));
  }, [setExam]);

  useEffect(() => {
    if (!n) return undefined;
    const h = e => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [n > 0]);

  const finish = () => (left ? setModal('finish') : go('result'));

  return (
    <div className="exam" style={{ '--accent': meta ? meta.accent : undefined }}>
      <div className="topbar">
        <div className="container tb-in">
          <div className="tb-title">
            <b>{exam.name}</b>
            <span className="muted small">{n} من {qs.length} متجاوب</span>
          </div>
          <div className="row">
            <button className="btn ghost sm only-mobile" onClick={() => setModal('nav')}><Icon name="list" size={16} /> الأسئلة</button>
            <button className="btn ghost sm" onClick={() => setModal('exit')}>خروج</button>
            <button className="btn primary sm" onClick={finish}><Icon name="check" size={16} /> إنهاء وتصحيح</button>
          </div>
        </div>
        <div className="bar" role="progressbar" aria-valuemin="0" aria-valuemax={qs.length} aria-valuenow={n}><i style={{ width: (n / qs.length * 100) + '%' }} /></div>
      </div>

      <main className="container exam-layout">
        <div className="exam-main">
          {qs.map((q, i) => <QCard key={i} q={q} i={i} onAnswer={onAnswer} />)}
          <div className="row end"><button className="btn primary lg" onClick={finish}><Icon name="check" size={18} /> إنهاء وتصحيح</button></div>
        </div>
        <aside className="exam-side">
          <div className="card">
            <h2>جدول الأسئلة</h2>
            <NavGrid qs={qs} onPick={jump} />
            <p className="muted small legend"><span className="dot done" /> متجاوب <span className="dot" /> لسه</p>
          </div>
        </aside>
      </main>

      {modal === 'nav' && (
        <Modal title="جدول الأسئلة" onClose={() => setModal(null)}>
          <NavGrid qs={qs} onPick={i => { setModal(null); setTimeout(() => jump(i), 50); }} />
        </Modal>
      )}
      {modal === 'finish' && (
        <Modal title="إنهاء الامتحان" onClose={() => setModal(null)}
          footer={<>
            <button className="btn ghost" onClick={() => setModal(null)} data-autofocus>كمّل امتحان</button>
            <button className="btn primary" onClick={() => go('result')}>أنهِ وصحّح</button>
          </>}>
          <p>فيه <b>{left}</b> سؤال من غير إجابة وهيتحسبوا غلط. تنهي برضه؟</p>
        </Modal>
      )}
      {modal === 'exit' && (
        <Modal title="الخروج من الامتحان" onClose={() => setModal(null)}
          footer={<>
            <button className="btn ghost" onClick={() => setModal(null)} data-autofocus>فضل في الامتحان</button>
            <button className="btn danger-solid" onClick={() => go('subject/' + exam.subject)}>اخرج</button>
          </>}>
          <p>لو خرجت إجاباتك هتضيع.</p>
        </Modal>
      )}
    </div>
  );
}

/* =========================================================
   صفحة النتيجة
   ========================================================= */
const isWrong = q => q.type === 'mcq' && q.correct != null && q.user !== q.correct;

function Ring({ pct }) {
  const R = 54;
  const C = 2 * Math.PI * R;
  return (
    <svg className="ring" viewBox="0 0 132 132" role="img" aria-label={`النسبة ${pct}%`}>
      <circle cx="66" cy="66" r={R} fill="none" stroke="var(--line)" strokeWidth="12" />
      <circle cx="66" cy="66" r={R} fill="none" stroke={pct >= 50 ? 'var(--ok)' : 'var(--bad)'} strokeWidth="12" strokeLinecap="round"
        strokeDasharray={C} strokeDashoffset={C * (1 - pct / 100)} transform="rotate(-90 66 66)" />
      <text x="66" y="66" textAnchor="middle" dominantBaseline="central" fontSize="30" fontWeight="800" fill="var(--ink)">{pct}%</text>
    </svg>
  );
}

const ReviewCard = React.memo(function ReviewCard({ q, i, onSelf }) {
  const head = (
    <div className="qhead">
      <span className="qn">{i + 1}</span>
      <div className="qtext">{q.q}</div>
      <span className="tag">{q.type === 'mcq' ? 'اختياري' : 'مقالي'}{q.page ? ' · صفحة ' + q.page : ''}</span>
    </div>
  );
  if (q.type === 'mcq') {
    const keyed = q.correct != null;
    const skipped = q.user == null;
    const ok = keyed && q.user === q.correct;
    return (
      <section className="card qcard">
        {head}
        <div className="opts">
          {q.options.map((o, k) => {
            const right = keyed && k === q.correct;
            const wrong = q.user === k && !ok;
            return (
              <div key={k} className={cx('opt static', right && 'right', wrong && 'wrong', !right && !wrong && q.user === k && 'sel')}>
                <span className="l">{LET[k]}</span><span className="ot">{o}</span>
                <span className="mark">{right ? (q.user === k ? 'إجابتك · صح' : 'الإجابة الصحيحة') : wrong ? 'إجابتك · غلط' : ''}</span>
              </div>
            );
          })}
        </div>
        <div className={cx('verdict', !keyed ? 'skip' : ok ? 'ok' : skipped ? 'skip' : 'bad')}>
          {!keyed ? 'مفيش إجابة صحيحة مسجلة للسؤال ده' : ok ? 'إجابة صحيحة' : skipped ? 'ما جاوبتش' : 'إجابة غلط'}
        </div>
        {q.exp && <div className="exp"><b>الشرح</b>{q.exp}</div>}
        {q.src && <div className="muted small src">من: {q.src}</div>}
      </section>
    );
  }
  return (
    <section className="card qcard">
      {head}
      <div className="exp mine"><b>إجابتك</b>{q.user && q.user.trim() ? q.user : 'ما كتبتش إجابة'}</div>
      <div className="exp model"><b>الإجابة النموذجية</b>{q.model || 'مفيش إجابة نموذجية مسجلة للسؤال ده'}</div>
      {q.user && q.user.trim()
        ? <div className="self"><span>قيّم إجابتك:</span>
          {[['ok', 'صح (1)'], ['part', 'جزئي (0.5)'], ['bad', 'غلط (0)']].map(([v, t]) => (
            <button key={v} className={cx('btn sm', q.self === v ? 'primary' : 'ghost')} aria-pressed={q.self === v} onClick={() => onSelf(i, v)}>{t}</button>
          ))}
        </div>
        : <div className="verdict bad">ما كتبتش إجابة، اتحسب غلط</div>}
      {q.src && <div className="muted small src">من: {q.src}</div>}
    </section>
  );
});

export function ResultPage({ exam, setExam, go }) {
  const { qs } = exam;
  const meta = subjectMeta(exam.subject);
  const [filter, setFilter] = useState('all');
  const keyed = qs.filter(q => q.type === 'mcq' && q.correct != null);
  const right = keyed.filter(q => q.user === q.correct).length;
  const essays = qs.filter(q => q.type === 'essay');
  /* المقالي: صح = 1، جزئي = 0.5، غلط = 0. اللي ما اتكتبتش إجابته بيتحسب غلط تلقائي، واللي لسه ما اتقيّمش بيتحسب صفر لحد ما تقيّمه */
  const essayDone = q => !!(q.user && q.user.trim());
  const essayPts = q => (!essayDone(q) ? 0 : q.self === 'ok' ? 1 : q.self === 'part' ? 0.5 : 0);
  const essayScore = essays.reduce((t, q) => t + essayPts(q), 0);
  const essayPending = essays.filter(q => essayDone(q) && q.self == null).length;
  const cnt = v => essays.filter(q => q.self === v).length;
  const totalMax = keyed.length + essays.length;
  const totalScore = right + essayScore;
  const pct = totalMax ? Math.round(totalScore / totalMax * 100) : 0;
  const num = x => (Number.isInteger(x) ? String(x) : x.toFixed(1));
  const wrongN = qs.filter(isWrong).length;
  const noKey = qs.some(q => q.type === 'mcq' && q.correct == null);
  const grade = pct >= 85 ? 'ممتاز، كمّل كده' : pct >= 65 ? 'كويس، راجع الأخطاء' : pct >= 50 ? 'مقبول، محتاج مراجعة' : 'محتاج مذاكرة أكتر، ارجع للشرح';

  const show = useMemo(() => qs.map((q, i) => ({ q, i })).filter(({ q }) =>
    filter === 'all' || (filter === 'wrong' && isWrong(q)) || (filter === 'essay' && q.type === 'essay')), [qs, filter]);

  const onSelf = useCallback((i, v) => {
    setExam(e => ({ ...e, qs: e.qs.map((q, k) => (k === i ? { ...q, self: q.self === v ? null : v } : q)) }));
  }, [setExam]);
  const reset = q => ({ ...q, user: null, self: null });

  /* بنسجل النتيجة على الامتحان المحفوظ عشان تظهر في تبويب «الامتحانات» */
  useEffect(() => {
    /* بنسجّل المحاولة (والأخطاء بأرقامها الأصلية واختيارك فيها) عشان تتحدّث «الأخطاء فقط» وتظهر في سجل النتايج */
    if (exam.id) {
      const wrong = qs.map((q, k) => (isWrong(q) ? { i: exam.idxs ? exam.idxs[k] : k, u: q.user } : null)).filter(Boolean);
      recordResult(exam.id, { aid: exam.aid, at: Date.now(), kind: exam.kind || 'full', pct, right: totalScore, total: totalMax, mcqRight: right, mcqTotal: keyed.length, essayScore, essays: essays.length, wrong });
    }
  }, [exam.id, exam.aid, pct, totalScore, totalMax, wrongN]);

  const TABS = [['all', 'كل الأسئلة', qs.length], ['wrong', 'الأخطاء', wrongN]];
  if (essays.length) TABS.push(['essay', 'المقالي', essays.length]);

  return (
    <main className="container result" style={{ '--accent': meta ? meta.accent : undefined }}>
      <Breadcrumb items={[{ label: 'المواد', href: '#/' }, { label: meta ? meta.label : 'المادة', href: '#/subject/' + exam.subject }, { label: 'النتيجة' }]} />
      <h1>النتيجة</h1>
      <p className="muted">{exam.name}</p>

      <div className="card summary-card">
        {totalMax > 0 && <Ring pct={pct} />}
        <div className="stats">
          {totalMax > 0 && <div className="grade">{grade}</div>}
          {keyed.length > 0 && <>
                        <div>درجة الاختياري: <strong>{right} / {keyed.length}</strong>{noKey && <span className="muted small"> (فيه أسئلة من غير مفتاح إجابة ومش محسوبة)</span>}</div>
          </>}
          {essays.length > 0 && <>
            <div>درجة المقالي: <strong>{num(essayScore)} / {essays.length}</strong> <span className="muted small">(صح {cnt('ok')} · جزئي {cnt('part')} · غلط {essays.filter(q => !essayDone(q) || q.self === 'bad').length})</span></div>
            {essayPending > 0 && <div className="muted small">فيه {essayPending} سؤال مقالي لسه ما قيّمتهوش، قيّمه من تبويب «المقالي» وهتتحدث الدرجة.</div>}
          </>}
          {totalMax > 0 && <div className="total">الدرجة الإجمالية: <strong>{num(totalScore)} / {totalMax}</strong> ({pct}%)</div>}
        </div>
      </div>

      <div className="row actions">
        <button className="btn primary" onClick={() => { setExam(e => ({ ...e, aid: uid(), qs: e.qs.map(reset) })); go('exam'); }}><Icon name="retry" size={16} /> إعادة الامتحان</button>
        <button className="btn" disabled={!wrongN} onClick={() => {
          setExam(e => {
            const keep = e.qs.map((q, k) => ({ q, k })).filter(x => isWrong(x.q));
            return {
              ...e, aid: uid(), name: e.name.endsWith('(الأخطاء)') ? e.name : e.name + ' (الأخطاء)', qs: keep.map(x => reset(x.q)),
              kind: 'wrong', idxs: e.id ? keep.map(x => (e.idxs ? e.idxs[x.k] : x.k)) : null,
            };
          });
          go('exam');
        }}><Icon name="shuffle" size={16} /> امتحان في الأخطاء</button>
        <a className="btn ghost" href={'#/subject/' + exam.subject}><Icon name="back" size={16} /> {exam.id ? 'رجوع للامتحانات' : 'رجوع للمادة'}</a>
      </div>

      <div className="tabs" role="tablist">
        {TABS.map(([k, t, c]) => (
          <button key={k} role="tab" aria-selected={filter === k} className={cx('tab', filter === k && 'on')} onClick={() => setFilter(k)}>{t} <span className="count">{c}</span></button>
        ))}
      </div>

      {show.length
        ? show.map(({ q, i }) => <ReviewCard key={i} q={q} i={i} onSelf={onSelf} />)
        : <div className="card empty"><p>مفيش أخطاء، ممتاز.</p></div>}
    </main>
  );
}
