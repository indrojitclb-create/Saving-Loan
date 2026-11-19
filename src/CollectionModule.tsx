import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';

type Props = { samities: any[]; canDo: (moduleKey: string, action: 'view'|'create'|'update'|'delete') => boolean };
const money = (v:number) => '৳'+Math.round(v||0).toLocaleString('en-BD');
const dateText = (d:Date) => [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');

export default function CollectionModule({samities,canDo}:Props) {
  const today = new Date();
  const [samityId,setSamityId]=useState('');
  const [month,setMonth]=useState(dateText(new Date(today.getFullYear(),today.getMonth(),1)).slice(0,7));
  const [members,setMembers]=useState<any[]>([]);
  const [savings,setSavings]=useState<any[]>([]);
  const [loans,setLoans]=useState<any[]>([]);
  const [loanTx,setLoanTx]=useState<any[]>([]);
  const [loanSchedule,setLoanSchedule]=useState<any[]>([]);
  const [closures,setClosures]=useState<any[]>([]);
  const [holidayRows,setHolidayRows]=useState<any[]>([]);
  const [fridayEnabled,setFridayEnabled]=useState(true);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const selectedSamity=samities.find(s=>s.id===samityId);

  const meetingDates=useMemo(()=>{
    if(!selectedSamity||!month)return [];
    const [year,mon]=month.split('-').map(Number);
    const day=Number(selectedSamity.meeting_day);
    if(!Number.isInteger(day)||day<0||day>6)return [];
    const result:string[]=[];
    const date=new Date(year,mon-1,1,12);
    while(date.getMonth()===mon-1){
      if(date.getDay()===day){
        const value=dateText(date);
        const centralClosed = holidayRows.some(h =>
          h.is_active && value>=h.date_from && value<=h.date_to &&
          (h.scope==='organization' ||
            (h.scope==='branch' && h.branch_id===selectedSamity.branch_id) ||
            (h.scope==='samity' && h.samity_id===selectedSamity.id))
        );
        const fridayClosed = fridayEnabled && day===5;
        if(!closures.some(x=>x.closure_date===value) && !centralClosed && !fridayClosed)result.push(value);
      }
      date.setDate(date.getDate()+1);
    }
    const scheduledDates = loanSchedule.map(x=>x.due_date).filter(d=>d>=month+'-01' && d<=dateText(new Date(year,mon,0,12)));
    return Array.from(new Set([...result,...scheduledDates])).sort();
  },[selectedSamity,month,closures,holidayRows,fridayEnabled,loanSchedule]);

  const displayDates=useMemo(()=>Array.from(new Set([...meetingDates,...loanSchedule.map(x=>x.due_date).filter((d:string)=>d>=month+'-01'&&d<=month+'-31')])).sort(),[meetingDates,loanSchedule,month]);

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      if(!supabase||!samityId||!month){setMembers([]);setSavings([]);setLoans([]);setLoanTx([]);setLoanSchedule([]);return;}
      setLoading(true);setNotice('');
      const start=month+'-01';
      const [yy,mm]=month.split('-').map(Number);
      const end=dateText(new Date(yy,mm,0,12));
      const mr=await supabase.from('members').select('id,member_code,full_name,spouse_name,samity_id,is_active').eq('samity_id',samityId).eq('is_active',true).order('member_code');
      if(mr.error){if(!cancelled)setNotice('সদস্য তালিকা পড়া যায়নি: '+mr.error.message);setLoading(false);return;}
      const ids=(mr.data||[]).map(x=>x.id);
      if(!ids.length){if(!cancelled){setMembers([]);setSavings([]);setLoans([]);setLoanTx([]);setLoanSchedule([]);setLoading(false);}return;}
      const [sr,lr,cr,hr,hs]=await Promise.all([
        supabase.from('savings_transactions').select('id,member_id,transaction_date,transaction_type,amount,savings_category').in('member_id',ids).lte('transaction_date',end).order('transaction_date'),
        supabase.from('loan_accounts').select('id,loan_no,member_id,principal,total_repayable,total_service_charge,disbursement_date,status').in('member_id',ids).order('disbursement_date'),
        supabase.from('samity_week_closures').select('closure_date').eq('samity_id',samityId).gte('closure_date',start).lte('closure_date',end),
        supabase.from('holiday_calendar').select('*').eq('is_active',true).lte('date_from',end).gte('date_to',start),
        supabase.from('holiday_calendar_settings').select('friday_holiday_enabled').eq('id',1).maybeSingle()
      ]);
      if(sr.error||lr.error){if(!cancelled)setNotice('আদায় তথ্য পড়া যায়নি: '+(sr.error?.message||lr.error?.message));setLoading(false);return;}
      const loanIds=(lr.data||[]).map(x=>x.id);
      const [tr,sch]=loanIds.length?await Promise.all([supabase.from('loan_transactions').select('id,loan_id,transaction_date,amount').in('loan_id',loanIds).lte('transaction_date',end).order('transaction_date'),supabase.from('loan_installment_schedule').select('id,loan_id,week_no,due_date,total_due,principal_paid,service_charge_paid,status').in('loan_id',loanIds).gte('due_date',start).lte('due_date',end).order('due_date')]):[{data:[],error:null},{data:[],error:null}] as any;
      if(tr.error||sch.error){if(!cancelled)setNotice('ঋণ আদায়/কিস্তির তথ্য পড়া যায়নি: '+(tr.error?.message||sch.error?.message));setLoading(false);return;}
      if(!cancelled){
        setMembers(mr.data||[]);setSavings(sr.data||[]);setLoans(lr.data||[]);setLoanTx(tr.data||[]);setLoanSchedule(sch.data||[]);
        setClosures(cr.data||[]);
        setHolidayRows(hr.error?[]:hr.data||[]);
        if(!hs.error && hs.data)setFridayEnabled(Boolean(hs.data.friday_holiday_enabled));
      }
      setLoading(false);
    }
    load();
    return ()=>{cancelled=true;};
  },[samityId,month]);

  const rows=useMemo(()=>members.map(m=>{
    const memberSavings=savings.filter(x=>x.member_id===m.id);
    const memberLoans=loans.filter(x=>x.member_id===m.id&&x.status==='active'&&x.disbursement_date<=month+'-31');
    const openingLoans=memberLoans.filter(x=>x.disbursement_date<month+'-01');
    const loanIds=memberLoans.map(x=>x.id);
    const gsOpen=memberSavings.filter(x=>x.savings_category==='GS'&&x.transaction_date<month+'-01').reduce((s,x)=>s+(x.transaction_type==='deposit'?1:-1)*Number(x.amount),0);
    const ltsOpen=memberSavings.filter(x=>x.savings_category==='LTS-New'&&x.transaction_date<month+'-01').reduce((s,x)=>s+(x.transaction_type==='deposit'?1:-1)*Number(x.amount),0);
    const gsBy=displayDates.map(d=>memberSavings.filter(x=>x.transaction_date===d&&x.savings_category==='GS'&&x.transaction_type==='deposit').reduce((s,x)=>s+Number(x.amount),0));
    const ltsBy=displayDates.map(d=>memberSavings.filter(x=>x.transaction_date===d&&x.savings_category==='LTS-New'&&x.transaction_type==='deposit').reduce((s,x)=>s+Number(x.amount),0));
    const openingLoanIds=openingLoans.map(x=>x.id);
    const loanOpen=openingLoans.reduce((s,l)=>s+Number(l.total_repayable??(Number(l.principal)+Number(l.total_service_charge||0))),0)-loanTx.filter(x=>openingLoanIds.includes(x.loan_id)&&x.transaction_date<month+'-01').reduce((s,x)=>s+Number(x.amount),0);
    const loanBy=displayDates.map(d=>loanTx.filter(x=>loanIds.includes(x.loan_id)&&x.transaction_date===d).reduce((s,x)=>s+Number(x.amount),0));
    const loanDueBy=displayDates.map(d=>loanSchedule.filter(x=>loanIds.includes(x.loan_id)&&x.due_date===d&&x.status!=='paid').reduce((s,x)=>s+Math.max(0,Number(x.total_due)-Number(x.principal_paid||0)-Number(x.service_charge_paid||0)),0));
    const gsTotal=gsBy.reduce((a,b)=>a+b,0),ltsTotal=ltsBy.reduce((a,b)=>a+b,0),loanTotal=loanBy.reduce((a,b)=>a+b,0);
    return {...m,gsOpen,ltsOpen,loanOpen,gsBy,ltsBy,loanBy,loanDueBy,gsTotal,ltsTotal,loanTotal,gsClose:gsOpen+gsTotal,ltsClose:ltsOpen+ltsTotal,loanClose:Math.max(0,loanOpen-loanTotal)};
  }),[members,savings,loans,loanTx,loanSchedule,displayDates,month]);

  const totals=rows.reduce((a,r)=>({gsOpen:a.gsOpen+r.gsOpen,ltsOpen:a.ltsOpen+r.ltsOpen,loanOpen:a.loanOpen+r.loanOpen,gsTotal:a.gsTotal+r.gsTotal,ltsTotal:a.ltsTotal+r.ltsTotal,loanTotal:a.loanTotal+r.loanTotal,gsClose:a.gsClose+r.gsClose,ltsClose:a.ltsClose+r.ltsClose,loanClose:a.loanClose+r.loanClose}),{gsOpen:0,ltsOpen:0,loanOpen:0,gsTotal:0,ltsTotal:0,loanTotal:0,gsClose:0,ltsClose:0,loanClose:0});

  if(!canDo('collection','view')&&!canDo('collection','create'))return <section className="panel"><h2>অনুমতি প্রয়োজন</h2><p>সমিতিভিত্তিক আদায় সিট দেখার অনুমতি নেই। Main Admin-এর কাছে Collection permission চান।</p></section>;
  return <section className="workspace">
    <div className="section-head"><div><p className="eyebrow">SAMITY COLLECTION</p><h2>সমিতিভিত্তিক মাসিক আদায় সিট</h2><p>একই সদস্যের GS, LTS-New ও ঋণের আদায় একসঙ্গে দেখুন।</p></div></div>
    <div className="form-grid">
      <label>সমিতি *<select value={samityId} onChange={e=>setSamityId(e.target.value)}><option value="">সমিতি নির্বাচন</option>{samities.map(s=><option key={s.id} value={s.id}>{s.samity_code} — {s.samity_name}</option>)}</select></label>
      <label>মাস *<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
    </div>
    {notice&&<div className="notice">{notice}</div>}
    {samityId&&<><div className="panel"><p><b>সমিতি:</b> {selectedSamity?.samity_name} ({selectedSamity?.samity_code})　<b>সভা:</b> {selectedSamity?.meeting_time||'—'}</p><p><b>সভা তারিখ:</b> {meetingDates.length?meetingDates.join(' · '):'সভা-দিন নির্ধারিত নেই অথবা বন্ধের দিন চিহ্নিত'}</p><p className="muted">ঋণের নির্ধারিত কিস্তির তারিখও এই সিটে দেখানো হবে; ছুটির কারণে তারিখ পরিবর্তিত হলে নতুন তারিখ এখানে যুক্ত হবে।</p></div>
    {loading?<div className="panel">তথ্য লোড হচ্ছে...</div>:<div className="table-wrap"><table><thead>
      <tr><th rowSpan={2}>SL</th><th rowSpan={2}>Member Code</th><th rowSpan={2}>সদস্যের নাম</th><th rowSpan={2}>GS Opening</th><th rowSpan={2}>LTS-New Opening</th><th rowSpan={2}>ঋণের Opening</th>
      {displayDates.map((d,i)=><th key={d} colSpan={3}>{i+1}ম সপ্তাহ · {d}</th>)}<th colSpan={3}>মাসের মোট আদায়</th><th colSpan={3}>Closing Balance</th></tr>
      <tr>{displayDates.flatMap(d=>[<th key={d+'g'}>GS</th>,<th key={d+'l'}>LTS-New</th>,<th key={d+'loan'}>Loan Due / আদায়</th>])}<th>GS</th><th>LTS-New</th><th>Loan</th><th>GS</th><th>LTS-New</th><th>Loan</th></tr>
    </thead><tbody>{rows.map((r,i)=><tr key={r.id}><td>{i+1}</td><td>{r.member_code}</td><td>{r.full_name}</td><td>{money(r.gsOpen)}</td><td>{money(r.ltsOpen)}</td><td>{money(r.loanOpen)} </td>
      {displayDates.flatMap((d,j)=>[<td key={d+'g'}>{money(r.gsBy[j])}</td>,<td key={d+'l'}>{money(r.ltsBy[j])}</td>,<td key={d+'loan'}><span title="নির্ধারিত কিস্তি / বাস্তবে আদায়">{money(r.loanDueBy[j])} / {money(r.loanBy[j])}</span></td>])}
      <td>{money(r.gsTotal)}</td><td>{money(r.ltsTotal)}</td><td>{money(r.loanTotal)}</td><td>{money(r.gsClose)}</td><td>{money(r.ltsClose)}</td><td>{money(r.loanClose)}</td></tr>)}
      {!rows.length&&<tr><td colSpan={15+displayDates.length*3} className="empty">এই সমিতিতে সক্রিয় সদস্য নেই।</td></tr>}
      {rows.length>0&&<tr><th colSpan={3}>সর্বমোট</th><th>{money(totals.gsOpen)}</th><th>{money(totals.ltsOpen)}</th><th>{money(totals.loanOpen)}</th>
        {displayDates.flatMap((d,j)=>[<th key={d+'g'}>{money(rows.reduce((s,r)=>s+r.gsBy[j],0))}</th>,<th key={d+'l'}>{money(rows.reduce((s,r)=>s+r.ltsBy[j],0))}</th>,<th key={d+'loan'}>{money(rows.reduce((s,r)=>s+r.loanDueBy[j],0))} / {money(rows.reduce((s,r)=>s+r.loanBy[j],0))}</th>])}
        <th>{money(totals.gsTotal)}</th><th>{money(totals.ltsTotal)}</th><th>{money(totals.loanTotal)}</th><th>{money(totals.gsClose)}</th><th>{money(totals.ltsClose)}</th><th>{money(totals.loanClose)}</th></tr>}
    </tbody></table></div>}
    <p className="muted">নোট: এটি বিদ্যমান জমা/আদায়ের লেনদেন থেকে প্রস্তুত রিপোর্ট। অগ্রিম, বকেয়া, খেলাপি, উত্তোলন এবং LTS-New Return-এর পৃথক বরাদ্দের নিয়ম যুক্ত না হওয়া পর্যন্ত সেগুলোর হিসাব এখানে চূড়ান্ত দেখানো হচ্ছে না।</p></>}
  </section>;
}
