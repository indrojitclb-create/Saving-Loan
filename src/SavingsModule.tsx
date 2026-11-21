import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from './lib/supabase';

type Props = { canDo: (moduleKey:string, action:'view'|'create'|'update'|'delete')=>boolean };
type Member = {id:string;member_code:string;full_name:string;phone?:string|null};
type Enrollment = {id:string;member_id:string;savings_type:'mandatory'|'optional';amount:number;term_months?:number|null;product_name_snapshot?:string|null;product?:{product_name?:string}|null};
type Tx = {id:string;member_id:string;enrollment_id?:string|null;savings_type?:string;transaction_date:string;transaction_type:'deposit'|'withdrawal';amount:number;reference_no?:string|null;notes?:string|null;created_at:string};

export default function SavingsModule({canDo}:Props){
 const [members,setMembers]=useState<Member[]>([]);
 const [enrollments,setEnrollments]=useState<Enrollment[]>([]);
 const [transactions,setTransactions]=useState<Tx[]>([]);
 const [memberId,setMemberId]=useState('');
 const [enrollmentId,setEnrollmentId]=useState('');
 const [kind,setKind]=useState<'deposit'|'withdrawal'>('deposit');
 const [amount,setAmount]=useState('');
 const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [reference,setReference]=useState('');
 const [notes,setNotes]=useState('');
 const [search,setSearch]=useState('');
 const [notice,setNotice]=useState('');
 const [busy,setBusy]=useState(false);
 const db:any=supabase;
 const selectedMember=members.find(m=>m.id===memberId);
 const memberEnrollments=enrollments.filter(e=>e.member_id===memberId);
 const selectedEnrollment=memberEnrollments.find(e=>e.id===enrollmentId);
 const visibleTransactions=useMemo(()=>transactions.filter(t=>t.member_id===memberId && (!enrollmentId || t.enrollment_id===enrollmentId || (memberEnrollments.find(e=>e.id===enrollmentId)?.savings_type==='mandatory' && t.savings_type==='mandatory'))).sort((a,b)=>b.transaction_date.localeCompare(a.transaction_date)||b.created_at.localeCompare(a.created_at)),[transactions,memberId,enrollmentId,enrollments]);
 const balance=visibleTransactions.reduce((n,t)=>n+(t.transaction_type==='deposit'?Number(t.amount):-Number(t.amount)),0);
 const filteredMembers=members.filter(m=>[m.member_code,m.full_name,m.phone].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())));
 async function refresh(){
  if(!db)return;
  const [m,e,t]=await Promise.all([
   db.from('members').select('id,member_code,full_name,phone').eq('is_active',true).order('member_code'),
   db.from('member_savings_enrollments').select('id,member_id,savings_type,amount,term_months,product_name_snapshot,product:optional_savings_products(product_name)').order('created_at'),
   db.from('savings_transactions').select('id,member_id,enrollment_id,savings_type,transaction_date,transaction_type,amount,reference_no,notes,created_at').order('transaction_date',{ascending:false}).limit(1000)
  ]);
  if(m.error)setNotice('সদস্য তালিকা পড়া যায়নি: '+m.error.message);else setMembers(m.data||[]);
  if(e.error)setNotice('সঞ্চয় হিসাব পড়া যায়নি: '+e.error.message);else setEnrollments(e.data||[]);
  if(t.error)setNotice('লেনদেনের ইতিহাস পড়া যায়নি: '+t.error.message);else setTransactions(t.data||[]);
 }
 useEffect(()=>{refresh();},[]);
 useEffect(()=>{setEnrollmentId(memberEnrollments[0]?.id||'');},[memberId,enrollments.length]);
 async function save(e:FormEvent){
  e.preventDefault();
  if(!canDo('savings','create')){setNotice('সঞ্চয় লেনদেনের অনুমতি নেই।');return;}
  if(!memberId||!enrollmentId){setNotice('সদস্য ও সঞ্চয় হিসাব নির্বাচন করুন।');return;}
  const n=Number(amount);
  if(!Number.isFinite(n)||n<=0){setNotice('সঠিক টাকার পরিমাণ লিখুন।');return;}
  setBusy(true);setNotice('');
  try{
   const {error}=await db.rpc('save_savings_transaction',{
    p_member_id:memberId,p_enrollment_id:enrollmentId,p_transaction_date:date,
    p_transaction_type:kind,p_amount:n,p_reference_no:reference||null,p_notes:notes||null
   });
   if(error)throw error;
   setAmount('');setReference('');setNotes('');
   setNotice(kind==='deposit'?'সঞ্চয় জমা সফল হয়েছে।':'সঞ্চয় উত্তোলন সফল হয়েছে।');
   await refresh();
  }catch(err){setNotice('লেনদেন সংরক্ষণ হয়নি: '+(err instanceof Error?err.message:'অজানা সমস্যা'));}
  finally{setBusy(false);}
 }
 if(!canDo('savings','view')&&!canDo('savings','create'))return <section className="panel"><h2>সঞ্চয়</h2><p>এই মডিউল দেখার অনুমতি নেই।</p></section>;
 return <section className="workspace">
  <div className="panel"><p className="eyebrow">SAVINGS MANAGEMENT</p><h2>সদস্যভিত্তিক সঞ্চয় জমা ও উত্তোলন</h2><p className="muted">প্রতিটি লেনদেন আলাদা হিসাবের সঙ্গে যুক্ত থাকবে। আর্থিক লেনদেন মুছে ফেলা বা সরাসরি সম্পাদনা করা যাবে না।</p></div>
  <div className="panel">
   <label className="field">সদস্য খুঁজুন<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="সদস্য কোড / নাম / মোবাইল"/></label>
   <label className="field">সদস্য নির্বাচন করুন<select value={memberId} onChange={e=>setMemberId(e.target.value)}><option value="">সদস্য নির্বাচন</option>{filteredMembers.map(m=><option key={m.id} value={m.id}>{m.member_code} — {m.full_name}</option>)}</select></label>
   {selectedMember&&<><div className="form-grid">
    <label className="field">সঞ্চয়ের হিসাব<select value={enrollmentId} onChange={e=>setEnrollmentId(e.target.value)}><option value="">হিসাব নির্বাচন</option>{memberEnrollments.map(a=><option key={a.id} value={a.id}>{a.savings_type==='mandatory'?'বাধ্যতামূলক সঞ্চয়':'ঐচ্ছিক সঞ্চয়'}{a.product?.product_name||a.product_name_snapshot?' — '+(a.product?.product_name||a.product_name_snapshot):''} · ৳{Number(a.amount).toLocaleString('en-BD')}</option>)}</select></label>
    <div className="stat-card"><span>বর্তমান ব্যালেন্স</span><strong>৳ {balance.toLocaleString('en-BD',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></div>
   </div>
   {canDo('savings','create')&&<form onSubmit={save}><div className="form-grid">
    <label className="field">লেনদেনের ধরন<select value={kind} onChange={e=>setKind(e.target.value as 'deposit'|'withdrawal')}><option value="deposit">জমা</option><option value="withdrawal">উত্তোলন</option></select></label>
    <label className="field">টাকার পরিমাণ *<input required type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label className="field">লেনদেনের তারিখ *<input required type="date" max={new Date().toISOString().slice(0,10)} value={date} onChange={e=>setDate(e.target.value)}/></label>
    <label className="field">রসিদ / রেফারেন্স নম্বর<input value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <label className="field wide">মন্তব্য<textarea rows={2} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   </div><div className="form-actions"><button disabled={busy||!selectedEnrollment}>{busy?'সংরক্ষণ হচ্ছে...':'লেনদেন সংরক্ষণ করুন'}</button></div></form>}
   {memberEnrollments.length===0&&<p className="muted">এই সদস্যের কোনো সঞ্চয় হিসাব নেই। আগে সদস্য নিবন্ধন বা Savings Enrollment সম্পন্ন করুন।</p>}
   </>}
   {notice&&<p className="notice">{notice}</p>}
  </div>
  {selectedMember&&<div className="panel"><h3>লেনদেনের ইতিহাস — {selectedMember.full_name}</h3><div className="table-wrap"><table><thead><tr><th>তারিখ</th><th>ধরন</th><th>জমা</th><th>উত্তোলন</th><th>রেফারেন্স</th><th>মন্তব্য</th></tr></thead><tbody>
   {visibleTransactions.map(t=><tr key={t.id}><td>{t.transaction_date}</td><td>{t.savings_type==='optional'?'ঐচ্ছিক':'বাধ্যতামূলক'}</td><td>{t.transaction_type==='deposit'?'৳ '+Number(t.amount).toLocaleString('en-BD'):''}</td><td>{t.transaction_type==='withdrawal'?'৳ '+Number(t.amount).toLocaleString('en-BD'):''}</td><td>{t.reference_no||'—'}</td><td>{t.notes||'—'}</td></tr>)}
   {visibleTransactions.length===0&&<tr><td colSpan={6} className="empty">কোনো লেনদেন পাওয়া যায়নি।</td></tr>}
  </tbody></table></div></div>}
 </section>;
}
