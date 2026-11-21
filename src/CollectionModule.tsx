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
  const [dailyDate,setDailyDate]=useState(dateText(new Date()));
  const [dailyRows,setDailyRows]=useState<any[]>([]);
  const [dailyStatus,setDailyStatus]=useState('');
  const [dailySheetId,setDailySheetId]=useState('');
  const [correctionReason,setCorrectionReason]=useState('');
  const [dailyBusy,setDailyBusy]=useState(false);
  const [enrollments,setEnrollments]=useState<any[]>([]);
  const [monthReopenReason,setMonthReopenReason]=useState('');
  const [dayReopenReason,setDayReopenReason]=useState('');
  const [profile,setProfile]=useState<any>(null);
  const [assignedSamityIds,setAssignedSamityIds]=useState<string[]>([]);
  const canCorrect=canDo('collection','update')||['main_admin','co_admin','branch_manager'].includes(profile?.role);
  const visibleSamities=useMemo(()=>profile?.role==='co'
    ? samities.filter(s=>assignedSamityIds.includes(s.id))
    : profile?.role==='branch_manager'
      ? samities.filter(s=>s.branch_id===profile.branch_id)
      : samities,[samities,profile,assignedSamityIds]);
  const dailySamities=useMemo(()=>visibleSamities.filter(s=>s.status==='active'&&Number(s.meeting_day)===new Date(dailyDate+'T12:00:00').getDay()),[visibleSamities,dailyDate]);
  useEffect(()=>{let live=true;(async()=>{
    if(!supabase)return;
    const {data:{user}}=await supabase.auth.getUser();
    if(!user)return;
    const {data:p}=await supabase.from('profiles').select('role,branch_id,employee_id').eq('id',user.id).maybeSingle();
    if(!live)return;setProfile(p||null);
    if(p?.role==='co'&&p.employee_id){
      const {data:a}=await supabase.from('samity_employee_assignments').select('samity_id')
        .eq('employee_id',p.employee_id).eq('is_active',true).lte('assigned_from',dailyDate)
        .or('assigned_to.is.null,assigned_to.gte.'+dailyDate);
      if(live)setAssignedSamityIds((a||[]).map(x=>x.samity_id));
    }
  })();return()=>{live=false}},[dailyDate]);
  useEffect(()=>{let live=true;(async()=>{
    if(!supabase||!samityId||!dailyDate){setDailyRows([]);setDailyStatus('');setDailySheetId('');return;}
    const {data,error}=await supabase.from('daily_collection_sheets').select('id,status,rows')
      .eq('samity_id',samityId).eq('collection_date',dailyDate).maybeSingle();
    if(!live)return;
    if(error){setNotice('দৈনিক সিট পড়া যায়নি: '+error.message);return;}
    setDailySheetId(data?.id||'');setDailyStatus(data?.status||'');
    if(data?.rows)setDailyRows(data.rows);
    else setDailyRows(members.map(m=>{
      const activeLoans=loans.filter(l=>l.member_id===m.id&&l.status==='active');
      const optional=enrollments.filter(e=>e.member_id===m.id&&e.savings_type==='optional');
      return {member_id:m.id,member_code:m.member_code,member_name:m.full_name,is_present:false,gs_deposit:0,gs_withdrawal:0,lts_new:0,optional_savings:0,optional_enrollment_id:optional[0]?.id||'',loan_id:activeLoans[0]?.id||'',loan_paid:0,remarks:''};
    }));
  })();return()=>{live=false}},[samityId,dailyDate,members,loans,enrollments]);
  function updateDailyRow(index:number,key:string,value:any){
    setDailyRows(old=>old.map((r,i)=>i===index?{...r,[key]:value}:r));
  }
  async function saveDaily(action:'draft'|'post'){
    if(!supabase||!samityId||!dailyDate)return;
    if(dailyStatus==='closed'){setNotice('Day End সম্পন্ন; সংশোধনের জন্য অনুমোদিত Reopen প্রয়োজন।');return;}
    if(dailyStatus==='posted'&&(!canCorrect||!correctionReason.trim())){
      setNotice('পোস্ট করা হিসাব সংশোধনে অনুমতি ও কারণ আবশ্যক।');return;
    }
    setDailyBusy(true);setNotice('');
    const {data,error}=await supabase.rpc('save_daily_collection',{
      p_samity_id:samityId,p_collection_date:dailyDate,p_rows:dailyRows,
      p_action:action,p_reason:correctionReason.trim()||null
    });
    setDailyBusy(false);
    if(error){setNotice('সংরক্ষণ হয়নি: '+error.message);return;}
    setDailySheetId(data);setDailyStatus(action==='post'?'posted':'draft');
    setCorrectionReason('');setNotice(action==='post'?'দৈনিক আদায় পোস্ট সম্পন্ন হয়েছে।':'খসড়া সংরক্ষণ হয়েছে।');
  }
  async function reopenDay(){
    if(!supabase||!dailySheetId||!dayReopenReason.trim())return;
    setDailyBusy(true);const {error}=await supabase.rpc('reopen_daily_collection',{p_sheet_id:dailySheetId,p_reason:dayReopenReason.trim()});setDailyBusy(false);
    if(error){setNotice('Day Reopen হয়নি: '+error.message);return;}
    setDailyStatus('posted');setDayReopenReason('');setNotice('Day Reopen সম্পন্ন। এখন অনুমোদিত সংশোধন করা যাবে।');
  }
  async function reopenMonth(){
    if(!supabase||!selectedSamity?.branch_id||!monthReopenReason.trim())return;
    setDailyBusy(true);const {error}=await supabase.rpc('reopen_collection_month',{p_branch_id:selectedSamity.branch_id,p_month_start:month+'-01',p_reason:monthReopenReason.trim()});setDailyBusy(false);
    setNotice(error?'Month Reopen হয়নি: '+error.message:'Month Reopen সম্পন্ন হয়েছে।');if(!error)setMonthReopenReason('');
  }
  async function closeDay(){
    if(!supabase||!dailySheetId)return;
    if(!window.confirm('এই সমিতির আজকের আদায় সিটের Day End করবেন?'))return;
    setDailyBusy(true);const {error}=await supabase.rpc('close_daily_collection',{p_sheet_id:dailySheetId});setDailyBusy(false);
    if(error){setNotice('Day End হয়নি: '+error.message);return;}
    setDailyStatus('closed');
    const remaining=dailySamities.filter(x=>x.id!==samityId);
    let pending:any[]=[];
    if(remaining.length){
      const {data:closedRows}=await supabase.from('daily_collection_sheets').select('samity_id,status')
        .eq('collection_date',dailyDate).in('samity_id',remaining.map(x=>x.id));
      const done=new Set((closedRows||[]).filter(x=>x.status==='closed').map(x=>x.samity_id));
      pending=remaining.filter(x=>!done.has(x.id));
    }
    if(pending.length){
      setSamityId(pending[0].id);
      setNotice('এই তারিখের একটি সমিতির Day End সম্পন্ন। একই দিনের পরবর্তী সমিতি নির্বাচন করা হয়েছে।');
    }else{
      const next=new Date(dailyDate+'T12:00:00');next.setDate(next.getDate()+1);
      setSamityId('');setDailyDate(dateText(next));
      setNotice('আজকের সব দৃশ্যমান সমিতির Day End সম্পন্ন। পরবর্তী দিনের আদায় সিট প্রস্তুত।');
    }
  }
  async function closeMonth(){
    if(!supabase||!selectedSamity?.branch_id)return;
    const monthStart=month+'-01';
    if(!window.confirm(month+' মাসের শাখার Month End করবেন?'))return;
    setDailyBusy(true);const {error}=await supabase.rpc('close_collection_month',{p_branch_id:selectedSamity.branch_id,p_month_start:monthStart});setDailyBusy(false);
    setNotice(error?'Month End হয়নি: '+error.message:'Month End সম্পন্ন হয়েছে।');
  }
  const selectedSamity=samities.find(s=>s.id===samityId);
  const endOfMonth=month?(()=>{const [y,m]=month.split('-').map(Number);return dateText(new Date(y,m,0,12));})():'';

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
    return result;
  },[selectedSamity,month,closures,holidayRows,fridayEnabled]);

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
      const [sr,lr,cr,hr,hs,er]=await Promise.all([
        supabase.from('savings_transactions').select('id,member_id,transaction_date,transaction_type,amount,savings_category').in('member_id',ids).lte('transaction_date',end).order('transaction_date'),
        supabase.from('loan_accounts').select('id,loan_no,member_id,principal,total_repayable,total_service_charge,disbursement_date,status').in('member_id',ids).order('disbursement_date'),
        supabase.from('samity_week_closures').select('closure_date').eq('samity_id',samityId).gte('closure_date',start).lte('closure_date',end),
        supabase.from('holiday_calendar').select('*').eq('is_active',true).lte('date_from',end).gte('date_to',start),
        supabase.from('holiday_calendar_settings').select('friday_holiday_enabled').eq('id',1).maybeSingle(),
        supabase.from('member_savings_enrollments').select('id,member_id,savings_type,product_name_snapshot,amount').in('member_id',ids)
      ]);
      if(sr.error||lr.error){if(!cancelled)setNotice('আদায় তথ্য পড়া যায়নি: '+(sr.error?.message||lr.error?.message));setLoading(false);return;}
      const loanIds=(lr.data||[]).map(x=>x.id);
      const [tr, scheduleResult]=loanIds.length?await Promise.all([
        supabase.from('loan_transactions').select('id,loan_id,transaction_date,amount').in('loan_id',loanIds).lte('transaction_date',end).order('transaction_date'),
        supabase.from('loan_installment_schedule').select('id,loan_id,week_no,due_date,total_due,principal_paid,service_charge_paid,status').in('loan_id',loanIds).gte('due_date',start).lte('due_date',end).order('due_date')
      ]): [{data:[],error:null},{data:[],error:null}] as any;
      if(tr.error||scheduleResult.error){if(!cancelled)setNotice('ঋণ আদায়/কিস্তির তথ্য পড়া যায়নি: '+(tr.error?.message||scheduleResult.error?.message));setLoading(false);return;}
      if(!cancelled){
        setMembers(mr.data||[]);setSavings(sr.data||[]);setLoans(lr.data||[]);setLoanTx(tr.data||[]);setLoanSchedule(scheduleResult.data||[]);
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
    const memberLoans=loans.filter(x=>x.member_id===m.id&&x.status==='active'&&x.disbursement_date<=endOfMonth);
    const loanIds=memberLoans.map(x=>x.id);
    const gsOpen=memberSavings.filter(x=>x.savings_category==='GS'&&x.transaction_date<month+'-01').reduce((s,x)=>s+(x.transaction_type==='deposit'?1:-1)*Number(x.amount),0);
    const ltsOpen=memberSavings.filter(x=>x.savings_category==='LTS-New'&&x.transaction_date<month+'-01').reduce((s,x)=>s+(x.transaction_type==='deposit'?1:-1)*Number(x.amount),0);
    const gsBy=meetingDates.map(d=>memberSavings.filter(x=>x.transaction_date===d&&x.savings_category==='GS'&&x.transaction_type==='deposit').reduce((s,x)=>s+Number(x.amount),0));
    const ltsBy=meetingDates.map(d=>memberSavings.filter(x=>x.transaction_date===d&&x.savings_category==='LTS-New'&&x.transaction_type==='deposit').reduce((s,x)=>s+Number(x.amount),0));
    const openingLoans=memberLoans.filter(l=>l.disbursement_date<month+'-01');
    const loanOpen=openingLoans.reduce((s,l)=>s+Number(l.total_repayable??(Number(l.principal)+Number(l.total_service_charge||0))),0)-loanTx.filter(x=>loanIds.includes(x.loan_id)&&x.transaction_date<month+'-01').reduce((s,x)=>s+Number(x.amount),0);
    const loanDueBy=meetingDates.map(d=>loanSchedule.filter(x=>loanIds.includes(x.loan_id)&&x.due_date===d&&x.status!=='paid'&&Number(x.week_no)<=46).reduce((s,x)=>{const loan=memberLoans.find(l=>l.id===x.loan_id);if(!loan)return s;const repayable=Number(loan.total_repayable??(Number(loan.principal)+Number(loan.total_service_charge||0)));const paidBefore=loanTx.filter(t=>t.loan_id===x.loan_id&&t.transaction_date<d).reduce((a,t)=>a+Number(t.amount||0),0);const balanceBefore=Math.max(0,repayable-paidBefore);if(balanceBefore<=0)return s;const installmentLeft=Math.max(0,Number(x.total_due)-Number(x.principal_paid||0)-Number(x.service_charge_paid||0));return s+Math.min(balanceBefore,installmentLeft);},0));
    const loanBy=meetingDates.map(d=>loanTx.filter(x=>loanIds.includes(x.loan_id)&&x.transaction_date===d).reduce((s,x)=>s+Number(x.amount),0));
    const gsTotal=gsBy.reduce((a,b)=>a+b,0),ltsTotal=ltsBy.reduce((a,b)=>a+b,0),loanDueTotal=loanDueBy.reduce((a,b)=>a+b,0),loanTotal=loanBy.reduce((a,b)=>a+b,0);
    return {...m,gsOpen,ltsOpen,loanOpen,gsBy,ltsBy,loanDueBy,loanBy,gsTotal,ltsTotal,loanDueTotal,loanTotal,gsClose:gsOpen+gsTotal,ltsClose:ltsOpen+ltsTotal,loanClose:Math.max(0,loanOpen-loanTotal)};
  }),[members,savings,loans,loanTx,loanSchedule,meetingDates,month]);

  const totals=rows.reduce((a,r)=>({gsOpen:a.gsOpen+r.gsOpen,ltsOpen:a.ltsOpen+r.ltsOpen,loanOpen:a.loanOpen+r.loanOpen,gsTotal:a.gsTotal+r.gsTotal,ltsTotal:a.ltsTotal+r.ltsTotal,loanDueTotal:a.loanDueTotal+r.loanDueTotal,loanTotal:a.loanTotal+r.loanTotal,gsClose:a.gsClose+r.gsClose,ltsClose:a.ltsClose+r.ltsClose,loanClose:a.loanClose+r.loanClose}),{gsOpen:0,ltsOpen:0,loanOpen:0,gsTotal:0,ltsTotal:0,loanDueTotal:0,loanTotal:0,gsClose:0,ltsClose:0,loanClose:0});

  if(!canDo('collection','view')&&!canDo('collection','create'))return <section className="panel"><h2>অনুমতি প্রয়োজন</h2><p>সমিতিভিত্তিক আদায় সিট দেখার অনুমতি নেই। Main Admin-এর কাছে Collection permission চান।</p></section>;
  return <section className="workspace">
    <div className="section-head"><div><p className="eyebrow">DAILY COLLECTION POSTING</p><h2>দৈনিক আদায় সিট</h2><p>সমিতির নির্ধারিত সভার দিন অনুযায়ী সদস্যভিত্তিক আদায় লিখুন।</p></div></div>
    <div className="form-grid">
      <label>আদায়ের তারিখ *<input type="date" value={dailyDate} onChange={e=>{setDailyDate(e.target.value);setSamityId('');}} /></label>
      <label>সমিতি *<select value={samityId} onChange={e=>setSamityId(e.target.value)}><option value="">সমিতি নির্বাচন</option>{dailySamities.map(x=><option key={x.id} value={x.id}>{x.samity_code} — {x.samity_name}</option>)}</select></label>
    </div>
    {samityId&&<><div className="panel"><b>অবস্থা:</b> {dailyStatus==='closed'?'Day End সম্পন্ন':dailyStatus==='posted'?'Posted':dailyStatus==='draft'?'Draft':'এখনও পোস্ট হয়নি'}　<b>সভার দিন:</b> {['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'][selectedSamity?.meeting_day]||'—'}<p className="muted">শুধু নির্বাচিত তারিখে সভা আছে এমন সমিতিই তালিকায় দেখানো হয়।</p></div>
    {dailyRows.length>0 ? <div className="table-wrap"><table><thead><tr><th>SL</th><th>সদস্য কোড ও নাম</th><th>উপস্থিত</th><th>GS জমা</th><th>GS উত্তোলন</th><th>LTS-New জমা</th>{Number(dailyDate.slice(8,10))<=14&&<><th>ঐচ্ছিক সঞ্চয় স্কিম</th><th>ঐচ্ছিক জমা</th></>}<th>ঋণ হিসাব</th><th>ঋণ আদায়</th><th>মন্তব্য</th></tr></thead><tbody>
    {dailyRows.map((r,i)=>{
      const memberLoans=loans.filter(l=>l.member_id===r.member_id&&l.status==='active');
      const memberOptional=enrollments.filter(e=>e.member_id===r.member_id&&e.savings_type==='optional');
      const locked=dailyStatus==='closed'||(dailyStatus==='posted'&&!canCorrect);
      return <tr key={r.member_id}><td>{i+1}</td><td>{r.member_code}<br/>{r.member_name}</td><td><input type="checkbox" checked={Boolean(r.is_present)} disabled={locked} onChange={e=>updateDailyRow(i,'is_present',e.target.checked)}/></td>
      {['gs_deposit','gs_withdrawal','lts_new'].map(k=><td key={k}><input type="number" min="0" step="0.01" disabled={locked} value={r[k]||0} onChange={e=>updateDailyRow(i,k,Number(e.target.value))}/></td>)}
      {Number(dailyDate.slice(8,10))<=14&&<><td><select disabled={locked||!memberOptional.length} value={r.optional_enrollment_id||''} onChange={e=>updateDailyRow(i,'optional_enrollment_id',e.target.value)}><option value="">স্কিম নির্বাচন</option>{memberOptional.map(x=><option key={x.id} value={x.id}>{x.product_name_snapshot||'ঐচ্ছিক স্কিম'}</option>)}</select></td>
      <td><input type="number" min="0" step="0.01" disabled={locked||!memberOptional.length} value={r.optional_savings||0} onChange={e=>updateDailyRow(i,'optional_savings',Number(e.target.value))}/></td></>}
      <td><select disabled={locked||!memberLoans.length} value={r.loan_id||''} onChange={e=>updateDailyRow(i,'loan_id',e.target.value)}><option value="">ঋণ নির্বাচন</option>{memberLoans.map(x=><option key={x.id} value={x.id}>{x.loan_no}</option>)}</select></td>
      <td><input type="number" min="0" step="0.01" disabled={locked||!memberLoans.length} value={r.loan_paid||0} onChange={e=>updateDailyRow(i,'loan_paid',Number(e.target.value))}/></td>
      <td><input disabled={locked} value={r.remarks||''} onChange={e=>updateDailyRow(i,'remarks',e.target.value)}/></td></tr>;
    })}</tbody><tfoot><tr><th colSpan={3}>সর্বমোট</th>{['gs_deposit','gs_withdrawal','lts_new'].map(k=><th key={k}>{money(dailyRows.reduce((s,r)=>s+Number(r[k]||0),0))}</th>)}{Number(dailyDate.slice(8,10))<=14&&<><th>—</th><th>{money(dailyRows.reduce((s,r)=>s+Number(r.optional_savings||0),0))}</th></>}<th>—</th><th>{money(dailyRows.reduce((s,r)=>s+Number(r.loan_paid||0),0))}</th><th>—</th></tr></tfoot></table></div>:<p className="muted">{loading?'সদস্য তালিকা লোড হচ্ছে...':'এই সমিতিতে সক্রিয় সদস্য পাওয়া যায়নি।'}</p>}
    {dailyStatus==='posted'&&canCorrect&&<label>সংশোধনের কারণ *<input value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)} placeholder="কেন সংশোধন করছেন লিখুন"/></label>}
    {dailyStatus==='closed'&&canCorrect&&<label>Day Reopen-এর কারণ *<input value={dayReopenReason} onChange={e=>setDayReopenReason(e.target.value)}/></label>}
    <div className="form-actions">
      <button disabled={dailyBusy||!samityId||!dailyRows.length||dailyStatus==='closed'||dailyStatus==='posted'||(dailyStatus==='posted'&&(!canCorrect||!correctionReason.trim()))} onClick={()=>saveDaily('draft')}>খসড়া সংরক্ষণ</button>
      <button disabled={dailyBusy||!samityId||!dailyRows.length||dailyStatus==='closed'||(dailyStatus==='posted'&&(!canCorrect||!correctionReason.trim()))} onClick={()=>saveDaily('post')}>{dailyStatus==='posted'?'সংশোধন সংরক্ষণ ও পোস্ট':'আদায় পোস্ট করুন'}</button>
      <button className="secondary" disabled={dailyBusy||dailyStatus!=='posted'||!canCorrect} onClick={closeDay}>Day End</button>
      {dailyStatus==='closed'&&canCorrect&&<button className="secondary" disabled={dailyBusy||!dayReopenReason.trim()} onClick={reopenDay}>Day Reopen</button>}
    </div></>}
    <div className="divider"></div>
    <div className="section-head"><div><p className="eyebrow">MONTH END</p><h2>মাস সমাপনী</h2><p>শাখার দৈনিক সিটগুলো Day End সম্পন্ন হলে Month End করুন।</p></div></div>
    <div className="form-grid">
      <label>শাখার সমিতি নির্বাচন<select value={samityId} onChange={e=>setSamityId(e.target.value)}><option value="">সমিতি নির্বাচন</option>{visibleSamities.map(s=><option key={s.id} value={s.id}>{s.samity_code} — {s.samity_name}</option>)}</select></label>
      <label>মাস<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
    </div>
    <div className="form-actions">
      <button disabled={dailyBusy||!canCorrect||!selectedSamity?.branch_id||!month} onClick={closeMonth}>Month End (শাখা)</button>
      <input aria-label="Month reopen reason" placeholder="Month Reopen-এর কারণ" value={monthReopenReason} onChange={e=>setMonthReopenReason(e.target.value)}/>
      <button className="secondary" disabled={dailyBusy||!canCorrect||!selectedSamity?.branch_id||!monthReopenReason.trim()} onClick={reopenMonth}>Month Reopen</button>
    </div>
    <div className="divider"></div>
    <div className="section-head"><div><p className="eyebrow">MONTHLY REPORT</p><h2>সমিতিভিত্তিক মাসিক আদায় রিপোর্ট</h2><p>সঞ্চয় ও ঋণ আদায়ের বিদ্যমান রিপোর্ট।</p></div></div>
    <div className="form-grid">
      <label>সমিতি *<select value={samityId} onChange={e=>setSamityId(e.target.value)}><option value="">সমিতি নির্বাচন</option>{visibleSamities.map(s=><option key={s.id} value={s.id}>{s.samity_code} — {s.samity_name}</option>)}</select></label>
      <label>মাস *<input type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label>
    </div>
    {notice&&<div className="notice">{notice}</div>}
    {samityId&&<><div className="panel"><p><b>সমিতি:</b> {selectedSamity?.samity_name} ({selectedSamity?.samity_code})　<b>সভা:</b> {selectedSamity?.meeting_time||'—'}</p><p><b>সভা তারিখ:</b> {meetingDates.length?meetingDates.join(' · '):'সভা-দিন নির্ধারিত নেই অথবা বন্ধের দিন চিহ্নিত'}</p><p className="muted">বন্ধের তারিখগুলো ৪৬ সপ্তাহের কিস্তির ক্যালেন্ডার ও এই আদায় সিটে বাদ থাকবে।</p></div>
    {loading?<div className="panel">তথ্য লোড হচ্ছে...</div>:<div className="table-wrap"><table><thead>
      <tr><th rowSpan={2}>SL</th><th rowSpan={2}>Member Code</th><th rowSpan={2}>সদস্যের নাম</th><th rowSpan={2}>GS Opening</th><th rowSpan={2}>LTS-New Opening</th><th rowSpan={2}>ঋণের Opening</th>
      {meetingDates.map((d,i)=><th key={d} colSpan={4}>{i+1}ম সপ্তাহ · {d}</th>)}<th colSpan={4}>মাসের মোট</th><th colSpan={3}>Closing Balance</th></tr>
      <tr>{meetingDates.flatMap(d=>[<th key={d+'g'}>GS</th>,<th key={d+'l'}>LTS-New</th>,<th key={d+'due'}>Loan Due</th>,<th key={d+'loan'}>Loan Paid</th>])}<th>GS</th><th>LTS-New</th><th>Loan Due</th><th>Loan Paid</th><th>GS</th><th>LTS-New</th><th>Loan</th></tr>
    </thead><tbody>{rows.map((r,i)=><tr key={r.id}><td>{i+1}</td><td>{r.member_code}</td><td>{r.full_name}</td><td>{money(r.gsOpen)}</td><td>{money(r.ltsOpen)}</td><td>{money(r.loanOpen)} </td>
      {meetingDates.flatMap((d,j)=>[<td key={d+'g'}>{money(r.gsBy[j])}</td>,<td key={d+'l'}>{money(r.ltsBy[j])}</td>,<td key={d+'due'}>{money(r.loanDueBy[j])}</td>,<td key={d+'loan'}>{money(r.loanBy[j])}</td>])}
      <td>{money(r.gsTotal)}</td><td>{money(r.ltsTotal)}</td><td>{money(r.loanDueTotal)}</td><td>{money(r.loanTotal)}</td><td>{money(r.gsClose)}</td><td>{money(r.ltsClose)}</td><td>{money(r.loanClose)}</td></tr>)}
      {!rows.length&&<tr><td colSpan={13+meetingDates.length*4} className="empty">এই সমিতিতে সক্রিয় সদস্য নেই।</td></tr>}
      {rows.length>0&&<tr><th colSpan={3}>সর্বমোট</th><th>{money(totals.gsOpen)}</th><th>{money(totals.ltsOpen)}</th><th>{money(totals.loanOpen)}</th>
        {meetingDates.flatMap((d,j)=>[<th key={d+'g'}>{money(rows.reduce((s,r)=>s+r.gsBy[j],0))}</th>,<th key={d+'l'}>{money(rows.reduce((s,r)=>s+r.ltsBy[j],0))}</th>,<th key={d+'due'}>{money(rows.reduce((s,r)=>s+r.loanDueBy[j],0))}</th>,<th key={d+'loan'}>{money(rows.reduce((s,r)=>s+r.loanBy[j],0))}</th>])}
        <th>{money(totals.gsTotal)}</th><th>{money(totals.ltsTotal)}</th><th>{money(totals.loanDueTotal)}</th><th>{money(totals.loanTotal)}</th><th>{money(totals.gsClose)}</th><th>{money(totals.ltsClose)}</th><th>{money(totals.loanClose)}</th></tr>}
    </tbody></table></div>}
    <p className="muted">নোট: মাসিক রিপোর্টে Optional Savings Return/withdrawal-এর পৃথক হিসাব পরবর্তী reconciliation-এ যুক্ত হবে।</p></>}
  </section>;
}