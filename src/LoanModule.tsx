import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from './lib/supabase';
import { buildInstallmentDates, calculateFirstInstallmentDate, calculateLoanSchedule } from './lib/loanCalculation';

type Props = { samities: any[]; canDo: (moduleKey: string, action: 'view'|'create'|'update'|'delete') => boolean };
const money = (value: number) => '৳' + Math.round(value).toLocaleString('en-BD', { maximumFractionDigits: 0 });

export default function LoanModule({ samities, canDo }: Props) {
  const [members, setMembers] = useState<any[]>([]);
  const [loans, setLoans] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [memberId, setMemberId] = useState('');
  const [loanNo, setLoanNo] = useState('');
  const [principal, setPrincipal] = useState('10000');
  const [disbursementDate, setDisbursementDate] = useState(new Date().toISOString().slice(0,10));
  const [firstDate, setFirstDate] = useState('');
  const [firstDateMode, setFirstDateMode] = useState<'auto'|'manual'>('auto');
  const [closures, setClosures] = useState<any[]>([]);
  const [holidayRows, setHolidayRows] = useState<any[]>([]);
  const [fridayEnabled, setFridayEnabled] = useState(true);
  const [closureSamity, setClosureSamity] = useState('');
  const [closureDate, setClosureDate] = useState('');
  const [closureReason, setClosureReason] = useState('');

  const selectedMember = members.find(x => x.id === memberId);
  const selectedSamity = samities.find(x => x.id === selectedMember?.samity_id);
  const amount = Number(principal);
  const preview = useMemo(() => {
    try { return calculateLoanSchedule(amount); } catch { return []; }
  }, [amount]);
  const previewTotal = preview.reduce((sum, row) => sum + row.totalDue, 0);
  const selectedClosedDates = useMemo(() => {
    if (!selectedSamity) return [];
    const dates = closures.filter(x => x.samity_id === selectedSamity.id).map(x => x.closure_date);
    const relevant = holidayRows.filter(h => h.is_active && (
      h.scope === 'organization' ||
      (h.scope === 'branch' && h.branch_id === selectedSamity.branch_id) ||
      (h.scope === 'samity' && h.samity_id === selectedSamity.id)
    ));
    for (const h of relevant) {
      const d = new Date(h.date_from + 'T12:00:00');
      const end = new Date(h.date_to + 'T12:00:00');
      while (d <= end) {
        dates.push([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'));
        d.setDate(d.getDate()+1);
      }
    }
    if (fridayEnabled) {
      const start = new Date(disbursementDate + 'T12:00:00');
      const end = new Date(start); end.setDate(end.getDate()+14+46*7+7);
      for (const d = new Date(start); d <= end; d.setDate(d.getDate()+1)) if (d.getDay()===5) dates.push([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'));
    }
    return [...new Set(dates)];
  }, [selectedSamity, closures, holidayRows, fridayEnabled, disbursementDate]);

  useEffect(() => {
    if (!selectedSamity || !disbursementDate || firstDateMode !== 'auto') { if (!selectedSamity) setFirstDate(''); return; }
    try { setFirstDate(calculateFirstInstallmentDate(disbursementDate, Number(selectedSamity.meeting_day), selectedClosedDates)); }
    catch { setFirstDate(''); }
  }, [selectedSamity, disbursementDate, selectedClosedDates, firstDateMode]);


  async function load() {
    if (!supabase) return;
    setLoading(true);
    const [memberResult, loanResult, closureResult, holidayResult, holidaySettingResult] = await Promise.all([
      supabase.from('members').select('id,member_code,full_name,samity_id,branch_id,is_active').eq('is_active', true).order('member_code'),
      supabase.from('loan_accounts').select('id,loan_no,member_id,principal,total_service_charge,total_repayable,disbursement_date,first_installment_date,schedule_status,status').order('created_at', {ascending:false}),
      supabase.from('samity_week_closures').select('*').order('closure_date', {ascending:false}),
      supabase.from('holiday_calendar').select('*').eq('is_active',true),
      supabase.from('holiday_calendar_settings').select('friday_holiday_enabled').eq('id',1).maybeSingle(),
    ]);
    if (memberResult.error) setNotice('সদস্য তালিকা পড়া যায়নি। আগে Supabase SQL সেটআপ সম্পন্ন করুন: ' + memberResult.error.message);
    else setMembers(memberResult.data || []);
    if (loanResult.error) setNotice('ঋণ তালিকা পড়া যায়নি: ' + loanResult.error.message);
    else setLoans(loanResult.data || []);
    if (!closureResult.error) setClosures(closureResult.data || []);
    if (!holidayResult.error) setHolidayRows(holidayResult.data || []);
    if (!holidaySettingResult.error && holidaySettingResult.data) setFridayEnabled(Boolean(holidaySettingResult.data.friday_holiday_enabled));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function createLoan(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !canDo('loans','create')) return;
    setNotice('');
    if (!selectedMember || !selectedSamity) { setNotice('সদস্য নির্বাচন করুন।'); return; }
    if (!loanNo.trim()) { setNotice('ঋণ নম্বর লিখুন।'); return; }
    if (!preview.length) { setNotice('ঋণের পরিমাণ ১,০০০–২,০০,০০০ টাকার মধ্যে ১,০০০ টাকার গুণিতক হতে হবে।'); return; }
    if (!firstDate) { setNotice('প্রথম কিস্তির তারিখ নির্বাচন করুন।'); return; }
    if (Number(selectedSamity.meeting_day) === 5) { setNotice('শুক্রবার কোনো সমিতির সভার দিন হতে পারবে না। সমিতির সভার দিন সংশোধন করুন।'); return; }
    const disb = new Date(disbursementDate + 'T12:00:00'); disb.setDate(disb.getDate()+14);
    if (new Date(firstDate + 'T12:00:00') < disb) { setNotice('প্রথম কিস্তি ঋণ বিতরণের কমপক্ষে ১৪ দিন পরে হতে হবে।'); return; }
    if (new Date(firstDate + 'T12:00:00').getDay() !== Number(selectedSamity.meeting_day)) { setNotice('ম্যানুয়ালি দেওয়া প্রথম কিস্তির তারিখ সমিতির নির্ধারিত সভার দিনের সঙ্গে মিলতে হবে।'); return; }
    if (selectedClosedDates.includes(firstDate)) { setNotice('নির্বাচিত প্রথম কিস্তির দিনটি বন্ধ। একই বার পরবর্তী সপ্তাহ নির্বাচন করুন।'); return; }
    const closedDates = selectedClosedDates;
    let dates: string[];
    try { dates = buildInstallmentDates(firstDate, Number(selectedSamity.meeting_day), closedDates); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'কিস্তির তারিখ সঠিক নয়।'); return; }

    setLoading(true);
    const { data: authData } = await supabase.auth.getUser();
    const serviceTotal = preview.reduce((sum, row) => sum + row.serviceChargeDue, 0);
    const repayTotal = preview.reduce((sum, row) => sum + row.totalDue, 0);
    const inserted = await supabase.from('loan_accounts').insert({
      loan_no: loanNo.trim(),
      member_id: memberId,
      principal: amount,
      interest_rate: 0,
      term_weeks: 46,
      service_charge_rate: 0.24,
      total_service_charge: serviceTotal,
      total_repayable: repayTotal,
      disbursement_date: disbursementDate,
      first_installment_date: firstDate,
      schedule_status: 'pending',
      status: 'active',
      created_by: authData.user?.id,
    }).select('id').single();
    if (inserted.error) {
      setNotice('ঋণ সংরক্ষণ হয়নি: ' + inserted.error.message);
      setLoading(false);
      return;
    }
    const scheduleRows = preview.map((row, index) => ({
      loan_id: inserted.data.id,
      week_no: row.weekNo,
      due_date: dates[index],
      opening_principal: row.openingPrincipal,
      principal_due: row.principalDue,
      service_charge_due: row.serviceChargeDue,
      total_due: row.totalDue,
    }));
    const scheduleResult = await supabase.from('loan_installment_schedule').insert(scheduleRows);
    if (scheduleResult.error) {
      setNotice('ঋণ রেকর্ড হয়েছে, কিন্তু কিস্তির তালিকা তৈরি হয়নি। Main Admin-কে SQL Permission পরীক্ষা করতে হবে: ' + scheduleResult.error.message);
      setLoading(false);
      await load();
      return;
    }
    const updated = await supabase.from('loan_accounts').update({schedule_status:'generated'}).eq('id', inserted.data.id);
    if (updated.error) setNotice('কিস্তি তৈরি হয়েছে; তবে Schedule Status আপডেট হয়নি: ' + updated.error.message);
    else setNotice('ঋণ বিতরণ ও ৪৬ সপ্তাহের কিস্তির তালিকা তৈরি হয়েছে।');
    setLoanNo('');
    setLoading(false);
    await load();
  }

  async function addClosure(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !canDo('loans','create')) return;
    const { data: authData } = await supabase.auth.getUser();
    const result = await supabase.from('samity_week_closures').insert({
      samity_id: closureSamity, closure_date: closureDate, reason: closureReason.trim(), created_by: authData.user?.id,
    });
    if (result.error) setNotice('বন্ধের দিন সংরক্ষণ হয়নি: ' + result.error.message);
    else {
      setNotice('সমিতির বন্ধের দিন সংরক্ষিত হয়েছে। বিদ্যমান ঋণের বকেয়া কিস্তির তারিখও স্বয়ংক্রিয়ভাবে পুনর্নির্ধারণ করা হয়েছে; আদায়ের রেকর্ড অপরিবর্তিত আছে।');
      setClosureReason('');
      await load();
    }
  }

  return <section className="workspace">
    <div className="section-head"><div><p className="eyebrow">LOAN MANAGEMENT</p><h2>ঋণ বিতরণ ও কিস্তি ব্যবস্থাপনা</h2><p>Book1.xlsx-এর ১,০০০ টাকার মূল হিসাব অনুযায়ী ১,০০০–২,০০,০০০ টাকা পর্যন্ত ৪৬ সপ্তাহের কিস্তি তৈরি হবে।</p></div></div>
    {notice && <div className="notice">{notice}</div>}
    {canDo('loans','create') && <form className="employee-form" onSubmit={createLoan}>
      <h3>নতুন ঋণ বিতরণ</h3>
      <div className="form-grid">
        <label>সদস্য নির্বাচন *<select required value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="">সদস্য নির্বাচন</option>{members.map(m=><option key={m.id} value={m.id}>{m.member_code} — {m.full_name}</option>)}</select></label>
        <label>সমিতি<input readOnly value={selectedSamity ? selectedSamity.samity_code+' — '+selectedSamity.samity_name : ''}/></label>
        <label>ঋণ নম্বর *<input required value={loanNo} onChange={e=>setLoanNo(e.target.value)} placeholder="যেমন LN-0001"/></label>
        <label>ঋণের পরিমাণ (৳) *<input required type="number" min="1000" max="200000" step="1000" value={principal} onChange={e=>setPrincipal(e.target.value)}/></label>
        <label>ঋণ বিতরণের তারিখ *<input required type="date" value={disbursementDate} onChange={e=>setDisbursementDate(e.target.value)}/></label>
        <label>প্রথম কিস্তির তারিখের পদ্ধতি *<select value={firstDateMode} onChange={e=>setFirstDateMode(e.target.value as 'auto'|'manual')}><option value="auto">স্বয়ংক্রিয় (বিতরণের ১৪ দিন পর)</option><option value="manual">ম্যানুয়ালি নির্বাচন</option></select></label>
        <label>প্রথম কিস্তির তারিখ *<input required type="date" value={firstDate} readOnly={firstDateMode==='auto'} onChange={e=>setFirstDate(e.target.value)}/></label>
      </div>
      {preview.length>0 && <div className="panel">
        <h3>ঋণের হিসাবের প্রিভিউ</h3>
        <div className="stats-grid">
          <div><span>আসল</span><strong>{money(amount)}</strong></div>
          <div><span>সার্ভিস চার্জ (Excel সূত্র)</span><strong>{money(preview.reduce((s,x)=>s+x.serviceChargeDue,0))}</strong></div>
          <div><span>মোট আদায়যোগ্য</span><strong>{money(previewTotal)}</strong></div>
          <div><span>কিস্তি</span><strong>৪৬ সপ্তাহ</strong></div>
        </div>
        <div className="table-wrap"><table><thead><tr><th>সপ্তাহ</th><th>আসলের শুরু</th><th>আসল কিস্তি</th><th>সার্ভিস চার্জ</th><th>মোট কিস্তি</th></tr></thead><tbody>{preview.map(row=><tr key={row.weekNo}><td>{row.weekNo}</td><td>{row.openingPrincipal.toFixed(2)}</td><td>{row.principalDue.toFixed(2)}</td><td>{row.serviceChargeDue.toFixed(2)}</td><td>{row.totalDue.toFixed(2)}</td></tr>)}</tbody></table></div>
      </div>}
      <div className="form-actions"><button disabled={loading || !canDo('loans','create')}>{loading?'সংরক্ষণ হচ্ছে...':'ঋণ সংরক্ষণ ও কিস্তি তৈরি'}</button></div>
    </form>}
    <section className="panel">
      <h3>সমিতির বন্ধের দিন</h3>
      <p className="muted">যে সপ্তাহে সমিতির সভা বন্ধ থাকবে, সেই তারিখ এখানে যোগ করুন। কিস্তির ৪৬ সপ্তাহে বন্ধের দিন গণনা হবে না।</p>
      {canDo('loans','create') && <form className="form-grid" onSubmit={addClosure}>
        <label>সমিতি *<select required value={closureSamity} onChange={e=>setClosureSamity(e.target.value)}><option value="">সমিতি নির্বাচন</option>{samities.map(s=><option key={s.id} value={s.id}>{s.samity_code} — {s.samity_name}</option>)}</select></label>
        <label>বন্ধের তারিখ *<input required type="date" value={closureDate} onChange={e=>setClosureDate(e.target.value)}/></label>
        <label>কারণ *<input required value={closureReason} onChange={e=>setClosureReason(e.target.value)}/></label>
        <div className="form-actions"><button disabled={loading}>বন্ধের দিন সংরক্ষণ</button></div>
      </form>}
      <div className="table-wrap"><table><thead><tr><th>সমিতি</th><th>বন্ধের তারিখ</th><th>কারণ</th></tr></thead><tbody>{closures.map(x=><tr key={x.id}><td>{samities.find(s=>s.id===x.samity_id)?.samity_name||'—'}</td><td>{x.closure_date}</td><td>{x.reason}</td></tr>)}{!closures.length&&<tr><td colSpan={3} className="empty">কোনো বন্ধের দিন যুক্ত হয়নি।</td></tr>}</tbody></table></div>
    </section>
    <section className="panel">
      <h3>বিতরণকৃত ঋণ</h3>
      <div className="table-wrap"><table><thead><tr><th>ঋণ নম্বর</th><th>সদস্য</th><th>ঋণ</th><th>সার্ভিস চার্জ</th><th>মোট আদায়</th><th>বিতরণের তারিখ</th><th>কিস্তি</th></tr></thead><tbody>{loans.map(loan=>{const m=members.find(x=>x.id===loan.member_id);return <tr key={loan.id}><td>{loan.loan_no}</td><td>{m?.member_code||'—'} — {m?.full_name||'—'}</td><td>{money(Number(loan.principal))}</td><td>{money(Number(loan.total_service_charge||0))}</td><td>{money(Number(loan.total_repayable||0))}</td><td>{loan.disbursement_date}</td><td>{loan.schedule_status==='generated'?'৪৬ সপ্তাহ তৈরি':'অপেক্ষমাণ'}</td></tr>})}{!loans.length&&<tr><td colSpan={7} className="empty">এখনও কোনো ঋণ বিতরণ রেকর্ড নেই।</td></tr>}</tbody></table></div>
    </section>
  </section>;
}
