import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import MemberModule from './MemberModule';
import LoanModule from './LoanModule';
import CollectionModule from './CollectionModule';
import HolidayModule from './HolidayModule';
import { configured, configurationError, supabase } from './lib/supabase';

type ModuleKey = 'dashboard' | 'employees' | 'users' | 'savings' | 'collection' | 'loans' | 'reports' | 'audit' | 'area_master' | 'samity' | 'samity_day_change' | 'samity_staff' | 'samity_branch_transfer' | 'employee_transfer' | 'member_transfer' | 'members' | 'optional_savings' | 'holiday_calendar';
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
type AreaType = 'division' | 'district' | 'upazila' | 'post_office' | 'village';
type AreaRow = { id: string; name: string; is_active: boolean; division_id?: string; district_id?: string; upazila_id?: string; post_office_id?: string; post_code?: string };

const menu: { key: ModuleKey; label: string; desc: string }[] = [
  { key: 'dashboard', label: 'ড্যাশবোর্ড', desc: 'প্রতিষ্ঠানের সার্বিক চিত্র' },
  { key: 'employees', label: 'Employee List', desc: 'কর্মী ও শাখা ব্যবস্থাপনা' },
  { key: 'users', label: 'User & Permission', desc: 'ইউজার, ভূমিকা ও অনুমতি' },
  { key: 'savings', label: 'Savings', desc: 'সঞ্চয় জমা ও উত্তোলন' },
  { key: 'collection', label: 'সমিতিভিত্তিক আদায় সিট', desc: 'একই সিটে GS, LTS-New ও ঋণের মাসিক আদায়' },
  { key: 'loans', label: 'ঋণ ব্যবস্থাপনা ও আদায় সিট', desc: 'ঋণ বিতরণ, ৪৬ সপ্তাহের কিস্তি ও সমিতিভিত্তিক আদায়' },
  { key: 'reports', label: 'Reports', desc: 'দৈনিক, মাসিক ও বার্ষিক রিপোর্ট' },
  { key: 'audit', label: 'Audit Log', desc: 'ব্যবহারকারীর কার্যক্রমের রেকর্ড' },
  { key: 'area_master', label: 'কেন্দ্রীয় কর্ম এলাকা', desc: 'বিভাগ, জেলা, উপজেলা, পোস্ট অফিস ও গ্রাম' },
  { key: 'samity', label: 'সমিতি গঠন', desc: 'নতুন সমিতি তৈরি ও পরিচালনা' },
  { key: 'samity_day_change', label: 'সমিতির দিন ও সময় পরিবর্তন', desc: 'সমিতির সাপ্তাহিক সভার সময়সূচি পরিবর্তন' },
  { key: 'samity_staff', label: 'সমিতির কর্মী স্থানান্তর', desc: 'সমিতির দায়িত্বে থাকা কর্মী পরিবর্তন' },
  { key: 'samity_branch_transfer', label: 'সমিতির Branch স্থানান্তর', desc: 'সমিতিকে এক Branch থেকে অন্য Branch-এ স্থানান্তর' },
  { key: 'employee_transfer', label: 'কর্মীর কর্ম এলাকা পরিবর্তন', desc: 'কর্মীকে অন্য কর্ম এলাকায় স্থানান্তর' },
  { key: 'member_transfer', label: 'সদস্যের সমিতি পরিবর্তন', desc: 'সদস্যকে অন্য সমিতিতে স্থানান্তর' },
  { key: 'members', label: 'সদস্য নিবন্ধন ও তালিকা', desc: 'নতুন সদস্য নিবন্ধন ও সদস্যের তথ্য' },
  { key: 'optional_savings', label: 'Optional Savings Setup', desc: 'ঐচ্ছিক সঞ্চয় স্কিম তৈরি ও পরিচালনা' },
  { key: 'holiday_calendar', label: 'Holiday Calendar', desc: 'প্রতিষ্ঠান, Branch ও Samity-এর কেন্দ্রীয় ছুটি' },
];

const emptyEmployee = {
  employee_code: '', full_name: '', phone: '', email: '', branch_id: '', designation: '',
  address: '', village: '', post_office: '', district: '', division: '',
  joining_date: '', closing_date: '', mother_name: '', father_name: '', spouse_name: '',
};

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [loginId, setLoginId] = useState('');
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
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [showUserForm, setShowUserForm] = useState(false);
  const [userForm, setUserForm] = useState({ full_name: '', login_id: '', email: '', password: '', role: 'co', branch_id: '', employee_id: '', area_name: '' });
  const [permissionUser, setPermissionUser] = useState('');
  const [permissionRows, setPermissionRows] = useState<any[]>([]);
  const [myPermissions, setMyPermissions] = useState<any[]>([]);
  const [areaDivisions, setAreaDivisions] = useState<AreaRow[]>([]);
  const [areaDistricts, setAreaDistricts] = useState<AreaRow[]>([]);
  const [areaUpazilas, setAreaUpazilas] = useState<AreaRow[]>([]);
  const [areaPostOffices, setAreaPostOffices] = useState<AreaRow[]>([]);
  const [areaVillages, setAreaVillages] = useState<AreaRow[]>([]);
  const [areaForm, setAreaForm] = useState<{type: AreaType; id: string; name: string; parentId: string; postCode: string}>({type:'division',id:'',name:'',parentId:'',postCode:''});
  const [samities, setSamities] = useState<any[]>([]);
  const [meetingChanges, setMeetingChanges] = useState<any[]>([]);
  const [areaChanges, setAreaChanges] = useState<any[]>([]);
  const [samityStaffAssignments, setSamityStaffAssignments] = useState<any[]>([]);
  const [samityStaffChanges, setSamityStaffChanges] = useState<any[]>([]);
  const [samityBranchChanges, setSamityBranchChanges] = useState<any[]>([]);
  const [staffTransferForm, setStaffTransferForm] = useState({samity_id:'',employee_id:'',effective_date:new Date().toISOString().slice(0,10),reason:''});
  const [branchTransferForm, setBranchTransferForm] = useState({samity_id:'',branch_id:'',effective_date:new Date().toISOString().slice(0,10),reason:''});
  const [areaChangeForm, setAreaChangeForm] = useState({samity_id:'',division_id:'',district_id:'',upazila_id:'',post_office_id:'',village_id:'',effective_date:new Date().toISOString().slice(0,10),reason:''});
  const [meetingForm, setMeetingForm] = useState({samity_id:'',new_day:'2',new_time:'10:00',new_place:'',effective_date:new Date().toISOString().slice(0,10),reason:''});
  const [showSamityForm, setShowSamityForm] = useState(false);
  const [editingSamityId, setEditingSamityId] = useState<string | null>(null);
  const [samityForm, setSamityForm] = useState({samity_code:'',samity_name:'',samity_gender:'female',branch_id:'',division_id:'',district_id:'',upazila_id:'',post_office_id:'',village_id:'',meeting_place:'',meeting_day:'2',meeting_time:'10:00',start_date:new Date().toISOString().slice(0,10),status:'active',notes:''});
  const moduleLabels: Record<string, string> = { dashboard: 'Dashboard', employees: 'Employee List', members: 'Member List', optional_savings: 'Optional Savings Setup', users: 'User Management', savings: 'Savings', collection: 'সমিতিভিত্তিক আদায় সিট', loans: 'Loan Management', reports: 'Reports', audit: 'Audit Log', area_master: 'কেন্দ্রীয় কর্ম এলাকা', samity: 'সমিতি গঠন', samity_day_change: 'সমিতির দিন ও সময় পরিবর্তন', samity_staff: 'সমিতির কর্মী স্থানান্তর', samity_branch_transfer: 'সমিতির Branch স্থানান্তর', employee_transfer: 'কর্মীর কর্ম এলাকা পরিবর্তন', member_transfer: 'সদস্যের সমিতি পরিবর্তন', holiday_calendar: 'Holiday Calendar' };

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
    const profileResult = await db.from('profiles').select('role,full_name,login_id').eq('id', session.user.id).maybeSingle();
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
    const [employeeResult, branchResult, memberResult, userResult, divisionsResult, districtsResult, upazilasResult, postOfficesResult, villagesResult, samityResult, meetingChangesResult, areaChangesResult, staffAssignmentsResult, staffChangesResult, branchChangesResult] = await Promise.all([
      db.from('employees').select('id,employee_code,full_name,phone,email,branch_id,designation,address,village,post_office,district,division,joining_date,closing_date,mother_name,father_name,spouse_name,is_active,branch:branches(branch_name)').order('employee_code'),
      db.from('branches').select('id,branch_code,branch_name,area_name,is_active').order('branch_code'),
      db.from('members').select('id', { count: 'exact', head: true }),
      db.from('profiles').select('id', { count: 'exact', head: true }),
      db.from('area_divisions').select('*').order('name'),
      db.from('area_districts').select('*').order('name'),
      db.from('area_upazilas').select('*').order('name'),
      db.from('area_post_offices').select('*').order('name'),
      db.from('area_villages').select('*').order('name'),
      db.from('samities').select('*').order('samity_code'),
      db.from('samity_meeting_changes').select('*').order('created_at', {ascending:false}),
      db.from('samity_area_changes').select('*').order('created_at', {ascending:false}),
      db.from('samity_employee_assignments').select('*').eq('is_active',true).order('assigned_from',{ascending:false}),
      db.from('samity_employee_changes').select('*').order('created_at',{ascending:false}),
      db.from('samity_branch_changes').select('*').order('created_at',{ascending:false}),
    ]);
    if (employeeResult.error) setError('কর্মী তালিকা পড়া যায়নি: ' + employeeResult.error.message);
    else setEmployees(employeeResult.data || []);
    if (branchResult.error) setError('শাখা তালিকা পড়া যায়নি: ' + branchResult.error.message);
    else setBranches(branchResult.data || []);
    setMemberCount(memberResult.error ? null : (memberResult.count ?? 0));
    setUserCount(userResult.error ? null : (userResult.count ?? 0));
    setAreaDivisions(divisionsResult.data || []);
    setAreaDistricts(districtsResult.data || []);
    setAreaUpazilas(upazilasResult.data || []);
    setAreaPostOffices(postOfficesResult.data || []);
    setAreaVillages(villagesResult.data || []);
    setSamities(samityResult.data || []);
    setMeetingChanges(meetingChangesResult.data || []);
    setAreaChanges(areaChangesResult.data || []);
    setSamityStaffAssignments(staffAssignmentsResult.data || []);
    setSamityStaffChanges(staffChangesResult.data || []);
    setSamityBranchChanges(branchChangesResult.data || []);
    if (profileResult.data?.role === 'main_admin' || profileResult.data?.role === 'co_admin') {
      const userList = await db.from('profiles').select('id,full_name,login_id,role,is_active,created_at').order('created_at', { ascending: false });
      if (!userList.error) setUsers(userList.data || []);
    } else if (profileResult.data?.role === 'assistant_admin') {
      const ownPermissions = await db.from('profile_permissions').select('can_view').eq('profile_id', session.user.id).eq('module_key', 'users').maybeSingle();
      if (ownPermissions.data?.can_view) {
        const userList = await db.from('profiles').select('id,full_name,role,is_active,created_at').order('created_at', { ascending: false });
        if (!userList.error) setUsers(userList.data || []);
      }
    }
    setPageBusy(false);
  }, [session?.user?.id]);

  useEffect(() => { loadData(); }, [loadData]);

  async function login(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true); setError('');
    try {
      if (loginId.includes('@')) {
        const { error: loginError } = await supabase.auth.signInWithPassword({ email: loginId.trim(), password });
        if (loginError) setError(loginError.message);
      } else {
        const { data, error: loginError } = await supabase.functions.invoke('login-by-user-id', {
          body: { login_id: loginId.trim(), password },
        });
        if (loginError) throw loginError;
        if (data?.error) throw new Error(data.error);
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: data.access_token, refresh_token: data.refresh_token,
        });
        if (sessionError) throw sessionError;
      }
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


  function editArea(type: AreaType, row: AreaRow) {
    const parentId = type === 'district' ? row.division_id : type === 'upazila' ? row.district_id : type === 'post_office' ? row.upazila_id : type === 'village' ? row.post_office_id : '';
    setAreaForm({ type, id: row.id, name: row.name, parentId: parentId || '', postCode: row.post_code || '' });
  }

  async function saveArea(e: FormEvent) {
    e.preventDefault();
    if (!canDo('area_master', areaForm.id ? 'update' : 'create')) return;
    const name = areaForm.name.trim();
    if (!name) { setNotice('নাম লিখুন।'); return; }
    let table = 'area_divisions';
    let payload: any = { name };
    if (areaForm.type === 'district') { table = 'area_districts'; payload.division_id = areaForm.parentId; }
    if (areaForm.type === 'upazila') { table = 'area_upazilas'; payload.district_id = areaForm.parentId; }
    if (areaForm.type === 'post_office') { table = 'area_post_offices'; payload.upazila_id = areaForm.parentId; payload.post_code = areaForm.postCode.trim(); }
    if (areaForm.type === 'village') { table = 'area_villages'; payload.post_office_id = areaForm.parentId; }
    if (areaForm.type !== 'division' && !areaForm.parentId) { setNotice('আগে সংশ্লিষ্ট উপরের এলাকার নাম নির্বাচন করুন।'); return; }
    setPageBusy(true); setNotice('');
    const result = areaForm.id
      ? await db.from(table).update(payload).eq('id', areaForm.id)
      : await db.from(table).insert(payload);
    setPageBusy(false);
    if (result.error) { setNotice('তথ্য সংরক্ষণ হয়নি: ' + result.error.message); return; }
    setNotice('কেন্দ্রীয় কর্ম এলাকার তথ্য সংরক্ষণ হয়েছে।');
    setAreaForm({type: areaForm.type,id:'',name:'',parentId:'',postCode:''});
    await loadData();
  }

  async function toggleArea(type: AreaType, row: AreaRow) {
    if (!canDo('area_master', 'update')) return;
    const table = type === 'division' ? 'area_divisions' : type === 'district' ? 'area_districts' : type === 'upazila' ? 'area_upazilas' : type === 'post_office' ? 'area_post_offices' : 'area_villages';
    const result = await db.from(table).update({is_active: !row.is_active}).eq('id', row.id);
    if (result.error) setNotice('অবস্থা পরিবর্তন হয়নি: ' + result.error.message);
    else { setNotice(row.is_active ? 'এলাকাটি নিষ্ক্রিয় করা হয়েছে।' : 'এলাকাটি সক্রিয় করা হয়েছে।'); await loadData(); }
  }

  function resetSamityForm() {
    setEditingSamityId(null);
    setSamityForm({samity_code:'',samity_name:'',samity_gender:'female',branch_id:'',division_id:'',district_id:'',upazila_id:'',post_office_id:'',village_id:'',meeting_place:'',meeting_day:'2',meeting_time:'10:00',start_date:new Date().toISOString().slice(0,10),status:'active',notes:''});
  }

  function editSamity(row: any) {
    const village = areaVillages.find(x=>x.id===row.village_id);
    const post = areaPostOffices.find(x=>x.id===village?.post_office_id);
    const upazila = areaUpazilas.find(x=>x.id===post?.upazila_id);
    const district = areaDistricts.find(x=>x.id===upazila?.district_id);
    setEditingSamityId(row.id);
    setSamityForm({samity_code:row.samity_code,samity_name:row.samity_name,samity_gender:row.samity_gender || 'female',branch_id:row.branch_id || '',division_id:district?.division_id || '',district_id:district?.id || '',upazila_id:upazila?.id || '',post_office_id:post?.id || '',village_id:row.village_id,meeting_place:row.meeting_place,meeting_day:String(row.meeting_day),meeting_time:String(row.meeting_time || '').slice(0,5),start_date:row.start_date || '',status:row.status || 'active',notes:row.notes || ''});
    setShowSamityForm(true);
    setNotice('');
  }

  async function saveSamity(e: FormEvent) {
    e.preventDefault();
    if (!canDo('samity', editingSamityId ? 'update' : 'create')) return;
    if (!samityForm.village_id) { setNotice('সমিতির গ্রাম নির্বাচন করুন।'); return; }
    setPageBusy(true); setNotice('');
    const payload = {samity_code:samityForm.samity_code.trim(),samity_name:samityForm.samity_name.trim(),samity_gender:samityForm.samity_gender,branch_id:samityForm.branch_id || null,village_id:samityForm.village_id,meeting_place:samityForm.meeting_place.trim(),meeting_day:Number(samityForm.meeting_day),meeting_time:samityForm.meeting_time,start_date:samityForm.start_date || null,status:samityForm.status,notes:samityForm.notes.trim() || null};
    const result = editingSamityId
      ? await db.from('samities').update(payload).eq('id',editingSamityId)
      : await db.from('samities').insert({...payload,created_by:session.user.id});
    setPageBusy(false);
    if (result.error) { setNotice('সমিতি সংরক্ষণ হয়নি: '+result.error.message); return; }
    setNotice(editingSamityId ? 'সমিতির তথ্য আপডেট হয়েছে।' : 'নতুন সমিতি গঠন সম্পন্ন হয়েছে।');
    setShowSamityForm(false); resetSamityForm(); await loadData();
  }


  async function saveMeetingChange(e: FormEvent) {
    e.preventDefault();
    if (!canDo('samity_day_change','create')) return;
    const current = samities.find(x => x.id === meetingForm.samity_id);
    if (!current) { setNotice('সমিতি নির্বাচন করুন।'); return; }
    if (!meetingForm.reason.trim()) { setNotice('পরিবর্তনের কারণ লিখুন।'); return; }
    setPageBusy(true); setNotice('');
    const { error: rpcError } = await db.rpc('change_samity_meeting', {
      p_samity_id: meetingForm.samity_id,
      p_new_day: Number(meetingForm.new_day),
      p_new_time: meetingForm.new_time,
      p_new_place: meetingForm.new_place.trim(),
      p_effective_date: meetingForm.effective_date,
      p_reason: meetingForm.reason.trim()
    });
    setPageBusy(false);
    if (rpcError) { setNotice('সময় পরিবর্তন হয়নি: ' + rpcError.message); return; }
    setNotice('সমিতির সভার দিন, সময় ও স্থান পরিবর্তন হয়েছে এবং ইতিহাস সংরক্ষিত হয়েছে।');
    setMeetingForm({samity_id:'',new_day:'2',new_time:'10:00',new_place:'',effective_date:new Date().toISOString().slice(0,10),reason:''});
    await loadData();
  }

  function chooseMeetingSamity(id: string) {
    const row = samities.find(x => x.id === id);
    setMeetingForm({...meetingForm,samity_id:id,new_day:String(row?.meeting_day ?? 2),new_time:String(row?.meeting_time || '10:00').slice(0,5),new_place:row?.meeting_place || ''});
  }


  async function saveSamityStaffTransfer(e: FormEvent) {
    e.preventDefault();
    if (!canDo('samity_staff','create')) return;
    if (!staffTransferForm.samity_id || !staffTransferForm.employee_id || !staffTransferForm.reason.trim()) { setNotice('সমিতি, নতুন কর্মী ও কারণ লিখুন।'); return; }
    setPageBusy(true); setNotice('');
    const { error: rpcError } = await db.rpc('transfer_samity_staff', { p_samity_id:staffTransferForm.samity_id, p_new_employee_id:staffTransferForm.employee_id, p_effective_date:staffTransferForm.effective_date, p_reason:staffTransferForm.reason.trim() });
    setPageBusy(false);
    if (rpcError) { setNotice('কর্মী স্থানান্তর হয়নি: '+rpcError.message); return; }
    setNotice('সমিতির কর্মী স্থানান্তর হয়েছে এবং ইতিহাস সংরক্ষিত হয়েছে।');
    setStaffTransferForm({samity_id:'',employee_id:'',effective_date:new Date().toISOString().slice(0,10),reason:''});
    await loadData();
  }

  async function saveSamityBranchTransfer(e: FormEvent) {
    e.preventDefault();
    if (!canDo('samity_branch_transfer','create')) return;
    if (!branchTransferForm.samity_id || !branchTransferForm.branch_id || !branchTransferForm.reason.trim()) { setNotice('সমিতি, নতুন Branch ও কারণ লিখুন।'); return; }
    setPageBusy(true); setNotice('');
    const { error: rpcError } = await db.rpc('transfer_samity_branch', { p_samity_id:branchTransferForm.samity_id, p_new_branch_id:branchTransferForm.branch_id, p_effective_date:branchTransferForm.effective_date, p_reason:branchTransferForm.reason.trim() });
    setPageBusy(false);
    if (rpcError) { setNotice('Branch স্থানান্তর হয়নি: '+rpcError.message); return; }
    setNotice('সমিতির Branch স্থানান্তর হয়েছে এবং ইতিহাস সংরক্ষিত হয়েছে।');
    setBranchTransferForm({samity_id:'',branch_id:'',effective_date:new Date().toISOString().slice(0,10),reason:''});
    await loadData();
  }
  async function saveSamityAreaChange(e: FormEvent) {
    e.preventDefault();
    if (!canDo('samity_area_change','create')) return;
    if (!areaChangeForm.samity_id) { setNotice('সমিতি নির্বাচন করুন।'); return; }
    if (!areaChangeForm.village_id) { setNotice('নতুন গ্রামের নাম নির্বাচন করুন।'); return; }
    if (!areaChangeForm.reason.trim()) { setNotice('পরিবর্তনের কারণ লিখুন।'); return; }
    setPageBusy(true); setNotice('');
    const { error: rpcError } = await db.rpc('change_samity_area', {
      p_samity_id: areaChangeForm.samity_id,
      p_new_village_id: areaChangeForm.village_id,
      p_effective_date: areaChangeForm.effective_date,
      p_reason: areaChangeForm.reason.trim()
    });
    setPageBusy(false);
    if (rpcError) { setNotice('কর্ম এলাকা পরিবর্তন হয়নি: ' + rpcError.message); return; }
    setNotice('সমিতির কর্ম এলাকা পরিবর্তন হয়েছে এবং পুরোনো-নতুন এলাকার ইতিহাস সংরক্ষিত হয়েছে।');
    setAreaChangeForm({samity_id:'',division_id:'',district_id:'',upazila_id:'',post_office_id:'',village_id:'',effective_date:new Date().toISOString().slice(0,10),reason:''});
    await loadData();
  }

  function chooseAreaChangeSamity(id: string) {
    const row = samities.find(x=>x.id===id);
    const village = areaVillages.find(x=>x.id===row?.village_id);
    const post = areaPostOffices.find(x=>x.id===village?.post_office_id);
    const upazila = areaUpazilas.find(x=>x.id===post?.upazila_id);
    const district = areaDistricts.find(x=>x.id===upazila?.district_id);
    setAreaChangeForm({...areaChangeForm,samity_id:id,division_id:district?.division_id||'',district_id:district?.id||'',upazila_id:upazila?.id||'',post_office_id:post?.id||'',village_id:''});
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
      setUserForm({ full_name: '', login_id: '', email: '', password: '', role: 'co', branch_id: '', employee_id: '', area_name: '' });
      setShowUserForm(false);
      await loadData();
    } catch (err) {
      setNotice('User তৈরি হয়নি: ' + (err instanceof Error ? err.message : 'অজানা সমস্যা'));
    } finally { setPageBusy(false); }
  }

  async function deleteUser(user: any) {
    if (role !== 'main_admin' || !user?.id || user.id === session?.user?.id || user.role === 'main_admin') return;
    const confirmed = window.confirm(`আপনি কি নিশ্চিতভাবে ${user.full_name} (${user.login_id || user.role})-এর User Account সম্পূর্ণ মুছে ফেলতে চান? এই কাজ ফিরিয়ে আনা যাবে না।`);
    if (!confirmed) return;
    setDeletingUserId(user.id); setNotice('');
    try {
      const { data, error: invokeError } = await supabase!.functions.invoke('admin-delete-user', {
        body: { user_id: user.id },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      setNotice('User Account সম্পূর্ণ মুছে ফেলা হয়েছে।');
      await loadData();
    } catch (err) {
      setNotice('User মুছে ফেলা যায়নি: ' + (err instanceof Error ? err.message : 'অজানা সমস্যা'));
    } finally {
      setDeletingUserId(null);
    }
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
    if (insertError) {
      setNotice('Permission সংরক্ষণ হয়নি: ' + insertError.message);
      return;
    }
    setNotice('Permission সংরক্ষণ হয়েছে।');
    setPermissionUser('');
    setPermissionRows([]);
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
      <label>User ID / Email<input required value={loginId} onChange={e => setLoginId(e.target.value)} /></label>
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
            <label>Login ID *<input required minLength={3} maxLength={40} value={userForm.login_id} onChange={e => setUserForm({ ...userForm, login_id: e.target.value.toUpperCase() })} placeholder="যেমন: CO001" /></label>
            <label>Email (ঐচ্ছিক)<input type="email" value={userForm.email} onChange={e => setUserForm({ ...userForm, email: e.target.value })} /></label>
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
        {canDo('users', 'view') && <div className="table-wrap"><table><thead><tr><th>নাম</th><th>User ID</th><th>Role</th><th>Status</th><th>Permission</th>{role === 'main_admin' && <th>Delete</th>}</tr></thead><tbody>
          {users.map(u => <tr key={u.id}><td>{u.full_name}</td><td>{u.login_id || 'পুরোনো Email Login'}</td><td>{u.role}</td><td>{u.is_active ? 'Active' : 'Inactive'}</td><td><button className="small-action" onClick={() => loadPermissions(u.id)}>Permission নির্ধারণ</button></td>{role === 'main_admin' && <td>{u.role !== 'main_admin' && u.id !== session.user.id ? <button className="small-action danger" disabled={deletingUserId === u.id || Boolean(deletingUserId)} onClick={() => deleteUser(u)}>{deletingUserId === u.id ? 'মুছছে...' : 'Delete User'}</button> : <span className="muted">সুরক্ষিত</span>}</td>}</tr>)}
          {users.length === 0 && <tr><td colSpan={role === 'main_admin' ? 6 : 5} className="empty">User তালিকা পাওয়া যায়নি।</td></tr>}
        </tbody></table></div>}
        {permissionUser && isAdmin && <div className="employee-form"><div className="section-head"><h3>Module Permission</h3><button className="text-button" onClick={() => setPermissionUser('')}>বন্ধ করুন ✕</button></div>
          <div className="table-wrap"><table><thead><tr><th>Module</th><th>View</th><th>Create</th><th>Update</th><th>Delete</th></tr></thead><tbody>
            {permissionRows.map((p, i) => <tr key={p.module_key}><td>{moduleLabels[p.module_key]}</td>{(['can_view','can_create','can_update','can_delete'] as const).map(field => <td key={field}><input type="checkbox" checked={p[field]} onChange={e => setPermissionRows(rows => rows.map((x,j) => j === i ? { ...x, [field]: e.target.checked } : x))} /></td>)}</tr>)}
          </tbody></table></div>
          <div className="form-actions"><button disabled={pageBusy} onClick={savePermissions}>Permission সংরক্ষণ</button></div>
        </div>}
      </section>}
      {active === 'area_master' && <section className="workspace">
        <div className="section-head"><div><h2>কেন্দ্রীয় কর্ম এলাকা</h2><p>একবার এখানে এলাকার তথ্য যোগ করলে সমিতি গঠনের সময় তালিকা থেকে নির্বাচন করা যাবে।</p></div></div>
        {canDo('area_master', 'create') || canDo('area_master', 'update') ? <form className="employee-form" onSubmit={saveArea}>
          <h3>{areaForm.id ? 'এলাকার তথ্য সম্পাদনা' : 'নতুন এলাকার তথ্য যোগ করুন'}</h3>
          <div className="form-grid">
            <label>তথ্যের ধরন<select value={areaForm.type} onChange={e => setAreaForm({type:e.target.value as AreaType,id:'',name:'',parentId:'',postCode:''})}>
              <option value="division">বিভাগ</option><option value="district">জেলা</option><option value="upazila">উপজেলা</option><option value="post_office">পোস্ট অফিস</option><option value="village">গ্রাম</option>
            </select></label>
            {areaForm.type === 'district' && <label>বিভাগ নির্বাচন<select required value={areaForm.parentId} onChange={e => setAreaForm({...areaForm,parentId:e.target.value})}><option value="">বিভাগ নির্বাচন</option>{areaDivisions.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
            {areaForm.type === 'upazila' && <label>জেলা নির্বাচন<select required value={areaForm.parentId} onChange={e => setAreaForm({...areaForm,parentId:e.target.value})}><option value="">জেলা নির্বাচন</option>{areaDistricts.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
            {areaForm.type === 'post_office' && <label>উপজেলা নির্বাচন<select required value={areaForm.parentId} onChange={e => setAreaForm({...areaForm,parentId:e.target.value})}><option value="">উপজেলা নির্বাচন</option>{areaUpazilas.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>}
            {areaForm.type === 'village' && <label>পোস্ট অফিস নির্বাচন<select required value={areaForm.parentId} onChange={e => setAreaForm({...areaForm,parentId:e.target.value})}><option value="">পোস্ট অফিস নির্বাচন</option>{areaPostOffices.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.name} {x.post_code ? '('+x.post_code+')' : ''}</option>)}</select></label>}
            <label>{areaForm.type === 'division' ? 'বিভাগের নাম' : areaForm.type === 'district' ? 'জেলার নাম' : areaForm.type === 'upazila' ? 'উপজেলার নাম' : areaForm.type === 'post_office' ? 'পোস্ট অফিসের নাম' : 'গ্রামের নাম'} *<input required value={areaForm.name} onChange={e=>setAreaForm({...areaForm,name:e.target.value})}/></label>
            {areaForm.type === 'post_office' && <label>পোস্ট কোড<input value={areaForm.postCode} onChange={e=>setAreaForm({...areaForm,postCode:e.target.value})} placeholder="যেমন: 9000"/></label>}
          </div>
          <div className="form-actions"><button disabled={pageBusy}>{pageBusy ? 'সংরক্ষণ হচ্ছে...' : areaForm.id ? 'পরিবর্তন সংরক্ষণ' : 'এলাকার তথ্য যোগ করুন'}</button>{areaForm.id && <button type="button" className="secondary" onClick={()=>setAreaForm({...areaForm,id:'',name:'',parentId:'',postCode:''})}>বাতিল</button>}</div>
        </form> : <div className="notice">আপনার এই মডিউলে তথ্য যোগ বা সম্পাদনার অনুমতি নেই।</div>}
        {([['বিভাগ','division',areaDivisions],['জেলা','district',areaDistricts],['উপজেলা','upazila',areaUpazilas],['পোস্ট অফিস','post_office',areaPostOffices],['গ্রাম','village',areaVillages]] as [string,AreaType,AreaRow[]][]).map(([label,type,rows]) => <div className="branch-list" key={type}>
          <h3>{label} তালিকা ({rows.length})</h3><div className="table-wrap"><table><thead><tr><th>নাম</th>{type === 'post_office' && <th>পোস্ট কোড</th>}<th>অবস্থা</th>{canDo('area_master','update') && <th>কার্যক্রম</th>}</tr></thead><tbody>
            {rows.map(row=><tr key={row.id}><td>{row.name}</td>{type === 'post_office' && <td>{row.post_code || '—'}</td>}<td>{row.is_active ? 'সক্রিয়' : 'নিষ্ক্রিয়'}</td>{canDo('area_master','update') && <td><div className="row-actions"><button className="small-action" onClick={()=>editArea(type,row)}>Edit</button><button className="small-action secondary" onClick={()=>toggleArea(type,row)}>{row.is_active ? 'বন্ধ' : 'চালু'}</button></div></td>}</tr>)}
            {rows.length===0 && <tr><td colSpan={type === 'post_office' ? (canDo('area_master','update')?4:3) : (canDo('area_master','update')?3:2)} className="empty">এখনও কোনো তথ্য যোগ করা হয়নি।</td></tr>}
          </tbody></table></div>
        </div>)}
      </section>}
      {active === 'samity' && <section className="workspace">
        <div className="section-head"><div><h2>সমিতি গঠন ও ব্যবস্থাপনা</h2><p>কেন্দ্রীয় কর্ম এলাকার তালিকা থেকে গ্রাম নির্বাচন করে সমিতি তৈরি করুন।</p></div>{canDo('samity','create') && <button onClick={()=>{resetSamityForm();setShowSamityForm(v=>!v);}}>+ নতুন সমিতি গঠন</button>}</div>
        {showSamityForm && canDo('samity',editingSamityId?'update':'create') && <form className="employee-form" onSubmit={saveSamity}>
          <div className="section-head"><h3>{editingSamityId?'সমিতির তথ্য সম্পাদনা':'নতুন সমিতির নিবন্ধন'}</h3><button type="button" className="text-button" onClick={()=>{setShowSamityForm(false);resetSamityForm();}}>বন্ধ করুন ✕</button></div>
          <div className="form-grid">
            <label>সমিতির কোড *<input required value={samityForm.samity_code} onChange={e=>setSamityForm({...samityForm,samity_code:e.target.value})} placeholder="যেমন: S001"/></label>
            <label>সমিতির নাম *<input required value={samityForm.samity_name} onChange={e=>setSamityForm({...samityForm,samity_name:e.target.value})}/></label>
            <label>সমিতির ধরন *<select required value={samityForm.samity_gender} onChange={e=>setSamityForm({...samityForm,samity_gender:e.target.value})}><option value="male">Male (পুরুষ)</option><option value="female">Female (মহিলা)</option></select></label>
            <label>সমিতির Branch *<select required value={samityForm.branch_id} onChange={e=>setSamityForm({...samityForm,branch_id:e.target.value})}><option value="">Branch নির্বাচন</option>{branches.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.branch_code} — {x.branch_name}</option>)}</select></label>
            <label>বিভাগ *<select required value={samityForm.division_id} onChange={e=>setSamityForm({...samityForm,division_id:e.target.value,district_id:'',upazila_id:'',post_office_id:'',village_id:''})}><option value="">বিভাগ নির্বাচন</option>{areaDivisions.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>জেলা *<select required value={samityForm.district_id} onChange={e=>setSamityForm({...samityForm,district_id:e.target.value,upazila_id:'',post_office_id:'',village_id:''})}><option value="">জেলা নির্বাচন</option>{areaDistricts.filter(x=>x.is_active&&x.division_id===samityForm.division_id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>উপজেলা *<select required value={samityForm.upazila_id} onChange={e=>setSamityForm({...samityForm,upazila_id:e.target.value,post_office_id:'',village_id:''})}><option value="">উপজেলা নির্বাচন</option>{areaUpazilas.filter(x=>x.is_active&&x.district_id===samityForm.district_id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>পোস্ট অফিস *<select required value={samityForm.post_office_id} onChange={e=>setSamityForm({...samityForm,post_office_id:e.target.value,village_id:''})}><option value="">পোস্ট অফিস নির্বাচন</option>{areaPostOffices.filter(x=>x.is_active&&x.upazila_id===samityForm.upazila_id).map(x=><option key={x.id} value={x.id}>{x.name} ({x.post_code})</option>)}</select></label>
            <label>গ্রাম *<select required value={samityForm.village_id} onChange={e=>setSamityForm({...samityForm,village_id:e.target.value})}><option value="">গ্রাম নির্বাচন</option>{areaVillages.filter(x=>x.is_active&&x.post_office_id===samityForm.post_office_id).map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label>সমিতির সভার স্থান *<input required value={samityForm.meeting_place} onChange={e=>setSamityForm({...samityForm,meeting_place:e.target.value})} placeholder="যেমন: সদস্যের বাড়ির উঠান"/></label>
            <label>সাপ্তাহিক সভার দিন *<select required value={samityForm.meeting_day} onChange={e=>setSamityForm({...samityForm,meeting_day:e.target.value})}><option value="0">রবিবার</option><option value="1">সোমবার</option><option value="2">মঙ্গলবার</option><option value="3">বুধবার</option><option value="4">বৃহস্পতিবার</option><option value="6">শনিবার</option></select></label>
            <label>সভার সময় *<input required type="time" value={samityForm.meeting_time} onChange={e=>setSamityForm({...samityForm,meeting_time:e.target.value})}/></label>
            <label>গঠনের তারিখ<input type="date" value={samityForm.start_date} onChange={e=>setSamityForm({...samityForm,start_date:e.target.value})}/></label>
            <label>অবস্থা<select value={samityForm.status} onChange={e=>setSamityForm({...samityForm,status:e.target.value})}><option value="active">সক্রিয়</option><option value="inactive">নিষ্ক্রিয়</option><option value="closed">বন্ধ</option></select></label>
            <label className="wide">মন্তব্য<textarea rows={2} value={samityForm.notes} onChange={e=>setSamityForm({...samityForm,notes:e.target.value})}/></label>
          </div>
          <div className="form-actions"><button disabled={pageBusy}>{pageBusy?'সংরক্ষণ হচ্ছে...':'সমিতির তথ্য সংরক্ষণ'}</button><button type="button" className="secondary" onClick={()=>{setShowSamityForm(false);resetSamityForm();}}>বাতিল</button></div>
        </form>}
        <div className="table-wrap"><table><thead><tr><th>ক্রম</th><th>সমিতি কোড</th><th>সমিতির নাম</th><th>ধরন</th><th>গ্রাম</th><th>সভাস্থল</th><th>সভার দিন</th><th>সময়</th><th>গঠনের তারিখ</th><th>অবস্থা</th>{canDo('samity','update')&&<th>কার্যক্রম</th>}</tr></thead><tbody>
          {samities.map((row,i)=>{const village=areaVillages.find(x=>x.id===row.village_id);return <tr key={row.id}><td>{i+1}</td><td>{row.samity_code}</td><td>{row.samity_name}</td><td>{row.samity_gender==='male'?'Male (পুরুষ)':row.samity_gender==='female'?'Female (মহিলা)':'—'}</td><td>{village?.name||'—'}</td><td>{row.meeting_place}</td><td>{['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'][row.meeting_day]||'—'}</td><td>{String(row.meeting_time||'').slice(0,5)}</td><td>{row.start_date||'—'}</td><td>{row.status==='active'?'সক্রিয়':row.status==='inactive'?'নিষ্ক্রিয়':'বন্ধ'}</td>{canDo('samity','update')&&<td><button className="small-action" onClick={()=>editSamity(row)}>Edit</button></td>}</tr>})}
          {samities.length===0&&<tr><td colSpan={canDo('samity','update')?10:9} className="empty">এখনও কোনো সমিতি গঠন করা হয়নি।</td></tr>}
        </tbody></table></div>
        {areaVillages.filter(x=>x.is_active).length===0&&<p className="muted">সমিতি গঠনের আগে কেন্দ্রীয় কর্ম এলাকায় বিভাগ, জেলা, উপজেলা, পোস্ট অফিস ও গ্রাম যোগ করুন।</p>}
      </section>}
      {active === 'samity_day_change' && <section className="workspace">
        <div className="section-head"><div><h2>সমিতির দিন ও সময় পরিবর্তন</h2><p>নতুন সভার দিন, সময় ও স্থান কার্যকর হওয়ার তারিখসহ সংরক্ষণ করুন। পুরোনো তথ্য ইতিহাসে থাকবে।</p></div></div>
        {canDo('samity_day_change','create') && <form className="employee-form" onSubmit={saveMeetingChange}>
          <div className="form-grid">
            <label>সমিতি নির্বাচন করুন *<select required value={meetingForm.samity_id} onChange={e=>chooseMeetingSamity(e.target.value)}><option value="">সমিতি নির্বাচন</option>{samities.filter(x=>x.status==='active').map(x=><option key={x.id} value={x.id}>{x.samity_code} — {x.samity_name}</option>)}</select></label>
            <label>বর্তমান সভার দিন<input disabled value={meetingForm.samity_id ? ['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'][samities.find(x=>x.id===meetingForm.samity_id)?.meeting_day] : ''}/></label>
            <label>নতুন সভার দিন *<select required value={meetingForm.new_day} onChange={e=>setMeetingForm({...meetingForm,new_day:e.target.value})}><option value="0">রবিবার</option><option value="1">সোমবার</option><option value="2">মঙ্গলবার</option><option value="3">বুধবার</option><option value="4">বৃহস্পতিবার</option><option value="6">শনিবার</option></select></label>
            <label>নতুন সভার সময় *<input required type="time" value={meetingForm.new_time} onChange={e=>setMeetingForm({...meetingForm,new_time:e.target.value})}/></label>
            <label>নতুন সভাস্থল *<input required value={meetingForm.new_place} onChange={e=>setMeetingForm({...meetingForm,new_place:e.target.value})}/></label>
            <label>কার্যকর হওয়ার তারিখ *<input required type="date" value={meetingForm.effective_date} onChange={e=>setMeetingForm({...meetingForm,effective_date:e.target.value})}/></label>
            <label className="wide">পরিবর্তনের কারণ *<textarea required rows={2} value={meetingForm.reason} onChange={e=>setMeetingForm({...meetingForm,reason:e.target.value})}/></label>
          </div>
          <div className="form-actions"><button disabled={pageBusy || !meetingForm.samity_id}>{pageBusy?'সংরক্ষণ হচ্ছে...':'পরিবর্তন সংরক্ষণ করুন'}</button></div>
        </form>}
        <h3>পরিবর্তনের ইতিহাস</h3>
        <div className="table-wrap"><table><thead><tr><th>সমিতি</th><th>ধরন</th><th>আগের দিন/সময়/স্থান</th><th>নতুন দিন/সময়/স্থান</th><th>কার্যকর তারিখ</th><th>কারণ</th><th>রেকর্ডের তারিখ</th></tr></thead><tbody>
          {meetingChanges.map((x)=>{const s=samities.find(y=>y.id===x.samity_id);const days=['রবিবার','সোমবার','মঙ্গলবার','বুধবার','বৃহস্পতিবার','শুক্রবার','শনিবার'];return <tr key={x.id}><td>{s ? s.samity_code+' — '+s.samity_name : '—'}</td><td>{s?.samity_gender==='male'?'Male (পুরুষ)':s?.samity_gender==='female'?'Female (মহিলা)':'—'}</td><td>{days[x.old_day]} / {String(x.old_time).slice(0,5)} / {x.old_place}</td><td>{days[x.new_day]} / {String(x.new_time).slice(0,5)} / {x.new_place}</td><td>{x.effective_date}</td><td>{x.reason||'—'}</td><td>{String(x.created_at||'').slice(0,10)}</td></tr>})}
          {meetingChanges.length===0&&<tr><td colSpan={7} className="empty">এখনও কোনো পরিবর্তনের ইতিহাস নেই।</td></tr>}
        </tbody></table></div>
      </section>}
      {active === 'samity_staff' && <section className="workspace">
        <div className="section-head"><div><h2>সমিতির কর্মী স্থানান্তর</h2><p>সমিতির দায়িত্বপ্রাপ্ত কর্মী পরিবর্তন করুন। পুরোনো ও নতুন দায়িত্বের ইতিহাস সংরক্ষিত থাকবে।</p></div></div>
        {canDo('samity_staff','create') && <form className="employee-form" onSubmit={saveSamityStaffTransfer}>
          <div className="form-grid">
            <label>সমিতি নির্বাচন করুন *<select required value={staffTransferForm.samity_id} onChange={e=>setStaffTransferForm({...staffTransferForm,samity_id:e.target.value})}><option value="">সমিতি নির্বাচন</option>{samities.filter(x=>x.status==='active').map(x=><option key={x.id} value={x.id}>{x.samity_code} — {x.samity_name}</option>)}</select></label>
            <label>বর্তমান দায়িত্বপ্রাপ্ত কর্মী<input disabled value={(()=>{const a=samityStaffAssignments.find(x=>x.samity_id===staffTransferForm.samity_id);const e=employees.find(y=>y.id===a?.employee_id);return e?e.employee_code+' — '+e.full_name:'নির্ধারিত নেই'})()}/></label>
            <label>নতুন কর্মী নির্বাচন করুন *<select required value={staffTransferForm.employee_id} onChange={e=>setStaffTransferForm({...staffTransferForm,employee_id:e.target.value})}><option value="">কর্মী নির্বাচন</option>{employees.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.employee_code} — {x.full_name}</option>)}</select></label>
            <label>কার্যকর হওয়ার তারিখ *<input required type="date" value={staffTransferForm.effective_date} onChange={e=>setStaffTransferForm({...staffTransferForm,effective_date:e.target.value})}/></label>
            <label className="wide">পরিবর্তনের কারণ *<textarea required rows={2} value={staffTransferForm.reason} onChange={e=>setStaffTransferForm({...staffTransferForm,reason:e.target.value})}/></label>
          </div>
          <div className="form-actions"><button disabled={pageBusy||!staffTransferForm.samity_id||!staffTransferForm.employee_id}>{pageBusy?'সংরক্ষণ হচ্ছে...':'কর্মী স্থানান্তর সংরক্ষণ করুন'}</button></div>
        </form>}
        <h3>কর্মী পরিবর্তনের ইতিহাস</h3>
        <div className="table-wrap"><table><thead><tr><th>সমিতি</th><th>কর্মী</th><th>পরিবর্তন</th><th>কার্যকর তারিখ</th><th>কারণ</th></tr></thead><tbody>
          {samityStaffChanges.map(x=>{const sm=samities.find(y=>y.id===x.samity_id);const em=employees.find(y=>y.id===x.employee_id);return <tr key={x.id}><td>{sm?sm.samity_code+' — '+sm.samity_name:'—'}</td><td>{em?em.employee_code+' — '+em.full_name:'—'}</td><td>{x.change_type==='assigned'?'নিয়োগ':x.change_type==='removed'?'দায়িত্ব থেকে অব্যাহতি':'প্রতিস্থাপন'}</td><td>{x.effective_date}</td><td>{x.reason||'—'}</td></tr>})}
          {samityStaffChanges.length===0&&<tr><td colSpan={5} className="empty">এখনও কোনো কর্মী পরিবর্তনের ইতিহাস নেই।</td></tr>}
        </tbody></table></div>
      </section>}
      {active === 'samity_branch_transfer' && <section className="workspace">
        <div className="section-head"><div><h2>সমিতির Branch স্থানান্তর</h2><p>এক Branch থেকে অন্য Branch-এ সমিতি স্থানান্তর করুন। পুরোনো ও নতুন Branch-এর ইতিহাস থাকবে।</p></div></div>
        {canDo('samity_branch_transfer','create') && <form className="employee-form" onSubmit={saveSamityBranchTransfer}>
          <div className="form-grid">
            <label>সমিতি নির্বাচন করুন *<select required value={branchTransferForm.samity_id} onChange={e=>setBranchTransferForm({...branchTransferForm,samity_id:e.target.value})}><option value="">সমিতি নির্বাচন</option>{samities.filter(x=>x.status==='active').map(x=><option key={x.id} value={x.id}>{x.samity_code} — {x.samity_name}</option>)}</select></label>
            <label>বর্তমান Branch<input disabled value={(()=>{const sm=samities.find(x=>x.id===branchTransferForm.samity_id);const br=branches.find(x=>x.id===sm?.branch_id);return br?br.branch_code+' — '+br.branch_name:'নির্ধারিত নেই'})()}/></label>
            <label>নতুন Branch নির্বাচন করুন *<select required value={branchTransferForm.branch_id} onChange={e=>setBranchTransferForm({...branchTransferForm,branch_id:e.target.value})}><option value="">Branch নির্বাচন</option>{branches.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.branch_code} — {x.branch_name}</option>)}</select></label>
            <label>কার্যকর হওয়ার তারিখ *<input required type="date" value={branchTransferForm.effective_date} onChange={e=>setBranchTransferForm({...branchTransferForm,effective_date:e.target.value})}/></label>
            <label className="wide">স্থানান্তরের কারণ *<textarea required rows={2} value={branchTransferForm.reason} onChange={e=>setBranchTransferForm({...branchTransferForm,reason:e.target.value})}/></label>
          </div>
          <div className="form-actions"><button disabled={pageBusy||!branchTransferForm.samity_id||!branchTransferForm.branch_id}>{pageBusy?'সংরক্ষণ হচ্ছে...':'Branch স্থানান্তর সংরক্ষণ করুন'}</button></div>
        </form>}
        <h3>Branch স্থানান্তরের ইতিহাস</h3>
        <div className="table-wrap"><table><thead><tr><th>সমিতি</th><th>আগের Branch</th><th>নতুন Branch</th><th>কার্যকর তারিখ</th><th>কারণ</th><th>রেকর্ডের তারিখ</th></tr></thead><tbody>
          {samityBranchChanges.map(x=>{const sm=samities.find(y=>y.id===x.samity_id);const oldB=branches.find(y=>y.id===x.old_branch_id);const newB=branches.find(y=>y.id===x.new_branch_id);return <tr key={x.id}><td>{sm?sm.samity_code+' — '+sm.samity_name:'—'}</td><td>{oldB?oldB.branch_code+' — '+oldB.branch_name:'নির্ধারিত ছিল না'}</td><td>{newB?newB.branch_code+' — '+newB.branch_name:'—'}</td><td>{x.effective_date}</td><td>{x.reason}</td><td>{String(x.created_at||'').slice(0,10)}</td></tr>})}
          {samityBranchChanges.length===0&&<tr><td colSpan={6} className="empty">এখনও কোনো Branch স্থানান্তরের ইতিহাস নেই।</td></tr>}
        </tbody></table></div>
      </section>}
      {(active === 'members' || active === 'optional_savings') && <MemberModule branches={branches} samities={samities} divisions={areaDivisions} districts={areaDistricts} upazilas={areaUpazilas} postOffices={areaPostOffices} villages={areaVillages} role={role} fullName={fullName} initialTab={active === 'optional_savings' ? 'schemes' : 'list'} canDo={canDo} />}
      {active === 'loans' && <LoanModule samities={samities} canDo={canDo} />}
      {active === 'collection' && <CollectionModule samities={samities} canDo={canDo} />}
      {active === 'holiday_calendar' && <HolidayModule branches={branches} samities={samities} canDo={canDo} />}
      {active !== 'dashboard' && active !== 'loans' && active !== 'collection' && active !== 'employees' && active !== 'users' && active !== 'area_master' && active !== 'samity' && active !== 'samity_day_change' && active !== 'samity_staff' && active !== 'samity_branch_transfer' && active !== 'members' && active !== 'optional_savings' && active !== 'holiday_calendar' && <section className="panel"><div><p className="eyebrow">COMING NEXT</p><h2>{selected.label}</h2><p>{selected.desc}</p></div><p className="muted">এই মডিউলটি পরবর্তী ধাপে তৈরি করা হবে।</p></section>}
      <footer className="footer">S&L Management System · Main Admin Console</footer>
    </main>
  </div>;
}
