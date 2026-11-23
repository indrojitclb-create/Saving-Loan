import { useEffect, useState } from 'react';
import { supabase } from './lib/supabase';

type Props = { canDo: (moduleKey: string, action: 'view'|'create'|'update'|'delete') => boolean };
type AuditRow = {
  id: number; actor_id: string | null; action: string; table_name: string;
  record_id: string | null; details: Record<string, unknown> | null; created_at: string;
  actor?: { full_name?: string; login_id?: string } | null;
};
const stamp = (value:string) => new Date(value).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'});

export default function AuditModule({canDo}:Props) {
  const [rows,setRows]=useState<AuditRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const [action,setAction]=useState('');
  const [table,setTable]=useState('');
  const [from,setFrom]=useState('');
  const [to,setTo]=useState('');
  const [page,setPage]=useState(0);
  const pageSize=50;

  async function load(){
    if(!supabase||!canDo('audit','view'))return;
    if(from&&to&&from>to){setNotice('শুরুর তারিখ শেষ তারিখের পরে হতে পারবে না।');return;}
    setLoading(true);setNotice('');
    let query=supabase.from('audit_logs').select('id,actor_id,action,table_name,record_id,details,created_at,actor:profiles!audit_logs_actor_id_fkey(full_name,login_id)').order('created_at',{ascending:false}).range(page*pageSize,(page+1)*pageSize-1);
    if(action)query=query.eq('action',action);
    if(table)query=query.eq('table_name',table);
    if(from)query=query.gte('created_at',from+'T00:00:00');
    if(to)query=query.lt('created_at',new Date(new Date(to+'T00:00:00').getTime()+86400000).toISOString());
    const {data,error}=await query;
    if(error){setNotice('Audit Log লোড হয়নি: '+error.message);setRows([]);}
    else setRows((data||[]) as unknown as AuditRow[]);
    setLoading(false);
  }
  useEffect(()=>{void load();},[page]);
  if(!canDo('audit','view'))return <section className="panel"><h2>Audit Log</h2><p>এই রেকর্ড দেখার অনুমতি নেই।</p></section>;
  return <section className="workspace">
    <div className="section-head"><div><p className="eyebrow">SECURITY / ACTIVITY HISTORY</p><h2>Audit Log</h2><p>ব্যবহারকারীর কার্যক্রমের অপরিবর্তনীয় রেকর্ড। সর্বশেষ ৫০টি রেকর্ড করে দেখানো হয়।</p></div></div>
    {notice&&<div className="notice">{notice}</div>}
    <section className="panel">
      <div className="form-grid">
        <label>কার্যক্রম<input value={action} onChange={e=>setAction(e.target.value)} placeholder="যেমন INSERT / UPDATE"/></label>
        <label>টেবিল<input value={table} onChange={e=>setTable(e.target.value)} placeholder="যেমন members"/></label>
        <label>শুরুর তারিখ<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label>শেষ তারিখ<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
      </div>
      <div className="form-actions"><button type="button" onClick={()=>{setPage(0);void load();}} disabled={loading}>{loading?'লোড হচ্ছে...':'ফিল্টার প্রয়োগ'}</button><button type="button" className="secondary" onClick={()=>{setAction('');setTable('');setFrom('');setTo('');setPage(0);setTimeout(()=>void load(),0);}}>ফিল্টার মুছুন</button></div>
    </section>
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>সময়</th><th>ব্যবহারকারী</th><th>কার্যক্রম</th><th>টেবিল</th><th>রেকর্ড ID</th><th>বিবরণ</th></tr></thead><tbody>
      {rows.map(row=><tr key={row.id}><td>{stamp(row.created_at)}</td><td>{row.actor?.full_name||row.actor?.login_id||'সিস্টেম / অজানা'}</td><td>{row.action}</td><td>{row.table_name}</td><td>{row.record_id||'—'}</td><td><details><summary>বিস্তারিত</summary><pre style={{whiteSpace:'pre-wrap',maxWidth:360}}>{JSON.stringify(row.details||{},null,2)}</pre></details></td></tr>)}
      {!rows.length&&<tr><td colSpan={6} className="empty">{loading?'লোড হচ্ছে...':'কোনো Audit Log পাওয়া যায়নি।'}</td></tr>}
    </tbody></table></div>
      <div className="form-actions"><button type="button" className="secondary" disabled={page===0||loading} onClick={()=>setPage(p=>Math.max(0,p-1))}>আগের ৫০টি</button><span className="muted">পৃষ্ঠা {page+1}</span><button type="button" className="secondary" disabled={rows.length<pageSize||loading} onClick={()=>setPage(p=>p+1)}>পরের ৫০টি</button></div>
    </section>
  </section>;
}
