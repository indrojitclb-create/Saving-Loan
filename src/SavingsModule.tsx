import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from './lib/supabase';

type OpeningBalance = { member_id: string; gs_balance: number; lts_new_balance: number; optional_balance: number; opening_date: string };

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
      setLoading(false);
    })();
    return () => { live = false; };
  }, [memberId]);

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
