import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from './lib/supabase';
import { calculateLoanSchedule, calculateFirstInstallmentDate, buildInstallmentDates } from './lib/loanCalculation';

type OpeningBalance = { member_id: string; gs_balance: number; lts_new_balance: number; optional_balance: number; opening_date: string };
type OpeningLoan = { id:string; member_id:string; loan_no:string; disbursement_date:string; project_name:string; loan_cycle:number; principal_amount:number; service_charge_amount:number; amount_repaid_to_date:number; current_status:'active'|'closed'|'written_off'; outstanding_balance:number; overdue_balance:number; last_installment_no:number; last_installment_date:string|null; next_installment_date:string|null; next_collectible_balance:number; reference_no:string|null; notes:string|null };

type Props = {
  samities: any[];
  openingOnly?: boolean;
  canDo: (moduleKey: string, action: 'view'|'create'|'update'|'delete') => boolean;
};

type Member = { id: string; member_code: string; full_name: string; samity_id: string | null; branch_id: string | null; is_active: boolean };
type Tx = { id: string; member_id: string; transaction_date: string; transaction_type: 'deposit'|'withdrawal'; amount: number; savings_category: 'GS'|'LTS-New'|'Optional'; reference_no: string | null; notes: string | null };
const categories = [
  { value: 'GS', label: 'General Savings (GS)' },
  { value: 'LTS-New', label: 'LTS-New' },
  { value: 'Optional', label: 'Optional Savings' },
] as const;
const todayText = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
};
const money = (n: number) => '৳' + Number(n || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function SavingsModule({ samities, canDo, openingOnly = false }: Props) {
  const [members, setMembers] = useState<Member[]>([]);
  const [memberId, setMemberId] = useState('');
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [opening, setOpening] = useState<OpeningBalance | null>(null);
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [category, setCategory] = useState<'GS'|'LTS-New'|'Optional'>('GS');
  const [transactionType, setTransactionType] = useState<'deposit'|'withdrawal'>('deposit');
  const [transactionDate, setTransactionDate] = useState(todayText());
  const [amount, setAmount] = useState('');
  const [referenceNo, setReferenceNo] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [userId, setUserId] = useState('');
  const [openingForm, setOpeningForm] = useState({gs:'0',lts:'0',optional:'0',date:todayText(),reference:'',notes:''});
  const [openingBusy, setOpeningBusy] = useState(false);
  const [openingNotice, setOpeningNotice] = useState('');
  const [openingLoans,setOpeningLoans]=useState<OpeningLoan[]>([]);
  const [loanForm,setLoanForm]=useState({loan_no:'',disbursement_date:todayText(),project_name:'',loan_cycle:'1',principal_amount:'',service_charge_amount:'0',amount_repaid_to_date:'0',current_status:'active' as 'active'|'closed'|'written_off',overdue_balance:'0',last_installment_no:'0',last_installment_date:'',reference_no:'',notes:''});
  const [editingLoanId,setEditingLoanId]=useState('');
  const [loanBusy,setLoanBusy]=useState(false);
  const [loanNotice,setLoanNotice]=useState('');
  const [openingClosures,setOpeningClosures]=useState<string[]>([]);
  const [openingHolidays,setOpeningHolidays]=useState<any[]>([]);
  const [openingFridayEnabled,setOpeningFridayEnabled]=useState(true);

  const canView = openingOnly ? (canDo('opening_data','view') || canDo('opening_data','create') || canDo('opening_data','update')) : (canDo('savings','view') || canDo('savings','create'));
  const canCreate = canDo('savings','create');

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase) return;
      setLoading(true);
      const [{ data: auth }, memberResult] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('members').select('id,member_code,full_name,samity_id,branch_id,is_active').eq('is_active',true).order('member_code'),
      ]);
      if (!live) return;
      setUserId(auth.user?.id || '');
      if (memberResult.error) setNotice('সদস্য তালিকা পড়া যায়নি: ' + memberResult.error.message);
      else setMembers(memberResult.data || []);
      setLoading(false);
    })();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase || !memberId) {
        setTransactions([]);
        setOpening(null);
        setEnrollments([]);
        setOpeningLoans([]);
        return;
      }
      setLoading(true);
      const [txResult, enrollmentResult, openingResult] = await Promise.all([
        openingOnly ? Promise.resolve({data: [], error: null}) : supabase.from('savings_transactions')
          .select('id,member_id,transaction_date,transaction_type,amount,savings_category,reference_no,notes')
          .eq('member_id', memberId).order('transaction_date', { ascending: false }).order('created_at', { ascending: false }),
        supabase.from('member_savings_enrollments')
          .select('id,savings_type,amount,term_months,product_name_snapshot')
          .eq('member_id', memberId),
        supabase.from('member_savings_opening_balances').select('member_id,gs_balance,lts_new_balance,optional_balance,opening_date').eq('member_id',memberId).maybeSingle(),
      ]);
      if (!live) return;
      if (txResult.error) setNotice('সঞ্চয় লেনদেন পড়া যায়নি: ' + txResult.error.message);
      else setTransactions((txResult.data || []) as Tx[]);
      if (enrollmentResult.error) setNotice('সঞ্চয় সংযুক্তির তথ্য পড়া যায়নি: ' + enrollmentResult.error.message);
      else setEnrollments(enrollmentResult.data || []);
      if (openingResult.error) setNotice('Opening Balance পড়া যায়নি: ' + openingResult.error.message);
      else setOpening(openingResult.data || null);
      if (openingOnly) {
        const loanResult = await supabase.from('member_opening_loans').select('*').eq('member_id', memberId).order('disbursement_date', { ascending: false });
        if (!live) return;
        if (loanResult.error) setNotice('প্রারম্ভিক ঋণের তথ্য পড়া যায়নি: ' + loanResult.error.message);
        else setOpeningLoans((loanResult.data || []) as OpeningLoan[]);
      } else {
        setOpeningLoans([]);
      }
      setLoading(false);
    })();
    return () => { live = false; };
  }, [memberId,openingOnly]);

  useEffect(() => {
    if(!openingOnly||!supabase||!selectedSamity){setOpeningClosures([]);setOpeningHolidays([]);return;}
    let live=true;
    (async()=>{
      const [cr,hr,fr]=await Promise.all([
        supabase.from('samity_week_closures').select('closure_date').eq('samity_id',selectedSamity.id),
        supabase.from('holiday_calendar').select('scope,branch_id,samity_id,date_from,date_to,is_active').eq('is_active',true),
        supabase.from('holiday_calendar_settings').select('friday_holiday_enabled').eq('id',1).maybeSingle()
      ]);
      if(!live)return;
      setOpeningClosures((cr.data||[]).map((x:any)=>x.closure_date));
      setOpeningHolidays(hr.data||[]);
      if(!fr.error&&fr.data)setOpeningFridayEnabled(Boolean(fr.data.friday_holiday_enabled));
    })();
    return()=>{live=false;};
  },[openingOnly,selectedSamity?.id]);

  useEffect(() => {
    setOpeningForm(opening ? {
      gs: String(opening.gs_balance ?? 0),
      lts: String(opening.lts_new_balance ?? 0),
      optional: String(opening.optional_balance ?? 0),
      date: opening.opening_date || todayText(),
      reference: '',
      notes: '',
    } : {gs:'0',lts:'0',optional:'0',date:todayText(),reference:'',notes:''});
    setOpeningNotice('');
  }, [opening, memberId]);

  const selectedMember = members.find(m => m.id === memberId);
  const selectedSamity = samities.find(m => m.id === selectedMember?.samity_id);
  const samity = samities.find(s => s.id === selectedMember?.samity_id);
  const balances = useMemo(() => {
    const result: Record<string, number> = { GS: Number(opening?.gs_balance||0), 'LTS-New': Number(opening?.lts_new_balance||0), Optional: Number(opening?.optional_balance||0) };
    transactions.forEach(tx => {
      result[tx.savings_category] = (result[tx.savings_category] || 0) +
        (tx.transaction_type === 'deposit' ? 1 : -1) * Number(tx.amount || 0);
    });
    return result;
  }, [transactions, opening]);
  const optionalEnrolled = enrollments.some(x => x.savings_type === 'optional');
  const visibleMembers = members.filter(m => {
    const term = search.trim().toLowerCase();
    return !term || m.member_code.toLowerCase().includes(term) || m.full_name.toLowerCase().includes(term);
  });
  const selectedBalance = balances[category] || 0;

  async function saveTransaction(e: FormEvent) {
    e.preventDefault();
    setNotice('');
    const value = Number(amount);
    if (!canCreate) { setNotice('সঞ্চয় লেনদেন এন্ট্রির অনুমতি নেই।'); return; }
    if (!supabase || !memberId || !userId) { setNotice('সদস্য বা ব্যবহারকারীর তথ্য পাওয়া যায়নি।'); return; }
    if (!Number.isFinite(value) || value <= 0) { setNotice('সঠিক টাকার পরিমাণ লিখুন।'); return; }
    if (transactionType === 'withdrawal' && value > selectedBalance) {
      setNotice('উত্তোলনের পরিমাণ বর্তমান স্থিতির বেশি হতে পারবে না।'); return;
    }
    if (category === 'Optional' && !optionalEnrolled) {
      setNotice('এই সদস্য Optional Savings-এ অন্তর্ভুক্ত নন।'); return;
    }
    setBusy(true);
    const result = await supabase.from('savings_transactions').insert({
      member_id: memberId,
      transaction_date: transactionDate,
      transaction_type: transactionType,
      amount: value,
      savings_category: category,
      reference_no: referenceNo.trim() || null,
      notes: notes.trim() || null,
      created_by: userId,
    });
    setBusy(false);
    if (result.error) { setNotice('লেনদেন সংরক্ষণ হয়নি: ' + result.error.message); return; }
    setAmount(''); setReferenceNo(''); setNotes('');
    setNotice(transactionType === 'deposit' ? 'সঞ্চয় জমা সংরক্ষণ হয়েছে।' : 'সঞ্চয় উত্তোলন সংরক্ষণ হয়েছে।');
    const refreshed = await supabase.from('savings_transactions')
      .select('id,member_id,transaction_date,transaction_type,amount,savings_category,reference_no,notes')
      .eq('member_id', memberId).order('transaction_date', { ascending: false }).order('created_at', { ascending: false });
    if (!refreshed.error) setTransactions((refreshed.data || []) as Tx[]);
  }


  async function saveOpeningBalance(e: FormEvent) {
    e.preventDefault(); setOpeningNotice('');
    if (!supabase || !memberId || !userId) { setOpeningNotice('সদস্য বা ব্যবহারকারীর তথ্য পাওয়া যায়নি।'); return; }
    if (opening !== null ? !canDo('opening_data','update') : !canDo('opening_data','create')) { setOpeningNotice(opening !== null ? 'বিদ্যমান Opening Balance পরিবর্তনের অনুমতি নেই।' : 'নতুন Opening Balance এন্ট্রির অনুমতি নেই।'); return; }
    const gs=Number(openingForm.gs), lts=Number(openingForm.lts), optional=Number(openingForm.optional);
    if ([gs,lts,optional].some(v=>!Number.isFinite(v)||v<0)) { setOpeningNotice('শূন্য বা তার বেশি সঠিক পরিমাণ লিখুন।'); return; }
    if (optional>0 && !optionalEnrolled) { setOpeningNotice('Optional balance দিতে হলে সদস্য Optional Savings-এ অন্তর্ভুক্ত থাকতে হবে।'); return; }
    setOpeningBusy(true);
    const result=await supabase.from('member_savings_opening_balances').upsert({member_id:memberId,opening_date:openingForm.date,gs_balance:gs,lts_new_balance:lts,optional_balance:optional,reference_no:openingForm.reference.trim()||null,notes:openingForm.notes.trim()||null,created_by:userId,updated_by:userId},{onConflict:'member_id'});
    setOpeningBusy(false);
    if(result.error){setOpeningNotice('Opening balance সংরক্ষণ হয়নি: '+result.error.message);return;}
    setOpeningNotice('Opening Balance সংরক্ষিত হয়েছে।');
    const refreshed=await supabase.from('member_savings_opening_balances').select('member_id,gs_balance,lts_new_balance,optional_balance,opening_date').eq('member_id',memberId).maybeSingle();
    if(!refreshed.error)setOpening(refreshed.data||null);
  }

  function resetLoanForm(){
    setEditingLoanId('');
    setLoanForm({loan_no:'',disbursement_date:todayText(),project_name:'',loan_cycle:'1',principal_amount:'',service_charge_amount:'0',amount_repaid_to_date:'0',current_status:'active',overdue_balance:'0',last_installment_no:'0',last_installment_date:'',reference_no:'',notes:''});
    setLoanNotice('');
  }
  function editOpeningLoan(loan:OpeningLoan){
    setEditingLoanId(loan.id);
    setLoanForm({loan_no:loan.loan_no,disbursement_date:loan.disbursement_date,project_name:loan.project_name,loan_cycle:String(loan.loan_cycle),principal_amount:String(loan.principal_amount),service_charge_amount:String(loan.service_charge_amount),amount_repaid_to_date:String(loan.amount_repaid_to_date),current_status:loan.current_status,overdue_balance:String(loan.overdue_balance||0),last_installment_no:String(loan.last_installment_no),last_installment_date:loan.last_installment_date||'',reference_no:loan.reference_no||'',notes:loan.notes||''});
    setLoanNotice('');
  }
  async function saveOpeningLoan(e:FormEvent){
    e.preventDefault();setLoanNotice('');
    if(!supabase||!memberId||!userId){setLoanNotice('সদস্য বা ব্যবহারকারীর তথ্য পাওয়া যায়নি।');return;}
    if(editingLoanId?!canDo('opening_data','update'):!canDo('opening_data','create')){setLoanNotice('এই ঋণ তথ্য সংরক্ষণ/পরিবর্তনের অনুমতি নেই।');return;}
    const principal=Number(loanForm.principal_amount),charge=Number(loanForm.service_charge_amount),repaid=Number(loanForm.amount_repaid_to_date),arrears=Number(loanForm.overdue_balance),cycle=Number(loanForm.loan_cycle),last=Number(loanForm.last_installment_no);
    if(!loanForm.loan_no.trim()||!loanForm.project_name.trim()||!loanForm.disbursement_date||![principal,charge,repaid,arrears,cycle,last].every(Number.isFinite)||principal<1000||principal>200000||principal%1000!==0||charge<0||repaid<0||arrears<0||cycle<1||last<0||last>46||repaid>principal+charge||(last>0&&!loanForm.last_installment_date)){setLoanNotice('ঋণের তথ্য যাচাই করুন। আসল ঋণ ১,০০০–২,০০,০০০ টাকার মধ্যে ১,০০০ টাকার গুণিতক হতে হবে; সর্বশেষ কিস্তি নম্বর ০–৪৬ এবং কিস্তি নম্বর ০-এর বেশি হলে সর্বশেষ কিস্তির তারিখ দিতে হবে।');return;}
    if(loanForm.current_status==='closed'&&principal+charge-repaid>0){setLoanNotice('ঋণের অবশিষ্ট স্থিতি শূন্য না হলে বন্ধ অবস্থা নির্বাচন করা যাবে না।');return;}
    if(!selectedSamity||!Number.isInteger(Number(selectedSamity.meeting_day))){setLoanNotice('সদস্যের সমিতির সভার দিন নির্ধারিত নেই।');return;}
    const relevantHolidays=openingHolidays.filter(h=>h.is_active&&(h.scope==='organization'||(h.scope==='branch'&&h.branch_id===selectedSamity.branch_id)||(h.scope==='samity'&&h.samity_id===selectedSamity.id)));
    const closedDates=[...openingClosures];
    for(const h of relevantHolidays){const d=new Date(h.date_from+'T12:00:00'),end=new Date(h.date_to+'T12:00:00');while(d<=end){closedDates.push([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')).join('-'));d.setDate(d.getDate()+1);}}
    if(openingFridayEnabled){const d=new Date(loanForm.disbursement_date+'T12:00:00'),end=new Date(d);end.setDate(end.getDate()+46*7+60);for(;d<=end;d.setDate(d.getDate()+1))if(d.getDay()===5)closedDates.push([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')).join('-');}
    let nextInstallmentDate:string|null=null;
    let generatedSchedule:any[]=[];
    const remainingBalance=Math.max(0,principal+charge-repaid);
    const nextCollectibleBalance=Math.max(0,remainingBalance-arrears);
    if(loanForm.current_status==='active'&&last<46&&nextCollectibleBalance>0){
      try{
        const allRows=calculateLoanSchedule(principal);
        let firstDate:string;
        if(last===0)firstDate=calculateFirstInstallmentDate(loanForm.disbursement_date,Number(selectedSamity.meeting_day),closedDates);
        else{
          const d=new Date(loanForm.last_installment_date+'T12:00:00');
          if(Number.isNaN(d.getTime())||d.getDay()!==Number(selectedSamity.meeting_day))throw new Error('সর্বশেষ কিস্তির তারিখ সমিতির সভার দিনের সঙ্গে মিলতে হবে।');
          d.setDate(d.getDate()+7);
          while(closedDates.includes([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate())].join('-')))d.setDate(d.getDate()+7);
          firstDate=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate())].join('-');
        }
        const dates=buildInstallmentDates(firstDate,Number(selectedSamity.meeting_day),closedDates).slice(0,46-last);
        const remainingRows=allRows.filter(x=>x.weekNo>last);
        const rawTotal=remainingRows.reduce((sum,x)=>sum+x.totalDue,0);
        let allocated=0;
        generatedSchedule=remainingRows.map((row,index)=>{
          const total=index===remainingRows.length-1?Math.max(0,nextCollectibleBalance-allocated):nextCollectibleBalance*row.totalDue/rawTotal;
          allocated+=total;
          const principalPart=row.totalDue?total*row.principalDue/row.totalDue:0;
          return {installment_no:row.weekNo,due_date:dates[index],principal_due:principalPart,service_charge_due:total-principalPart,total_due:total,status:'due'};
        });
        nextInstallmentDate=dates[0]||null;
      }catch(err){setLoanNotice(err instanceof Error?err.message:'ঋণ সিডিউল তৈরি করা যাচ্ছে না।');return;}
    }
    if(loanForm.current_status==='closed'&&remainingBalance>0){setLoanNotice('ঋণের অবশিষ্ট স্থিতি শূন্য না হলে বন্ধ করা যাবে না।');return;}
    setLoanBusy(true);
    const payload={member_id:memberId,loan_no:loanForm.loan_no.trim(),disbursement_date:loanForm.disbursement_date,project_name:loanForm.project_name.trim(),loan_cycle:cycle,principal_amount:principal,service_charge_amount:charge,amount_repaid_to_date:repaid,current_status:loanForm.current_status,overdue_balance:arrears,last_installment_no:last,last_installment_date:loanForm.last_installment_date||null,reference_no:loanForm.reference_no.trim()||null,notes:loanForm.notes.trim()||null,...(editingLoanId?{updated_by:userId}:{created_by:userId})};
    const payloadWithDates={...payload,next_installment_date:nextInstallmentDate,next_collectible_balance:nextCollectibleBalance};
    const result=editingLoanId?await supabase.from('member_opening_loans').update(payloadWithDates).eq('id',editingLoanId):await supabase.from('member_opening_loans').insert(payloadWithDates).select('id').single();
    setLoanBusy(false);
    if(result.error){setLoanNotice('ঋণের তথ্য সংরক্ষণ হয়নি: '+result.error.message);return;}
    const savedLoanId=editingLoanId||result.data?.id;
    if(savedLoanId){
      const deleted=await supabase.from('member_opening_loan_installment_schedule').delete().eq('opening_loan_id',savedLoanId);
      if(deleted.error){setLoanNotice('ঋণের তথ্য সংরক্ষিত হয়েছে, কিন্তু পুরোনো সিডিউল পরিবর্তন করা যায়নি: '+deleted.error.message);return;}
      if(generatedSchedule.length){
        const inserted=await supabase.from('member_opening_loan_installment_schedule').insert(generatedSchedule.map(row=>({...row,opening_loan_id:savedLoanId})));
        if(inserted.error){setLoanNotice('ঋণের তথ্য সংরক্ষিত হয়েছে, কিন্তু সিডিউল সংরক্ষণ হয়নি: '+inserted.error.message);return;}
      }
    }
    setLoanNotice('প্রারম্ভিক ঋণের তথ্য ও অবশিষ্ট কিস্তির সিডিউল সংরক্ষিত হয়েছে।');resetLoanForm();
    const refreshed=await supabase.from('member_opening_loans').select('*').eq('member_id',memberId).order('disbursement_date',{ascending:false});
    if(!refreshed.error)setOpeningLoans((refreshed.data||[]) as OpeningLoan[]);
  }

  if (!canView) return <section className="panel"><h2>অনুমতি প্রয়োজন</h2><p>সঞ্চয় হিসাব দেখার অনুমতি নেই। Main Admin-এর কাছে Savings permission চান।</p></section>;

  return <section className="workspace">
    <div className="section-head"><div><p className="eyebrow">{openingOnly ? 'OPENING DATA INPUT' : 'MEMBER SAVINGS LEDGER'}</p><h2>{openingOnly ? 'প্রারম্ভিক সঞ্চয় স্থিতি এন্ট্রি' : 'সদস্যভিত্তিক সঞ্চয় জমা ও উত্তোলন'}</h2><p>{openingOnly ? 'সদস্যের পূর্ববর্তী GS, LTS-New ও Optional Savings ব্যালেন্স সংরক্ষণ করুন।' : 'GS, LTS-New ও Optional Savings-এর পৃথক স্থিতি ও লেনদেনের ইতিহাস।'}</p></div></div>
    {notice && <div className="notice">{notice}</div>}
    <div className="form-grid">
      <label>সদস্য খুঁজুন<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="সদস্য কোড বা নাম লিখুন"/></label>
      <label>সদস্য নির্বাচন করুন *<select value={memberId} onChange={e=>{setMemberId(e.target.value);setNotice('');}}><option value="">সদস্য নির্বাচন</option>{visibleMembers.map(m=><option key={m.id} value={m.id}>{m.member_code} — {m.full_name}</option>)}</select></label>
    </div>
    {selectedMember && <>
      <div className="panel">
        <b>{selectedMember.member_code} — {selectedMember.full_name}</b>
        <p className="muted">সমিতি: {samity ? samity.samity_code + ' — ' + samity.samity_name : 'তথ্য নেই'}</p>
        <div className="stats-grid">
          {categories.map(c=><div className="stat-card" key={c.value}><span>{c.label}</span><strong>{money(balances[c.value])}</strong></div>)}
        </div>
      </div>
      {openingOnly && (canDo('opening_data','create') || canDo('opening_data','update')) && <form className="employee-form" onSubmit={saveOpeningBalance}>
        <h3>Opening Data Input — প্রারম্ভিক সঞ্চয় স্থিতি</h3>
        <p className="muted">প্রারম্ভিক GS, LTS-New ও Optional ব্যালেন্স আলাদা সংরক্ষণ হবে।</p>
        <div className="form-grid">
          <label>Opening Date *<input type="date" required value={openingForm.date} onChange={e=>setOpeningForm({...openingForm,date:e.target.value})}/></label>
          <label>GS Opening Balance *<input type="number" min="0" step="0.01" required value={openingForm.gs} onChange={e=>setOpeningForm({...openingForm,gs:e.target.value})}/></label>
          <label>LTS-New Opening Balance *<input type="number" min="0" step="0.01" required value={openingForm.lts} onChange={e=>setOpeningForm({...openingForm,lts:e.target.value})}/></label>
          <label>Optional Opening Balance *<input type="number" min="0" step="0.01" required value={openingForm.optional} onChange={e=>setOpeningForm({...openingForm,optional:e.target.value})}/></label>
          <label>Reference<input value={openingForm.reference} onChange={e=>setOpeningForm({...openingForm,reference:e.target.value})}/></label>
          <label>Remarks<input value={openingForm.notes} onChange={e=>setOpeningForm({...openingForm,notes:e.target.value})}/></label>
        </div>
        {openingNotice && <div className="notice">{openingNotice}</div>}
        <div className="form-actions"><button disabled={openingBusy||!memberId}>{openingBusy?'সংরক্ষণ হচ্ছে...':'Opening Balance সংরক্ষণ'}</button></div>
      </form>}
      {openingOnly && <section className="panel">
        <h3>প্রারম্ভিক ঋণের তথ্য</h3>
        <p className="muted">প্রতিটি পুরোনো ঋণ আলাদা করে এন্ট্রি করুন। অবশিষ্ট স্থিতি আসল ঋণ + সেবামূল্য − এ পর্যন্ত আদায় থেকে হিসাব হবে। বকেয়া স্থিতি আলাদাভাবে লিখতে হবে।</p>
        {(canDo('opening_data','create')||canDo('opening_data','update'))&&<form className="employee-form" onSubmit={saveOpeningLoan}>
          <div className="form-grid">
            <label>ঋণ নম্বর *<input required value={loanForm.loan_no} onChange={e=>setLoanForm({...loanForm,loan_no:e.target.value})}/></label>
            <label>ঋণ বিতরণের তারিখ *<input type="date" required value={loanForm.disbursement_date} onChange={e=>setLoanForm({...loanForm,disbursement_date:e.target.value})}/></label>
            <label>প্রকল্পের নাম *<input required value={loanForm.project_name} onChange={e=>setLoanForm({...loanForm,project_name:e.target.value})}/></label>
            <label>কততম দফা *<input type="number" min="1" step="1" required value={loanForm.loan_cycle} onChange={e=>setLoanForm({...loanForm,loan_cycle:e.target.value})}/></label>
            <label>আসল ঋণ *<input type="number" min="0.01" step="0.01" required value={loanForm.principal_amount} onChange={e=>setLoanForm({...loanForm,principal_amount:e.target.value})}/></label>
            <label>সেবামূল্য *<input type="number" min="0" step="0.01" required value={loanForm.service_charge_amount} onChange={e=>setLoanForm({...loanForm,service_charge_amount:e.target.value})}/></label>
            <label>এ পর্যন্ত আদায় *<input type="number" min="0" step="0.01" required value={loanForm.amount_repaid_to_date} onChange={e=>setLoanForm({...loanForm,amount_repaid_to_date:e.target.value})}/></label>
            <label>বর্তমান অবস্থা *<select value={loanForm.current_status} onChange={e=>setLoanForm({...loanForm,current_status:e.target.value as any})}><option value="active">চলমান</option><option value="closed">বন্ধ</option><option value="written_off">অবলোপন</option></select></label>
            <label>বকেয়া স্থিতি *<input type="number" min="0" step="0.01" required value={loanForm.overdue_balance} onChange={e=>setLoanForm({...loanForm,overdue_balance:e.target.value})}/></label>
            <label>সর্বশেষ কিস্তি নম্বর *<input type="number" min="0" max="46" step="1" required value={loanForm.last_installment_no} onChange={e=>setLoanForm({...loanForm,last_installment_no:e.target.value})}/></label>
            <label>সর্বশেষ কিস্তির তারিখ {Number(loanForm.last_installment_no)>0?'*':''}<input type="date" required={Number(loanForm.last_installment_no)>0} value={loanForm.last_installment_date} onChange={e=>setLoanForm({...loanForm,last_installment_date:e.target.value})}/></label>
            <label>রেফারেন্স নম্বর<input value={loanForm.reference_no} onChange={e=>setLoanForm({...loanForm,reference_no:e.target.value})}/></label>
            <label>মন্তব্য<input value={loanForm.notes} onChange={e=>setLoanForm({...loanForm,notes:e.target.value})}/></label>
          </div>
          <p className="muted">মোট অবশিষ্ট ঋণ স্থিতি: <b>{money(Math.max(0,Number(loanForm.principal_amount||0)+Number(loanForm.service_charge_amount||0)-Number(loanForm.amount_repaid_to_date||0)))}</b> · খেলাপী/ডিউ বাদে পরবর্তী আদায়যোগ্য: <b>{money(Math.max(0,Number(loanForm.principal_amount||0)+Number(loanForm.service_charge_amount||0)-Number(loanForm.amount_repaid_to_date||0)-Number(loanForm.overdue_balance||0)))}</b></p>
          <p className="muted">পরবর্তী কিস্তির তারিখ (স্বয়ংক্রিয়): <b>{(()=>{const n=Number(loanForm.last_installment_no);if(!selectedSamity||n>=46||loanForm.current_status!=='active')return '—';try{const closed=[...openingClosures];const relevant=openingHolidays.filter(h=>h.is_active&&(h.scope==='organization'||(h.scope==='branch'&&h.branch_id===selectedSamity.branch_id)||(h.scope==='samity'&&h.samity_id===selectedSamity.id)));for(const h of relevant){const d=new Date(h.date_from+'T12:00:00'),e=new Date(h.date_to+'T12:00:00');while(d<=e){closed.push([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')).join('-'));d.setDate(d.getDate()+1);}}if(n===0)return calculateFirstInstallmentDate(loanForm.disbursement_date,Number(selectedSamity.meeting_day),closed);const d=new Date(loanForm.last_installment_date+'T12:00:00');d.setDate(d.getDate()+7);while(closed.includes([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate())].join('-')))d.setDate(d.getDate()+7);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate())].join('-');}catch{return 'তারিখ নির্ধারণের জন্য তথ্য অসম্পূর্ণ';}})()}</b></p>
          {loanNotice&&<div className="notice">{loanNotice}</div>}
          <div className="form-actions"><button disabled={loanBusy}>{loanBusy?'সংরক্ষণ হচ্ছে...':editingLoanId?'ঋণের তথ্য হালনাগাদ':'ঋণের তথ্য সংরক্ষণ'}</button>{editingLoanId&&<button type="button" className="secondary" onClick={resetLoanForm}>বাতিল</button>}</div>
        </form>}
        <h3>সংরক্ষিত প্রারম্ভিক ঋণ</h3>
        <div className="table-wrap"><table><thead><tr><th>ঋণ নম্বর</th><th>বিতরণের তারিখ</th><th>প্রকল্প</th><th>দফা</th><th>আসল</th><th>সেবামূল্য</th><th>এ পর্যন্ত আদায়</th><th>বর্তমান অবশিষ্ট</th><th>বকেয়া</th><th>অবস্থা</th><th>শেষ কিস্তি</th><th>শেষ কিস্তির তারিখ</th><th>পরবর্তী কিস্তি</th><th>পরবর্তী আদায়যোগ্য</th><th>কাজ</th></tr></thead><tbody>
          {openingLoans.map(loan=><tr key={loan.id}><td>{loan.loan_no}</td><td>{loan.disbursement_date}</td><td>{loan.project_name}</td><td>{loan.loan_cycle}</td><td>{money(Number(loan.principal_amount))}</td><td>{money(Number(loan.service_charge_amount))}</td><td>{money(Number(loan.amount_repaid_to_date))}</td><td>{money(Number(loan.outstanding_balance))}</td><td>{money(Number(loan.overdue_balance))}</td><td>{loan.current_status==='active'?'চলমান':loan.current_status==='closed'?'বন্ধ':'অবলোপন'}</td><td>{loan.last_installment_no}</td><td>{loan.last_installment_date||'—'}</td><td>{loan.next_installment_date||'—'}</td><td>{money(Number(loan.next_collectible_balance||0))}</td><td>{canDo('opening_data','update')&&<button type="button" className="secondary" onClick={()=>editOpeningLoan(loan)}>সম্পাদনা</button>}</td></tr>)}
          {openingLoans.length===0&&<tr><td colSpan={15} className="empty">এখনও কোনো প্রারম্ভিক ঋণ এন্ট্রি করা হয়নি।</td></tr>}
        </tbody></table></div>
      </section>}
      {!openingOnly && canCreate && <form className="employee-form" onSubmit={saveTransaction}>
        <h3>নতুন সঞ্চয় লেনদেন</h3>
        <div className="form-grid">
          <label>লেনদেনের ধরন *<select value={transactionType} onChange={e=>setTransactionType(e.target.value as 'deposit'|'withdrawal')}><option value="deposit">জমা</option><option value="withdrawal">উত্তোলন</option></select></label>
          <label>সঞ্চয়ের ধরন *<select value={category} onChange={e=>setCategory(e.target.value as 'GS'|'LTS-New'|'Optional')}><option value="GS">General Savings (GS)</option><option value="LTS-New">LTS-New</option><option value="Optional" disabled={!optionalEnrolled}>Optional Savings{!optionalEnrolled?' (সদস্য অন্তর্ভুক্ত নন)':''}</option></select></label>
          <label>তারিখ *<input type="date" required value={transactionDate} onChange={e=>setTransactionDate(e.target.value)} /></label>
          <label>টাকার পরিমাণ *<input type="number" min="0.01" step="0.01" required value={amount} onChange={e=>setAmount(e.target.value)} placeholder="টাকার পরিমাণ"/></label>
          <label>রেফারেন্স নম্বর<input value={referenceNo} onChange={e=>setReferenceNo(e.target.value)} placeholder="রসিদ/ভাউচার নম্বর"/></label>
          <label>মন্তব্য<input value={notes} onChange={e=>setNotes(e.target.value)} placeholder="প্রয়োজন হলে লিখুন"/></label>
        </div>
        <p className="muted">নির্বাচিত সঞ্চয়ের বর্তমান স্থিতি: <b>{money(selectedBalance)}</b>{transactionType==='withdrawal'?' — এর বেশি উত্তোলন করা যাবে না.':''}</p>
        <div className="form-actions"><button disabled={busy || !memberId}>{busy?'সংরক্ষণ হচ্ছে...':transactionType==='deposit'?'জমা সংরক্ষণ করুন':'উত্তোলন সংরক্ষণ করুন'}</button></div>
      </form>}
      {!openingOnly && <h3>লেনদেনের ইতিহাস</h3>}
      {!openingOnly && <div className="table-wrap"><table><thead><tr><th>তারিখ</th><th>ধরন</th><th>সঞ্চয়</th><th>জমা</th><th>উত্তোলন</th><th>রেফারেন্স</th><th>মন্তব্য</th></tr></thead><tbody>
        {transactions.map(tx=><tr key={tx.id}><td>{tx.transaction_date}</td><td>{tx.transaction_type==='deposit'?'জমা':'উত্তোলন'}</td><td>{categories.find(c=>c.value===tx.savings_category)?.label || tx.savings_category}</td><td>{tx.transaction_type==='deposit'?money(Number(tx.amount)): '—'}</td><td>{tx.transaction_type==='withdrawal'?money(Number(tx.amount)): '—'}</td><td>{tx.reference_no || '—'}</td><td>{tx.notes || '—'}</td></tr>)}
        {transactions.length===0 && <tr><td colSpan={7} className="empty">{loading?'তথ্য লোড হচ্ছে...':'এখনও কোনো সঞ্চয় লেনদেন নেই।'}</td></tr>}
      </tbody></table></div>}
    </>}
    {!selectedMember && <div className="panel muted">{loading?'সদস্য তালিকা লোড হচ্ছে...':'সঞ্চয় হিসাব দেখতে একজন সদস্য নির্বাচন করুন।'}</div>}
    <p className="muted">লেনদেন সংরক্ষণের পর রেকর্ড সরাসরি ledger-এ যুক্ত হয়। ভুল সংশোধন অনুমোদিত correction workflow-এর মাধ্যমে করা হবে; এই পর্দা থেকে পুরোনো লেনদেন মুছে ফেলা যায় না।</p>
  </section>;
}
