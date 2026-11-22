import { useEffect, useMemo, useState } from 'react';
import { supabase } from './lib/supabase';

type Props = { canDo: (moduleKey: string, action: 'view'|'create'|'update'|'delete') => boolean };
type ReportRow = { id:string; date:string; member:string; memberCode:string; category:string; type:string; amount:number; reference:string };

const today = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); };
const money = (n:number) => '৳'+Number(n||0).toLocaleString('en-BD',{maximumFractionDigits:2});
const firstDay = () => { const d=new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),'01'].join('-'); };

export default function ReportsModule({canDo}:Props) {
  const [from,setFrom]=useState(firstDay());
  const [to,setTo]=useState(today());
  const [rows,setRows]=useState<ReportRow[]>([]);
  const [loading,setLoading]=useState(false);
  const [notice,setNotice]=useState('');
  const [kind,setKind]=useState('all');

  useEffect(()=>{ void load(); },[]);

  async function load(){
    if(!supabase||!canDo('reports','view'))return;
    if(from>to){setNotice('শুরুর তারিখ শেষ তারিখের পরে হতে পারবে না।');return;}
    setLoading(true);setNotice('');
    const [membersRes,savingsRes,loanRes,openingRes]=await Promise.all([
      supabase.from('members').select('id,member_code,full_name'),
      supabase.from('savings_transactions').select('id,member_id,transaction_date,transaction_type,amount,savings_category,reference_no').gte('transaction_date',from).lte('transaction_date',to).order('transaction_date',{ascending:false}),
      supabase.from('loan_transactions').select('id,loan_id,transaction_date,amount,reference_no,loan_accounts!inner(member_id,loan_no)').gte('transaction_date',from).lte('transaction_date',to).order('transaction_date',{ascending:false}),
      supabase.from('member_opening_loan_transactions').select('id,opening_loan_id,transaction_date,amount,member_opening_loans!inner(member_id,loan_no)').gte('transaction_date',from).lte('transaction_date',to).order('transaction_date',{ascending:false})
    ]);
    const error=membersRes.error||savingsRes.error||loanRes.error||openingRes.error;
    if(error){setNotice('রিপোর্ট লোড হয়নি: '+error.message);setLoading(false);return;}
    const memberMap=new Map((membersRes.data||[]).map((m:any)=>[m.id,m]));
    const result:ReportRow[]=[];
    for(const x of savingsRes.data||[]){
      const m:any=memberMap.get(x.member_id);
      result.push({id:'s-'+x.id,date:x.transaction_date,member:m?.full_name||'—',memberCode:m?.member_code||'—',category:x.savings_category||'Savings',type:x.transaction_type==='deposit'?'জমা':'উত্তোলন',amount:Number(x.amount),reference:x.reference_no||''});
    }
    for(const x of loanRes.data||[]){
      const rel:any=(x as any).loan_accounts; const m:any=memberMap.get(rel?.member_id);
      result.push({id:'l-'+x.id,date:x.transaction_date,member:m?.full_name||'—',memberCode:m?.member_code||'—',category:'নতুন ঋণ আদায়',type:'আদায়',amount:Number(x.amount),reference:rel?.loan_no||x.reference_no||''});
    }
    for(const x of openingRes.data||[]){
      const rel:any=(x as any).member_opening_loans; const m:any=memberMap.get(rel?.member_id);
      result.push({id:'o-'+x.id,date:x.transaction_date,member:m?.full_name||'—',memberCode:m?.member_code||'—',category:'প্রারম্ভিক ঋণ আদায়',type:'আদায়',amount:Number(x.amount),reference:rel?.loan_no||''});
    }
    result.sort((a,b)=>b.date.localeCompare(a.date)||a.member.localeCompare(b.member));
    setRows(result);setLoading(false);
    if(!result.length)setNotice('নির্বাচিত সময়ে কোনো লেনদেন পাওয়া যায়নি।');
  }

  const visible=useMemo(()=>rows.filter(x=>kind==='all'||(kind==='savings'?['GS','LTS-New','Optional'].includes(x.category):(x.category.includes('ঋণ')))),[rows,kind]);
  const totals=useMemo(()=>{
    const deposits=visible.filter(x=>x.type==='জমা').reduce((s,x)=>s+x.amount,0);
    const withdrawals=visible.filter(x=>x.type==='উত্তোলন').reduce((s,x)=>s+x.amount,0);
    const loan=visible.filter(x=>x.type==='আদায়').reduce((s,x)=>s+x.amount,0);
    return {deposits,withdrawals,loan,count:visible.length};
  },[visible]);

  function exportCsv(){
    const header=['তারিখ','সদস্য কোড','সদস্যের নাম','খাত','লেনদেন','পরিমাণ','রেফারেন্স'];
    const csv=[header,...visible.map(x=>[x.date,x.memberCode,x.member,x.category,x.type,String(x.amount),x.reference])]
      .map(line=>line.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='savings-loan-report-'+from+'-'+to+'.csv';a.click();URL.revokeObjectURL(url);
  }

  if(!canDo('reports','view'))return <section className="panel"><h2>Reports</h2><p>এই রিপোর্ট দেখার অনুমতি নেই।</p></section>;
  return <section className="workspace">
    <div className="section-head"><div><p className="eyebrow">REPORTS / FINANCIAL LEDGER</p><h2>আর্থিক লেনদেন রিপোর্ট</h2><p>সঞ্চয় ও ঋণ আদায়ের সদস্যভিত্তিক হিসাব।</p></div></div>
    {notice&&<div className="notice">{notice}</div>}
    <section className="panel">
      <div className="form-grid">
        <label>শুরুর তারিখ<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label>
        <label>শেষ তারিখ<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
        <label>রিপোর্টের ধরন<select value={kind} onChange={e=>setKind(e.target.value)}><option value="all">সকল লেনদেন</option><option value="savings">শুধু সঞ্চয়</option><option value="loan">শুধু ঋণ আদায়</option></select></label>
      </div>
      <div className="form-actions"><button type="button" onClick={()=>void load()} disabled={loading}>{loading?'লোড হচ্ছে...':'রিপোর্ট দেখুন'}</button><button type="button" className="secondary" onClick={exportCsv} disabled={!visible.length}>CSV ডাউনলোড</button></div>
    </section>
    <div className="stats-grid">
      <article className="stat-card"><span>সঞ্চয় জমা</span><strong>{money(totals.deposits)}</strong></article>
      <article className="stat-card"><span>সঞ্চয় উত্তোলন</span><strong>{money(totals.withdrawals)}</strong></article>
      <article className="stat-card"><span>ঋণ আদায়</span><strong>{money(totals.loan)}</strong></article>
      <article className="stat-card"><span>মোট লেনদেন</span><strong>{totals.count.toLocaleString('en-BD')}</strong></article>
    </div>
    <section className="panel"><h3>লেনদেনের বিবরণ</h3><div className="table-wrap"><table><thead><tr><th>তারিখ</th><th>সদস্য কোড</th><th>সদস্যের নাম</th><th>খাত</th><th>লেনদেন</th><th>পরিমাণ</th><th>রেফারেন্স</th></tr></thead><tbody>
      {visible.map(x=><tr key={x.id}><td>{x.date}</td><td>{x.memberCode}</td><td>{x.member}</td><td>{x.category}</td><td>{x.type}</td><td>{money(x.amount)}</td><td>{x.reference||'—'}</td></tr>)}
      {!visible.length&&<tr><td colSpan={7} className="empty">কোনো তথ্য নেই। তারিখ নির্বাচন করে রিপোর্ট দেখুন।</td></tr>}
    </tbody></table></div></section>
  </section>;
}
