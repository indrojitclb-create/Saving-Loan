import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

type Props={canDo:(moduleKey:string,action:'view'|'create'|'update'|'delete')=>boolean};
type Employee={id:string;employee_code:string;full_name:string;branch_id:string|null};
type Member={id:string;member_code:string;full_name:string;samity_id:string|null};
type Branch={id:string;branch_code:string;branch_name:string};
type Samity={id:string;samity_code:string;samity_name:string};
const today=()=>new Date().toISOString().slice(0,10);

export default function TransferModule({canDo}:Props){
 const [kind,setKind]=useState<'employee'|'member'>('employee');
 const [employees,setEmployees]=useState<Employee[]>([]);const [members,setMembers]=useState<Member[]>([]);
 const [branches,setBranches]=useState<Branch[]>([]);const [samities,setSamities]=useState<Samity[]>([]);
 const [employeeId,setEmployeeId]=useState('');const [memberId,setMemberId]=useState('');
 const [target,setTarget]=useState('');const [date,setDate]=useState(today());const [reason,setReason]=useState('');
 const [history,setHistory]=useState<any[]>([]);const [busy,setBusy]=useState(false);const [notice,setNotice]=useState('');
 const allowed=canDo(kind==='employee'?'employee_transfer':'member_transfer','view');
 async function load(){
  if(!supabase||!allowed)return;
  const [e,m,b,s,h1,h2]=await Promise.all([
   supabase.from('employees').select('id,employee_code,full_name,branch_id').eq('is_active',true).order('employee_code'),
   supabase.from('members').select('id,member_code,full_name,samity_id').eq('is_active',true).order('member_code'),
   supabase.from('branches').select('id,branch_code,branch_name').eq('is_active',true).order('branch_code'),
   supabase.from('samities').select('id,samity_code,samity_name').eq('status','active').order('samity_code'),
   supabase.from('employee_work_area_transfers').select('*').order('created_at',{ascending:false}).limit(100),
   supabase.from('member_samity_transfers').select('*').order('created_at',{ascending:false}).limit(100)
  ]);
  if(e.error||m.error||b.error||s.error){setNotice('তালিকা লোড হয়নি: '+(e.error||m.error||b.error||s.error)?.message);return;}
  setEmployees(e.data||[]);setMembers(m.data||[]);setBranches(b.data||[]);setSamities(s.data||[]);
  const historyError=kind==='employee'?h1.error:h2.error;
  if(historyError)setNotice('ইতিহাস লোড হয়নি: '+historyError.message);
  else setHistory((kind==='employee'?h1.data:h2.data)||[]);
 }
 useEffect(()=>{void load();},[kind]);
 async function save(ev:React.FormEvent){
  ev.preventDefault();if(!supabase)return;
  if(!canDo(kind==='employee'?'employee_transfer':'member_transfer','create')||!canDo(kind==='employee'?'employee_transfer':'member_transfer','update')){setNotice('স্থানান্তরের জন্য Create ও Update—দুই অনুমতি প্রয়োজন।');return;}
  const id=kind==='employee'?employeeId:memberId;
  const current=kind==='employee'?employees.find(x=>x.id===id):members.find(x=>x.id===id);
  if(!current||!target||!reason.trim()){setNotice('সব প্রয়োজনীয় তথ্য পূরণ করুন।');return;}
  const oldId=kind==='employee'?(current as Employee).branch_id:(current as Member).samity_id;
  if(oldId===target){setNotice('বর্তমান এবং নতুন কর্ম এলাকা/সমিতি একই।');return;}
  setBusy(true);setNotice('');
  const {data:userData}=await supabase.auth.getUser();
  const historyTable=kind==='employee'?'employee_work_area_transfers':'member_samity_transfers';
  const record=kind==='employee'?{employee_id:id,old_branch_id:oldId,new_branch_id:target,effective_date:date,reason:reason.trim(),changed_by:userData.user?.id||null}:{member_id:id,old_samity_id:oldId,new_samity_id:target,effective_date:date,reason:reason.trim(),changed_by:userData.user?.id||null};
  const inserted=await supabase.from(historyTable).insert(record);
  if(inserted.error){setNotice('স্থানান্তরের ইতিহাস সংরক্ষণ হয়নি: '+inserted.error.message);setBusy(false);return;}
  const updated=await supabase.from(kind==='employee'?'employees':'members').update(kind==='employee'?{branch_id:target}:{samity_id:target}).eq('id',id);
  if(updated.error){setNotice('ইতিহাস তৈরি হয়েছে, কিন্তু বর্তমান রেকর্ড পরিবর্তন হয়নি। প্রশাসকের সহায়তা নিন: '+updated.error.message);setBusy(false);await load();return;}
  setNotice('স্থানান্তর সফলভাবে সংরক্ষিত হয়েছে।');setEmployeeId('');setMemberId('');setTarget('');setReason('');setBusy(false);await load();
 }
 const title=kind==='employee'?'কর্মীর কর্ম এলাকা পরিবর্তন':'সদস্যের সমিতি পরিবর্তন';
 if(!allowed)return <section className="panel"><h2>{title}</h2><p>এই মডিউল দেখার অনুমতি নেই।</p></section>;
 return <section className="workspace"><div className="section-head"><div><p className="eyebrow">TRANSFER / HISTORY</p><h2>{title}</h2><p>স্থানান্তরের আগের ও পরের তথ্য এবং কার্যকর তারিখের ইতিহাস সংরক্ষণ করুন।</p></div></div>
 {notice&&<div className="notice">{notice}</div>}
 <section className="panel"><div className="form-grid"><label>স্থানান্তরের ধরন<select value={kind} onChange={e=>{setKind(e.target.value as 'employee'|'member');setTarget('');}}><option value="employee">কর্মীর কর্ম এলাকা</option><option value="member">সদস্যের সমিতি</option></select></label></div>
 <form className="employee-form" onSubmit={save}><div className="form-grid">
 {kind==='employee'?<><label>কর্মী নির্বাচন *<select required value={employeeId} onChange={e=>{setEmployeeId(e.target.value);setTarget('');}}><option value="">কর্মী নির্বাচন</option>{employees.map(x=><option key={x.id} value={x.id}>{x.employee_code} — {x.full_name}</option>)}</select></label><label>বর্তমান Branch<input disabled value={branches.find(x=>x.id===employees.find(y=>y.id===employeeId)?.branch_id)?.branch_name||'নির্ধারিত নেই'}/></label><label>নতুন Branch *<select required value={target} onChange={e=>setTarget(e.target.value)}><option value="">Branch নির্বাচন</option>{branches.filter(x=>x.id!==employees.find(y=>y.id===employeeId)?.branch_id).map(x=><option key={x.id} value={x.id}>{x.branch_code} — {x.branch_name}</option>)}</select></label></>:<><label>সদস্য নির্বাচন *<select required value={memberId} onChange={e=>{setMemberId(e.target.value);setTarget('');}}><option value="">সদস্য নির্বাচন</option>{members.map(x=><option key={x.id} value={x.id}>{x.member_code} — {x.full_name}</option>)}</select></label><label>বর্তমান সমিতি<input disabled value={samities.find(x=>x.id===members.find(y=>y.id===memberId)?.samity_id)?.samity_name||'নির্ধারিত নেই'}/></label><label>নতুন সমিতি *<select required value={target} onChange={e=>setTarget(e.target.value)}><option value="">সমিতি নির্বাচন</option>{samities.filter(x=>x.id!==members.find(y=>y.id===memberId)?.samity_id).map(x=><option key={x.id} value={x.id}>{x.samity_code} — {x.samity_name}</option>)}</select></label></>}
 <label>কার্যকর হওয়ার তারিখ *<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="wide">স্থানান্তরের কারণ *<textarea required rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label></div>
 <div className="form-actions"><button disabled={busy||!canDo(kind==='employee'?'employee_transfer':'member_transfer','create')||!canDo(kind==='employee'?'employee_transfer':'member_transfer','update')}>{busy?'সংরক্ষণ হচ্ছে...':'স্থানান্তর সংরক্ষণ করুন'}</button></div></form></section>
 <section className="panel"><h3>স্থানান্তরের ইতিহাস</h3><div className="table-wrap"><table><thead><tr><th>তারিখ</th><th>কোড / ID</th><th>আগের স্থান</th><th>নতুন স্থান</th><th>কারণ</th><th>রেকর্ড</th></tr></thead><tbody>{history.map(x=><tr key={x.id}><td>{x.effective_date}</td><td>{kind==='employee'?employees.find(y=>y.id===x.employee_id)?.employee_code:members.find(y=>y.id===x.member_id)?.member_code||'—'}</td><td>{kind==='employee'?branches.find(y=>y.id===x.old_branch_id)?.branch_name||'—':samities.find(y=>y.id===x.old_samity_id)?.samity_name||'—'}</td><td>{kind==='employee'?branches.find(y=>y.id===x.new_branch_id)?.branch_name||'—':samities.find(y=>y.id===x.new_samity_id)?.samity_name||'—'}</td><td>{x.reason||'—'}</td><td>{String(x.created_at||'').slice(0,10)}</td></tr>)}{!history.length&&<tr><td colSpan={6} className="empty">কোনো স্থানান্তরের ইতিহাস নেই।</td></tr>}</tbody></table></div></section>
 </section>;
}
