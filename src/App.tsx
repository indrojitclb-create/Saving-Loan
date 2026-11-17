import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { configured, configurationError, supabase } from './lib/supabase';

type ModuleKey = 'dashboard' | 'employees' | 'users' | 'savings' | 'loans' | 'reports' | 'audit';
type Employee = {
  id: string; employee_code: string; full_name: string; phone: string | null;
  email: string | null; branch_id: string | null; designation: string | null;
  address: string | null; village: string | null; post_office: string | null;
  district: string | null; division: string | null;
  joining_date: string | null; closing_date: string | null;
  mother_name: string | null; father_name: string | null; spouse_name: string | null;
  is_active: boolean; branch?: { branch_name?: string } | null;
};
type Branch = { id: string; branch_code: string; branch_name: string; area_name: string | null; is_active: boolean };

const menu: { key: ModuleKey; label: string; desc: string }[] = [
  { key: 'dashboard', label: 'ড্যাশবোর্ড', desc: 'প্রতিষ্ঠানের সার্বিক চিত্র' },
  { key: 'employees', label: 'Employee List', desc: 'কর্মী ও শাখা ব্যবস্থাপনা' },
  { key: 'users', label: 'User & Permission', desc: 'ইউজার, ভূমিকা ও অনুমতি' },
  { key: 'savings', label: 'Savings', desc: 'সঞ্চয় জমা ও উত্তোলন' },
  { key: 'loans', label: 'Loan Management', desc: 'ঋণ বিতরণ, কিস্তি ও বকেয়া' },
  { key: 'reports', label: 'Reports', desc: 'দৈনিক, মাসিক ও বার্ষিক রিপোর্ট' },
  { key: 'audit', label: 'Audit Log', desc: 'ব্যবহারকারীর কার্যক্রমের রেকর্ড' },
];

const emptyEmployee = {
  employee_code: '', full_name: '', phone: '', email: '', branch_id: '', designation: '',
  address: '', village: '', post_office: '', district: '', division: '',
  joining_date: '', closing_date: '', mother_name: '', father_name: '', spouse_name: '',
};

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<ModuleKey>('dashboard');
  const [role, setRole] = useState('');
  const [fullName, setFullName] = useState('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [userCount, setUserCount] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [showEmployeeForm, setShowEmployeeForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployee);
  const [branchForm, setBranchForm] = useState({ branch_code: '', branch_name: '', area_name: '' });
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [notice, setNotice] = useState('');
  const [pageBusy, setPageBusy] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userForm, setUserForm] = useState({ full_name: '', email: '', password: '', role: 'co', branch_id: '', employee_id: '', area_name: '' });
  const [permissionUser, setPermissionUser] = useState('');
  const [permissionRows, setPermissionRows] = useState<any[]>([]);
  const [myPermissions, setMyPermissions] = useState<any[]>([]);
  const moduleLabels: Record<string, string> = { dashboard: 'Dashboard', employees: 'Employee List', members: 'Member List', users: 'User Management', savings: 'Savings', loans: 'Loan Management', reports: 'Reports', audit: 'Audit Log' };

  const db: any = supabase;
  const isAdmin = role === 'main_admin' || role === 'co_admin';
  const canDo = (moduleKey: string, action: 'view' | 'create' | 'update' | 'delete') => {
    if (isAdmin) return true;
    if (moduleKey === 'dashboard' && action === 'view') return true;
    const permission = myPermissions.find(x => x.module_key === moduleKey);
    return Boolean(permission?.[`can_${action}`]);
  };
  const visibleMenu = menu.filter(x => x.key === 'dashboard' || canDo(x.key, 'view') || (x.key === 'users' && canDo('users', 'create')));

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  const loadData = useCallback(async () => {
    if (!session?.user?.id || !db) return;
    setPageBusy(true);
    setError('');
    const profileResult = await db.from('profiles').select('role,full_name').eq('id', session.user.id).maybeSingle();
    if (profileResult.error) setError('প্রোফাইল পড়া যায়নি: ' + profileResult.error.message);
    setRole(profileResult.data?.role || '');
    setFullName(profileResult.data?.full_name || '');
    if (profileResult.data?.role === 'main_admin' || profileResult.data?.role === 'co_admin') {
      setMyPermissions([]);
    } else {
      const ownPermissions = await db.from('profile_permissions').select('module_key,can_view,can_create,can_update,can_delete').eq('profile_id', session.user.id);
      if (ownPermissions.error) setError('আপনার Permission পড়া যায়নি: ' + ownPermissions.error.message);
      setMyPermissions(ownPermissions.data || []);
    }
    const [employeeResult, branchResult, memberResult, userResult] = await Promise.all([
      db.from('employees').select('id,employee_code,full_name,phone,email,branch_id,designation,address,village,post_office,district,division,joining_date,closing_date,mother_name,father_name,spouse_name,is_active,branch:branches(branch_name)').order('employee_code'),
      db.from('branches').select('id,branch_code,branch_name,area_name,is_active').order('branch_code'),
      db.from('members').select('id', { count: 'exact', head: true }),
      db.from('profiles').select('id', { count: 'exact', head: true }),
    ]);
    if (employeeResult.error) setError('কর্মী তালিকা পড়া যায়নি: ' + employeeResult.error.message);
    else setEmployees(employeeResult.data || []);
    if (branchResult.error) setError('শাখা তালিকা পড়া যায়নি: ' + branchResult.error.message);
    else setBranches(branchResult.data || []);
    setMemberCount(memberResult.error ? null : (memberResult.count ?? 0));
    setUserCount(userResult.error ? null : (userResult.count ?? 0));
    if (profileResult.data?.role === 'main_admin' || profileResult.data?.role === 'co_admin') {
      const userList = await db.from('profiles').select('id,full_name,role,is_active,created_at').order('created_at', { ascending: false });
      if (!userList.error) setUsers(userList.data || []);
    }
    setPageBusy(false);
  }, [session?.user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function login(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setError('');
    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (loginError) setError(loginError.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login করা যায়নি।');
    } finally { setBusy(false); }
  }

  function startNewEmployee() {
    setEditingId(null); setEmployeeForm(emptyEmployee); setShowEmployeeForm(true); setNotice('');
  }

  function startEditEmployee(employee: Employee) {
    setEditingId(employee.id);
    setEmployeeForm({
      employee_code: employee.employee_code, full_name: employee.full_name,
      phone: employee.phone || '', email: employee.email || '',
      branch_id: employee.branch_id || '', designation: employee.designation || '',
      address: employee.address || '', village: employee.village || '',
      post_office: employee.post_office || '', district: employee.district || '',
      division: employee.division || '', joining_date: employee.joining_date || '',
      closing_date: employee.closing_date || '', mother_name: employee.mother_name || '',
      father_name: employee.father_name || '', spouse_name: employee.spouse_name || '',
    });
    setShowEmployeeForm(true); setNotice('');
  }

  async function saveEmployee(e: FormEvent) {
    e.preventDefault();
    if (!canDo('employees', editingId ? 'update' : 'create')) return;
    setPageBusy(true); setNotice('');
    const payload = {
      employee_code: employeeForm.employee_code.trim(),
      full_name: employeeForm.full_name.trim(),
      phone: employeeForm.phone.trim() || null,
      email: employeeForm.email.trim() || null,
      branch_id: employeeForm.branch_id || null,
      designation: employeeForm.designation.trim() || null,
      address: employeeForm.address.trim() || null,
      village: employeeForm.village.trim() || null,
      post_office: employeeForm.post_office.trim() || null,
      district: employeeForm.district.trim() || null,
      division: employeeForm.division.trim() || null,
      joining_date: employeeForm.joining_date || null,
      closing_date: employeeForm.closing_date || null,
      mother_name: employeeForm.mother_name.trim() || null,
      father_name: employeeForm.father_name.trim() || null,
      spouse_name: employeeForm.spouse_name.trim() || null,
    };
    const result = editingId
      ? await db.from('employees').update(payload).eq('id', editingId)
      : await db.from('employees').insert(payload);
    setPageBusy(false);
    if (result.error) { setNotice('সংরক্ষণ হয়নি: ' + result.error.message); return; }
    setNotice(editingId ? 'কর্মীর তথ্য আপডেট হয়েছে।' : 'নতুন কর্মী যোগ হয়েছে।');
    setShowEmployeeForm(false); setEditingId(null); setEmployeeForm(emptyEmployee);
    await loadData();
  }

  async function toggleEmployee(employee: Employee) {
    if (!canDo('employees', 'update')) return;
    const result = await db.from('employees').update({ is_active: !employee.is_active }).eq('id', employee.id);
    if (result.error) setNotice('পরিবর্তন হয়নি: ' + result.error.message);
    else { setNotice(employee.is_active ? 'কর্মী নিষ্ক্রিয় করা হয়েছে।' : 'কর্মী সক্রিয় করা হয়েছে।'); await loadData(); }
  }

  async function saveBranch(e: FormEvent) {
    e.preventDefault();
    if (!canDo('employees', 'create')) return;
    setPageBusy(true); setNotice('');
    const result = await db.from('branches').insert({
      branch_code: branchForm.branch_code.trim(),
      branch_name: branchForm.branch_name.trim(),
      area_name: branchForm.area_name.trim() || null,
    });
    setPageBusy(false);
    if (result.error) { setNotice('শাখা যোগ হয়নি: ' + result.error.message); return; }
    setNotice('নতুন শাখা যোগ হয়েছে।');
    setBranchForm({ branch_code: '', branch_name: '', area_name: '' });
    setShowBranchForm(false); await loadData();
  }


  async function createUser(e: FormEvent) {
    e.preventDefault();
    if (!isAdmin && !canDo('users', 'create')) return;
    setPageBusy(true); setNotice('');
    try {
      const { data, error: invokeError } = await supabase!.functions.invoke('admin-create-user', {
        body: { ...userForm, branch_id: userForm.branch_id || null, employee_id: userForm.employee_id || null, area_name: userForm.area_name.trim() || null },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      setNotice('নতুন User Account তৈরি হয়েছে।');
      setUserForm({ full_name: '', email: '', password: '', role: 'co', branch_id: '', employee_id: '', area_name: '' });
      setShowUserForm(false);
      await loadData();
    } catch (err) {
      setNotice('User তৈরি হয়নি: ' + (err instanceof Error ? err.message : 'অজানা সমস্যা'));
    } finally { setPageBusy(false); }
  }

  async function loadPermissions(profileId: string) {
    setPermissionUser(profileId);
    const { data, error: permissionError } = await db.from('profile_permissions').select('module_key,can_view,can_create,can_update,can_delete').eq('profile_id', profileId);
    if (permissionError) { setNotice('Permission পড়া যায়নি: ' + permissionError.message); return; }
    const current = new Map((data || []).map((x: any) => [x.module_key, x]));
    setPermissionRows(Object.keys(moduleLabels).map(key => current.get(key) || ({ module_key: key, can_view: false, can_create: false, can_update: false, can_delete: false })));
  }

  async function savePermissions() {
    if (!isAdmin || !permissionUser) return;
    setPageBusy(true); setNotice('');
    const { error: deleteError } = await db.from('profile_permissions').delete().eq('profile_id', permissionUser);
    if (deleteError) { setNotice('Permission সংরক্ষণ হয়নি: ' + deleteError.message); setPageBusy(false); return; }
    const rows = permissionRows.map(x => ({ profile_id: permissionUser, module_key: x.module_key, can_view: x.can_view, can_create: x.can_create, can_update: x.can_update, can_delete: x.can_delete }));
    const { error: insertError } = await db.from('profile_permissions').insert(rows);
    setPageBusy(false);
    setNotice(insertError ? 'Permission সংরক্ষণ হয়নি: ' + insertError.message : 'Permission সংরক্ষণ হয়েছে।');
  }

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(x => [x.employee_code, x.full_name, x.phone || '', x.email || '', x.designation || '', x.address || '', x.village || '', x.post_office || '', x.district || '', x.division || '', x.mother_name || '', x.father_name || '', x.spouse_name || '', x.branch?.branch_name || ''].some(v => v.toLowerCase().includes(q)));
  }, [employees, search]);

  if (!configured) return <main className="center"><section className="card setup"><div className="logo">S&L</div><p className="eyebrow">SAVINGS & LOAN MANAGEMENT</p><h1>Supabase Configuration সমস্যা</h1><p>{configurationError}</p><p className="muted">Cloudflare Builds-এর Variables পরীক্ষা করে আবার Deploy করুন। Publishable Key গোপন চ্যাটে পাঠাবেন না।</p></section></main>;

  if (!session) return (
    <main className="center"><form className="card login" onSubmit={login}>
      <div className="logo">S&L</div><p className="eyebrow">SAVINGS & LOAN MANAGEMENT</p><h1>সিস্টেমে প্রবেশ করুন</h1>
      <label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label>Password<input type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <p className="error">{error}</p>}
      <button disabled={busy}>{busy ? 'অপেক্ষা করুন...' : 'Login'}</button><p className="muted">শুধু অনুমোদিত ব্যবহারকারীরা প্রবেশ করতে পারবেন।</p>
    </form></main>
  );

  const selected = visibleMenu.find(x => x.key === active) || visibleMenu[0] || menu[0];
  const activeEmployees = employees.filter(x => x.is_active).length;
  return <div className="shell">
    <aside className="side">
      <div className="brand"><div className="logo small">S&L</div><span><b>Saving & Loan</b><small>Management System</small></span></div>
      <nav>{visibleMenu.map(x => <button key={x.key} className={active === x.key ? 'nav active' : 'nav'} onClick={() => setActive(x.key)}>{x.label}</button>)}</nav>
      <div className="side-user"><b>{fullName || session.user.email}</b><small>{role || 'Role not assigned'}</small></div>
      <button className="logout" onClick={() => supabase?.auth.signOut()}>Logout</button>
    </aside>
    <main className="main">
      <header><div><p className="eyebrow">MANAGEMENT CONSOLE</p><h1>{selected.label}</h1></div><span className="pill">{session.user.email}</span></header>
      {error && <div className="notice error-box">{error}</div>}
      {notice && <div className="notice">{notice}</div>}
      {active === 'dashboard' && <>
        <section className="hero"><div><p className="eyebrow">WELCOME, {fullName || 'ADMIN'}</p><h2>সঞ্চয় ও ঋণ ব্যবস্থাপনা</h2><p>আপনার প্রতিষ্ঠানের কর্মী, শাখা ও সদস্যদের সার্বিক তথ্য।</p></div><div className="money">৳</div></section>
        <section className="stats">
          <article><span>মোট কর্মী</span><strong>{employees.length}</strong><small>Employee records</small></article>
          <article><span>সক্রিয় কর্মী</span><strong>{activeEmployees}</strong><small>Active employees</small></article>
          <article><span>মোট শাখা</span><strong>{branches.length}</strong><small>Branch records</small></article>
          <article><span>মোট সদস্য</span><strong>{memberCount ?? '—'}</strong><small>Member records</small></article>
        </section>
        <section className="panel"><div><p className="eyebrow">ACCOUNT</p><h2>{fullName || 'ব্যবহারকারী'}</h2><p>আপনার ভূমিকা: {role || 'নির্ধারিত নয়'}</p></div><div className="quick-actions"><button onClick={() => setActive('employees')}>Employee List দেখুন</button><button className="secondary" onClick={loadData}>তথ্য Refresh</button></div></section>
        <p className="muted dashboard-foot">সক্রিয় User Account: {userCount ?? 'অনুমতি নেই'}</p>
      </>}
      {active === 'employees' && <section className="workspace">
        <div className="section-head"><div><h2>কর্মী ব্যবস্থাপনা</h2><p>কর্মীর তথ্য যোগ, খোঁজা ও হালনাগাদ করুন।</p></div>{canDo('employees', 'create') && <button onClick={startNewEmployee}>+ নতুন Employee</button>}</div>
        {!canDo('employees', 'view') && <div className="notice">আপনার Employee List দেখার অনুমতি নেই।</div>}
        <div className="toolbar"><input placeholder="নাম, কোড, মোবাইল বা শাখা দিয়ে খুঁজুন..." value={search} onChange={e => setSearch(e.target.value)} /><span>{filteredEmployees.length} জন কর্মী</span>{canDo('employees', 'create') && <button className="secondary" onClick={() => setShowBranchForm(v => !v)}>+ নতুন শাখা</button>}</div>
        {canDo('employees', 'create') && showBranchForm && <form className="inline-form" onSubmit={saveBranch}>
          <label>শাখা কোড<input required value={branchForm.branch_code} onChange={e => setBranchForm({ ...branchForm, branch_code: e.target.value })} /></label>
          <label>শাখার নাম<input required value={branchForm.branch_name} onChange={e => setBranchForm({ ...branchForm, branch_name: e.target.value })} /></label>
          <label>এরিয়া<input value={branchForm.area_name} onChange={e => setBranchForm({ ...branchForm, area_name: e.target.value })} /></label>
          <button disabled={pageBusy}>শাখা সংরক্ষণ</button>
        </form>}
        {canDo('employees', editingId ? 'update' : 'create') && showEmployeeForm && <form className="employee-form" onSubmit={saveEmployee}>
          <div className="section-head"><h3>{editingId ? 'Employee তথ্য সম্পাদনা' : 'নতুন Employee যোগ করুন'}</h3><button type="button" className="text-button" onClick={() => setShowEmployeeForm(false)}>বন্ধ করুন ✕</button></div>
          <div className="form-grid">
            <label>Employee Code *<input required value={employeeForm.employee_code} onChange={e => setEmployeeForm({ ...employeeForm, employee_code: e.target.value })} /></label>
            <label>কর্মীর নাম *<input required value={employeeForm.full_name} onChange={e => setEmployeeForm({ ...employeeForm, full_name: e.target.value })} /></label>
            <label>মোবাইল<input value={employeeForm.phone} onChange={e => setEmployeeForm({ ...employeeForm, phone: e.target.value })} /></label>
            <label>Email<input type="email" value={employeeForm.email} onChange={e => setEmployeeForm({ ...employeeForm, email: e.target.value })} /></label>
            <label>পদবি<input value={employeeForm.designation} onChange={e => setEmployeeForm({ ...employeeForm, designation: e.target.value })} placeholder="যেমন: CO / Branch Manager" /></label>
            <label>শাখা<select value={employeeForm.branch_id} onChange={e => setEmployeeForm({ ...employeeForm, branch_id: e.target.value })}><option value="">শাখা নির্বাচন করুন</option>{branches.map(b => <option key={b.id} value={b.id}>{b.branch_code} - {b.branch_name}</option>)}</select></label>
            <label>পিতার নাম<input value={employeeForm.father_name} onChange={e => setEmployeeForm({ ...employeeForm, father_name: e.target.value })} /></label>
            <label>মাতার নাম<input value={employeeForm.mother_name} onChange={e => setEmployeeForm({ ...employeeForm, mother_name: e.target.value })} /></label>
            <label>স্বামী/স্ত্রীর নাম<input value={employeeForm.spouse_name} onChange={e => setEmployeeForm({ ...employeeForm, spouse_name: e.target.value })} /></label>
            <label>Joining Date<input type="date" value={employeeForm.joining_date} onChange={e => setEmployeeForm({ ...employeeForm, joining_date: e.target.value })} /></label>
            <label>Closing Date<input type="date" value={employeeForm.closing_date} onChange={e => setEmployeeForm({ ...employeeForm, closing_date: e.target.value })} /></label>
            <label>গ্রাম / Village<input value={employeeForm.village} onChange={e => setEmployeeForm({ ...employeeForm, village: e.target.value })} /></label>
            <label>ডাকঘর / Post Office<input value={employeeForm.post_office} onChange={e => setEmployeeForm({ ...employeeForm, post_office: e.target.value })} /></label>
            <label>জেলা / District<input value={employeeForm.district} onChange={e => setEmployeeForm({ ...employeeForm, district: e.target.value })} /></label>
            <label>বিভাগ / Division<input value={employeeForm.division} onChange={e => setEmployeeForm({ ...employeeForm, division: e.target.value })} /></label>
            <label className="wide">অতিরিক্ত ঠিকানা (ঐচ্ছিক)<textarea rows={2} value={employeeForm.address} onChange={e => setEmployeeForm({ ...employeeForm, address: e.target.value })} /></label>
          </div>
          <div className="form-actions"><button disabled={pageBusy}>{pageBusy ? 'সংরক্ষণ হচ্ছে...' : 'সংরক্ষণ করুন'}</button><button type="button" className="secondary" onClick={() => setShowEmployeeForm(false)}>বাতিল</button></div>
        </form>}
        <div className="table-wrap"><table><thead><tr><th>ক্রম</th><th>কোড</th><th>কর্মীর নাম</th><th>মোবাইল</th><th>পদবি</th><th>গ্রাম</th><th>ডাকঘর</th><th>জেলা</th><th>বিভাগ</th><th>অতিরিক্ত ঠিকানা</th><th>Joining Date</th><th>Closing Date</th><th>পিতার নাম</th><th>মাতার নাম</th><th>স্বামী/স্ত্রীর নাম</th><th>শাখা</th><th>অবস্থা</th>{(canDo('employees', 'update') || canDo('employees', 'delete')) && <th>কার্যক্রম</th>}</tr></thead>
          <tbody>{filteredEmployees.map((x, i) => <tr key={x.id}><td>{i + 1}</td><td>{x.employee_code}</td><td>{x.full_name}</td><td>{x.phone || '—'}</td><td>{x.designation || '—'}</td><td>{x.village || '—'}</td><td>{x.post_office || '—'}</td><td>{x.district || '—'}</td><td>{x.division || '—'}</td><td>{x.address || '—'}</td><td>{x.joining_date || '—'}</td><td>{x.closing_date || '—'}</td><td>{x.father_name || '—'}</td><td>{x.mother_name || '—'}</td><td>{x.spouse_name || '—'}</td><td>{x.branch?.branch_name || '—'}</td><td><span className={x.is_active ? 'status on' : 'status off'}>{x.is_active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}</span></td>{(canDo('employees', 'update') || canDo('employees', 'delete')) && <td><div className="row-actions">{canDo('employees', 'update') && <><button className="small-action" onClick={() => startEditEmployee(x)}>Edit</button><button className="small-action secondary" onClick={() => toggleEmployee(x)}>{x.is_active ? 'বন্ধ' : 'চালু'}</button></>}</div></td>}</tr>)}
          {filteredEmployees.length === 0 && <tr><td colSpan={(canDo('employees', 'update') || canDo('employees', 'delete')) ? 18 : 17} className="empty">{pageBusy ? 'তথ্য লোড হচ্ছে...' : 'কোনো Employee পাওয়া যায়নি।'}</td></tr>}</tbody>
        </table></div>
        <div className="branch-list"><h3>শাখার তালিকা ({branches.length})</h3><div className="branch-chips">{branches.map(b => <span key={b.id}>{b.branch_code} · {b.branch_name}{b.area_name ? ' · ' + b.area_name : ''}</span>)}</div></div>
      </section>}
      
      {active === 'users' && (isAdmin || canDo('users', 'view') || canDo('users', 'create')) && <section className="workspace">
        <div className="section-head"><div><h2>User Management & Permission</h2><p>Main Admin ও Co-admin পূর্ণ নিয়ন্ত্রণ করবেন। Assistant Admin কেবল অনুমোদিত Permission অনুযায়ী কাজ করবেন।</p></div>{canDo('users', 'create') && <button onClick={() => setShowUserForm(v => !v)}>+ নতুন User</button>}</div>
        {showUserForm && canDo('users', 'create') && <form className="employee-form" onSubmit={createUser}>
          <div className="form-grid">
            <label>পূর্ণ নাম *<input required value={userForm.full_name} onChange={e => setUserForm({ ...userForm, full_name: e.target.value })} /></label>
            <label>Email *<input required type="email" value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} /></label>
            <label>প্রাথমিক Password *<input required type="password" minLength={8} value={userForm.password} onChange={e => setUserForm({ ...userForm, password: e.target.value })} /></label>
            <label>Role *<select value={userForm.role} onChange={e => setUserForm({ ...userForm, role: e.target.value })}>
              {role === 'main_admin' && <option value="main_admin">Main Admin</option>}
              {isAdmin && <><option value="co_admin">Co-admin</option><option value="assistant_admin">Assistant Admin</option></>}<option value="area_manager">Area Manager</option><option value="branch_manager">Branch Manager</option><option value="co">CO</option>
            </select></label>
            <label>শাখা<select value={userForm.branch_id} onChange={e => setUserForm({ ...userForm, branch_id: e.target.value })}><option value="">শাখা নির্বাচন</option>{branches.map(b => <option key={b.id} value={b.id}>{b.branch_code} - {b.branch_name}</option>)}</select></label>
            <label>Employee (CO হলে)<select value={userForm.employee_id} onChange={e => setUserForm({ ...userForm, employee_id: e.target.value })}><option value="">কর্মী নির্বাচন</option>{employees.map(x => <option key={x.id} value={x.id}>{x.employee_code} - {x.full_name}</option>)}</select></label>
            <label>Area Name (Area Manager হলে)<input value={userForm.area_name} onChange={e => setUserForm({ ...userForm, area_name: e.target.value })} /></label>
          </div>
          <div className="form-actions"><button disabled={pageBusy}>{pageBusy ? 'তৈরি হচ্ছে...' : 'User তৈরি করুন'}</button><button type="button" className="secondary" onClick={() => setShowUserForm(false)}>বাতিল</button></div>
          <p className="muted">Password কমপক্ষে ৮ অক্ষরের দিন।</p>
        </form>}
        {canDo('users', 'view') && <div className="table-wrap"><table><thead><tr><th>নাম</th><th>Role</th><th>Status</th><th>Permission</th></tr></thead><tbody>
          {users.map(u => <tr key={u.id}><td>{u.full_name}</td><td>{u.role}</td><td>{u.is_active ? 'Active' : 'Inactive'}</td><td><button className="small-action" onClick={() => loadPermissions(u.id)}>Permission নির্ধারণ</button></td></tr>)}
          {users.length === 0 && <tr><td colSpan={4} className="empty">User তালিকা পাওয়া যায়নি।</td></tr>}
        </tbody></table></div>}
        {permissionUser && isAdmin && <div className="employee-form"><div className="section-head"><h3>Module Permission</h3><button className="text-button" onClick={() => setPermissionUser('')}>বন্ধ করুন ✕</button></div>
          <div className="table-wrap"><table><thead><tr><th>Module</th><th>View</th><th>Create</th><th>Update</th><th>Delete</th></tr></thead><tbody>
            {permissionRows.map((p, i) => <tr key={p.module_key}><td>{moduleLabels[p.module_key]}</td>{(['can_view','can_create','can_update','can_delete'] as const).map(field => <td key={field}><input type="checkbox" checked={p[field]} onChange={e => setPermissionRows(rows => rows.map((x,j) => j === i ? { ...x, [field]: e.target.checked } : x))} /></td>)}</tr>)}
          </tbody></table></div>
          <div className="form-actions"><button disabled={pageBusy} onClick={savePermissions}>Permission সংরক্ষণ</button></div>
        </div>}
      </section>}
      {active !== 'dashboard' && active !== 'employees' && active !== 'users' && <section className="panel"><div><p className="eyebrow">COMING NEXT</p><h2>{selected.label}</h2><p>{selected.desc}</p></div><p className="muted">এই মডিউলটি পরবর্তী ধাপে তৈরি করা হবে।</p></section>}
      <footer className="footer">S&L Management System · Main Admin Console</footer>
    </main>
  </div>;
}
