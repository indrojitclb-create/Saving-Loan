import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from './lib/supabase';

type Props = { branches: any[]; samities: any[]; canDo: (moduleKey: string, action: 'view'|'create'|'update'|'delete') => boolean };
const today = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const types = ['Public','Special','Emergency','Other'];
const scopeNames: Record<string,string> = {organization:'Organization',branch:'Branch',samity:'Samity'};

export default function HolidayModule({branches,samities,canDo}:Props) {
  const [rows,setRows]=useState<any[]>([]);
  const [fridayEnabled,setFridayEnabled]=useState(true);
  const [scope,setScope]=useState('organization');
  const [branchId,setBranchId]=useState('');
  const [samityId,setSamityId]=useState('');
  const [dateFrom,setDateFrom]=useState(today());
  const [dateTo,setDateTo]=useState(today());
  const [holidayType,setHolidayType]=useState('Public');
  const [description,setDescription]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const db:any=supabase;
  const load=async()=>{
    if(!db)return;
    const [h,s]=await Promise.all([
      db.from('holiday_calendar').select('*').order('date_from',{ascending:false}),
      db.from('holiday_calendar_settings').select('friday_holiday_enabled').eq('id',1).maybeSingle()
    ]);
    if(h.error)setNotice('ছুটির তালিকা পড়া যায়নি: '+h.error.message);else setRows(h.data||[]);
    if(s.error)setNotice('শুক্রবারের সেটিং পড়া যায়নি: '+s.error.message);else if(s.data)setFridayEnabled(Boolean(s.data.friday_holiday_enabled));
  };
  useEffect(()=>{load();},[]);
  async function save(e:FormEvent){
    e.preventDefault();
    if(!canDo('holiday_calendar','create'))return;
    if(dateTo<dateFrom){setNotice('শেষ তারিখ শুরুর তারিখের আগে হতে পারবে না।');return;}
    if(scope==='branch'&&!branchId){setNotice('Branch নির্বাচন করুন।');return;}
    if(scope==='samity'&&!samityId){setNotice('Samity নির্বাচন করুন।');return;}
    setBusy(true);setNotice('');
    const {data:user}=await db.auth.getUser();
    const result=await db.from('holiday_calendar').insert({
      date_from:dateFrom,date_to:dateTo,holiday_type:holidayType,scope,
      branch_id:scope==='branch'?branchId:null,samity_id:scope==='samity'?samityId:null,
      description:description.trim()||null,created_by:user.user?.id
    });
    if(result.error)setNotice('ছুটি সংরক্ষণ হয়নি: '+result.error.message);
    else{setNotice('ছুটির সময়সূচি সংরক্ষণ হয়েছে।');setDescription('');await load();}
    setBusy(false);
  }
  async function toggleFriday(value:boolean){
    if(!canDo('holiday_calendar','update'))return;
    setFridayEnabled(value);
    const {data:user}=await db.auth.getUser();
    const result=await db.from('holiday_calendar_settings').upsert({id:1,friday_holiday_enabled:value,updated_by:user.user?.id,updated_at:new Date().toISOString()});
    if(result.error){setFridayEnabled(!value);setNotice('শুক্রবারের সেটিং পরিবর্তন হয়নি: '+result.error.message);}
    else setNotice(value?'প্রতি শুক্রবার স্বয়ংক্রিয় ছুটি চালু হয়েছে।':'স্বয়ংক্রিয় শুক্রবার ছুটি বন্ধ হয়েছে।');
  }
  async function deactivate(row:any){
    if(!canDo('holiday_calendar','update')||!window.confirm('এই ছুটির রেকর্ড নিষ্ক্রিয় করবেন?'))return;
    const result=await db.from('holiday_calendar').update({is_active:false}).eq('id',row.id);
    if(result.error)setNotice('পরিবর্তন হয়নি: '+result.error.message);else{setNotice('ছুটির রেকর্ড নিষ্ক্রিয় হয়েছে।');await load();}
  }
  const branchName=(id:string)=>branches.find(x=>x.id===id)?.branch_name||'—';
  const samityName=(id:string)=>samities.find(x=>x.id===id)?.samity_name||'—';
  return <section className="workspace">
    <div className="section-head"><div><p className="eyebrow">CONFIG / CONFIG HOLIDAY</p><h2>Holiday Configuration</h2><p>প্রতিষ্ঠান, Branch ও Samity অনুযায়ী কেন্দ্রীয় ছুটির ক্যালেন্ডার।</p></div></div>
    {notice&&<div className="notice">{notice}</div>}
    <section className="panel">
      <h3>সাপ্তাহিক ছুটি</h3>
      <label className="field"><input type="checkbox" checked={fridayEnabled} disabled={!canDo('holiday_calendar','update')} onChange={e=>toggleFriday(e.target.checked)}/> প্রতি শুক্রবার স্বয়ংক্রিয় ছুটি গণনা হবে</label>
      <p className="muted">চালু থাকলে শুক্রবারে সব Branch ও Samity-তে লেনদেন বন্ধ থাকবে। বন্ধ করলে শুক্রবারকে স্বাভাবিক কর্মদিবস হিসেবে গণনা করা হবে।</p>
    </section>
    {canDo('holiday_calendar','create')&&<form className="employee-form" onSubmit={save}>
      <h3>নতুন ছুটি নির্ধারণ</h3>
      <div className="form-grid">
        <label>Date From *<input type="date" required value={dateFrom} onChange={e=>setDateFrom(e.target.value)}/></label>
        <label>Date To *<input type="date" required min={dateFrom} value={dateTo} onChange={e=>setDateTo(e.target.value)}/></label>
        <label>Holiday Type *<select value={holidayType} onChange={e=>setHolidayType(e.target.value)}>{types.map(x=><option key={x}>{x}</option>)}</select></label>
        <label>Applicable For *<select value={scope} onChange={e=>setScope(e.target.value)}><option value="organization">Organization</option><option value="branch">Branch</option><option value="samity">Samity</option></select></label>
        {scope==='branch'&&<label>Branch *<select required value={branchId} onChange={e=>setBranchId(e.target.value)}><option value="">Branch নির্বাচন</option>{branches.map(x=><option key={x.id} value={x.id}>{x.branch_code} — {x.branch_name}</option>)}</select></label>}
        {scope==='samity'&&<label>Samity *<select required value={samityId} onChange={e=>setSamityId(e.target.value)}><option value="">Samity নির্বাচন</option>{samities.map(x=><option key={x.id} value={x.id}>{x.samity_code} — {x.samity_name}</option>)}</select></label>}
        <label>Description<input value={description} onChange={e=>setDescription(e.target.value)} placeholder="ছুটির কারণ"/></label>
      </div>
      <div className="form-actions"><button disabled={busy}>{busy?'সংরক্ষণ হচ্ছে...':'ছুটি সংরক্ষণ'}</button></div>
    </form>}
    <section className="panel"><h3>Holiday Configuration List</h3>
      <div className="table-wrap"><table><thead><tr><th>#</th><th>Holiday Date</th><th>Holiday Type</th><th>Org</th><th>Branch</th><th>Samity</th><th>Applicable For</th><th>Description</th><th>Actions</th></tr></thead>
      <tbody>{rows.filter(x=>x.is_active).map((x,i)=><tr key={x.id}><td>{i+1}</td><td>{x.date_from===x.date_to?x.date_from:x.date_from+' — '+x.date_to}</td><td>{x.holiday_type}</td><td>{x.scope==='organization'?'Yes':'—'}</td><td>{x.scope==='branch'?branchName(x.branch_id):'—'}</td><td>{x.scope==='samity'?samityName(x.samity_id):'—'}</td><td>{scopeNames[x.scope]}</td><td>{x.description||'—'}</td><td>{canDo('holiday_calendar','update')&&<button type="button" className="secondary" onClick={()=>deactivate(x)}>Deactivate</button>}</td></tr>)}
      {!rows.some(x=>x.is_active)&&<tr><td colSpan={9} className="empty">কোনো অতিরিক্ত ছুটি নির্ধারণ করা হয়নি।</td></tr>}</tbody></table></div>
    </section>
  </section>;
}
