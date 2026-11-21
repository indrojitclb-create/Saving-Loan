import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from './lib/supabase';

type Props = {
  branches: any[];
  samities: any[];
  divisions: any[];
  districts: any[];
  upazilas: any[];
  postOffices: any[];
  villages: any[];
  role: string;
  fullName: string;
  initialTab?: 'list'|'schemes';
  canDo: (moduleKey: string, action: 'view'|'create'|'update'|'delete') => boolean;
};
const emptyForm: any = {
  branch_id:'', samity_id:'', full_name:'', member_surname:'', primary_product:'', gender:'female',
  is_third_gender:false, admission_date:new Date().toISOString().slice(0,10), date_of_birth:'',
  father_name:'', mother_name:'', marital_status:'Unmarried', admission_fee:'0', admission_no:'',
  application_no:'', education_level:'', phone:'', nationality:'Bangladesh', smart_id:'',
  national_id:'', birth_registration_no:'', tin_no:'', other_card_type:'', other_card_no:'',
  present_division_id:'',present_district_id:'',present_upazila_id:'',present_union:'',
  present_post_office_id:'',present_village_id:'',present_house_street:'',family_contact_no:'',
  permanent_same_as_present:false,permanent_division_id:'',permanent_district_id:'',
  permanent_upazila_id:'',permanent_union:'',permanent_post_office_id:'',permanent_village_id:'',
  permanent_house_street:'',permanent_contact_no:'',member_type:'General',profession:'',
  religion:'Muslim',remarks:'',family_member_count:'',yearly_income:'',land_area:'',
  land_area_unit:'Acre',other_note:'',mandatory_amount:'0',optional_product_id:''
};
const documentTypes = [
  ['member_picture','Member Picture'],['member_signature','Member Signature'],['member_nid','Member NID'],
  ['admission_form','Admission Form'],['loan_proposal','Loan Proposal'],['contact','Contact'],
  ['kyc','KYC'],['trade_license','Trade License']
];
export default function MemberModule({branches,samities,divisions,districts,upazilas,postOffices,villages,role,fullName,initialTab='list',canDo}:Props) {
  const [tab,setTab]=useState<'list'|'register'|'schemes'>('list');
  const [step,setStep]=useState(0);
  const [form,setForm]=useState<any>(emptyForm);
  const [members,setMembers]=useState<any[]>([]);
  const [schemes,setSchemes]=useState<any[]>([]);
  const [schemeVersions,setSchemeVersions]=useState<any[]>([]);
  const [documents,setDocuments]=useState<any[]>([]);
  const [selectedMember,setSelectedMember]=useState<any>(null);
  const [editingMemberId,setEditingMemberId]=useState<string|null>(null);
  const [query,setQuery]=useState('');
  const [existingLookup,setExistingLookup]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [schemeForm,setSchemeForm]=useState({product_name:'',term_months:'60',interest_rate:'7',effective_from:new Date().toISOString().slice(0,10),description:''});
  const [optionalAmount,setOptionalAmount]=useState('100');
  const [schemeFile,setSchemeFile]=useState<File|null>(null);
  const [editingSchemeId,setEditingSchemeId]=useState<string|null>(null);
  const db:any=supabase;
  const activeSamities=useMemo(()=>samities.filter(s=>s.branch_id===form.branch_id && s.status==='active'),[samities,form.branch_id]);
  const selectedBranch=branches.find(x=>x.id===form.branch_id);
  const selectedSamity=samities.find(x=>x.id===form.samity_id);
  const districtsFor=(id:string)=>districts.filter(x=>x.division_id===id);
  const upazilasFor=(id:string)=>upazilas.filter(x=>x.district_id===id);
  const postFor=(id:string)=>postOffices.filter(x=>x.upazila_id===id);
  const villagesFor=(id:string)=>villages.filter(x=>x.post_office_id===id);
  const filtered=members.filter(m=>[m.member_code,m.full_name,m.phone,m.samity_name].some(v=>String(v||'').toLowerCase().includes(query.toLowerCase())));
  const mirrored:Record<string,string>={present_division_id:'permanent_division_id',present_district_id:'permanent_district_id',present_upazila_id:'permanent_upazila_id',present_union:'permanent_union',present_post_office_id:'permanent_post_office_id',present_village_id:'permanent_village_id',present_house_street:'permanent_house_street',family_contact_no:'permanent_contact_no'};
  const set=(key:string,value:any)=>setForm((old:any)=>({...old,[key]:value,...(old.permanent_same_as_present&&mirrored[key]?{[mirrored[key]]:value}:{})}));
  const sameAddress=(checked:boolean)=>{
    setForm((old:any)=>({...old,permanent_same_as_present:checked,
      ...(checked?{permanent_division_id:old.present_division_id,permanent_district_id:old.present_district_id,
      permanent_upazila_id:old.present_upazila_id,permanent_union:old.present_union,
      permanent_post_office_id:old.present_post_office_id,permanent_village_id:old.present_village_id,
      permanent_house_street:old.present_house_street,permanent_contact_no:old.family_contact_no}:{})}));
  };
  async function refresh(){
    if(!db)return;
    const [m,s,v]=await Promise.all([
      db.from('members').select('*').order('created_at',{ascending:false}),
      db.from('optional_savings_products').select('*').order('product_name'),
      db.from('optional_savings_product_versions').select('*').order('version_no',{ascending:false})
    ]);
    if(m.error)setNotice('সদস্য তালিকা পড়া যায়নি: '+m.error.message);else setMembers(m.data||[]);
    if(s.error)setNotice('সঞ্চয় স্কিম পড়া যায়নি: '+s.error.message);else setSchemes(s.data||[]);
    if(v.error)setNotice('স্কিমের সংস্করণ পড়া যায়নি: '+v.error.message);else setSchemeVersions(v.data||[]);
  }
  useEffect(()=>{refresh();},[]);
  useEffect(()=>{setTab(initialTab);},[initialTab]);
  async function loadDocs(member:any){
    setSelectedMember(member);
    const {data,error}=await db.from('member_documents').select('*').eq('member_id',member.id).order('created_at',{ascending:false});
    if(error)setNotice('ডকুমেন্ট পড়া যায়নি: '+error.message);else setDocuments(data||[]);
  }
  async function saveMember(e:FormEvent){
    e.preventDefault();
    if(!canDo('members',editingMemberId?'update':'create'))return;
    if(!form.samity_id||!form.full_name.trim()||!form.primary_product||!form.gender||!form.admission_date||!form.date_of_birth||!form.father_name.trim()||!form.mother_name.trim()||!form.marital_status||!form.education_level||!form.phone.trim()||!form.nationality||!form.other_card_type||!form.present_division_id||!form.present_district_id||!form.present_upazila_id||!form.present_union.trim()||!form.present_village_id||(!form.permanent_same_as_present&&(!form.permanent_division_id||!form.permanent_district_id||!form.permanent_upazila_id||!form.permanent_union.trim()||!form.permanent_village_id))){
      setNotice('চিহ্নিত (*) আবশ্যক তথ্য পূরণ করুন।');return;
    }
    if(!/^\d{10}$/.test(form.smart_id||'') && form.smart_id){setNotice('Smart ID অবশ্যই ১০ ডিজিট হতে হবে।');return;}
    if(!/^\d{17}$/.test(form.national_id||'') && form.national_id){setNotice('National ID ১৭ ডিজিট হতে হবে।');return;}
    if(!/^\d{11}$/.test(form.phone)){setNotice('Mobile Number ১১ ডিজিট হতে হবে।');return;}
    setBusy(true);setNotice('');
    try{
      const {data:userData}=await db.auth.getUser();
      const payload={...form,branch_id:form.branch_id||null,samity_id:form.samity_id,
        admission_fee:Number(form.admission_fee||0),family_member_count:form.family_member_count?Number(form.family_member_count):null,
        yearly_income:form.yearly_income?Number(form.yearly_income):null,land_area:form.land_area?Number(form.land_area):null,
        phone:form.phone.trim()};
      delete payload.mandatory_amount;delete payload.optional_product_id;
      let result:any;
      if(editingMemberId){payload.updated_at=new Date().toISOString();result=await db.from('members').update(payload).eq('id',editingMemberId).select('*').single();}
      else{payload.created_by=userData.user?.id;result=await db.from('members').insert(payload).select('*').single();}
      const {data,error}=result;
      if(error)throw error;
      const enrollments:any[]=[];
      if(Number(form.mandatory_amount)>0)enrollments.push({member_id:data.id,savings_type:'mandatory',amount:Number(form.mandatory_amount),created_by:userData.user?.id});
      if(form.optional_product_id){
        const chosenAmount=Number(optionalAmount);
        if(!Number.isInteger(chosenAmount)||chosenAmount<100||chosenAmount>2000||chosenAmount%100!==0)throw new Error('ঐচ্ছিক সঞ্চয়ের মাসিক জমা ১০০ থেকে ২,০০০ টাকার মধ্যে ১০০ টাকার গুণিতক হতে হবে।');
        const p=schemes.find(x=>x.id===form.optional_product_id);
        if(p){
          const today=new Date().toISOString().slice(0,10);
          const version=schemeVersions.filter(v=>v.product_id===p.id&&v.is_active&&v.effective_from<=today).sort((a,b)=>b.version_no-a.version_no)[0];
          if(!version)throw new Error('নির্বাচিত স্কিমের কার্যকর সংস্করণ পাওয়া যায়নি।');
          enrollments.push({member_id:data.id,savings_type:'optional',product_id:p.id,product_version_id:version.id,version_no_snapshot:version.version_no,interest_rate_snapshot:version.interest_rate,conditions_snapshot:version.conditions,scheme_effective_from_snapshot:version.effective_from,amount:chosenAmount,term_months:version.term_months,product_name_snapshot:p.product_name,created_by:userData.user?.id});
        }
      }
      setSelectedMember(data);setTab('register');setStep(4);await refresh();
      if(!editingMemberId&&enrollments.length){const {error:saveError}=await db.from('member_savings_enrollments').insert(enrollments);if(saveError){setNotice('সদস্য নিবন্ধন হয়েছে, কিন্তু সঞ্চয়ের তথ্য সংরক্ষণ হয়নি: '+saveError.message);return;}}
      if(editingMemberId)await loadDocs(data);
      setNotice(editingMemberId?'সদস্যের তথ্য পরিবর্তন হয়েছে। Member Code অপরিবর্তিত আছে: '+data.member_code:'সদস্য নিবন্ধন সফল হয়েছে। Member Code: '+data.member_code);
    }catch(err){setNotice('সদস্য সংরক্ষণ হয়নি: '+(err instanceof Error?err.message:'অজানা সমস্যা'));}
    finally{setBusy(false);}
  }
  async function saveScheme(e:FormEvent){
    e.preventDefault();
    if(!canDo('optional_savings',editingSchemeId?'update':'create'))return;
    const term=Number(schemeForm.term_months);
    const rate=schemeForm.interest_rate===''?null:Number(schemeForm.interest_rate);
    
    if(!Number.isInteger(term)||term<1){setNotice('মেয়াদ মাসে নির্ধারণ করুন।');return;}
    if(rate!==null&&(!Number.isFinite(rate)||rate<0)){setNotice('সঠিক সুদের হার লিখুন।');return;}
    if(!schemeForm.effective_from){setNotice('কার্যকর হওয়ার তারিখ দিন।');return;}
    setBusy(true);setNotice('');
    try{
      const {data:userData}=await db.auth.getUser();
      let productId=editingSchemeId;
      if(!productId){
        const {data:product,error}=await db.from('optional_savings_products').insert({
          product_name:schemeForm.product_name.trim(),installment_amount:100,term_months:term,
          description:schemeForm.description||null,created_by:userData.user?.id
        }).select('*').single();
        if(error)throw error;
        productId=product.id;
      }
      const versionNo=schemeVersions.filter(v=>v.product_id===productId).reduce((n,v)=>Math.max(n,Number(v.version_no)||0),0)+1;
      let fileMeta:any={};
      if(schemeFile){
        const allowed=['application/pdf','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
        if(!allowed.includes(schemeFile.type))throw new Error('শুধু PDF, XLS বা XLSX ফাইল আপলোড করা যাবে।');
        if(schemeFile.size>20*1024*1024)throw new Error('ফাইলের সর্বোচ্চ সাইজ ২০ MB।');
        const path=productId+'/'+versionNo+'/'+Date.now()+'-'+schemeFile.name.replace(/[^a-zA-Z0-9._-]/g,'_');
        const {error}=await db.storage.from('scheme-rules').upload(path,schemeFile,{upsert:false,contentType:schemeFile.type});
        if(error)throw error;
        fileMeta={rules_file_name:schemeFile.name,rules_storage_path:path,rules_file_type:schemeFile.type,rules_file_size:schemeFile.size};
      }
      const {error:versionError}=await db.from('optional_savings_product_versions').insert({
        product_id:productId,version_no:versionNo,installment_amount:null,term_months:term,
        interest_rate:rate,effective_from:schemeForm.effective_from,conditions:{monthly_due_day:14,late_fee_trigger:'policy_verification_required'},
        calculation_method:'pending_policy_mapping',created_by:userData.user?.id,...fileMeta
      });
      if(versionError)throw versionError;
      setSchemeForm({product_name:'',term_months:'60',interest_rate:'7',effective_from:new Date().toISOString().slice(0,10),description:''});
      setSchemeFile(null);setEditingSchemeId(null);
      setNotice('স্কিমের নতুন সংস্করণ সংরক্ষণ হয়েছে। পুরোনো সদস্যদের সংস্করণ অপরিবর্তিত থাকবে।');
      await refresh();
    }catch(err){setNotice('স্কিম সংরক্ষণ হয়নি: '+(err instanceof Error?err.message:'অজানা সমস্যা'));}
    finally{setBusy(false);}
  }
  async function uploadDocument(type:string,file:File){
    if(!selectedMember||(!canDo('members','create')&&!canDo('members','update')))return;
    setBusy(true);setNotice('');
    try{
      const path=selectedMember.id+'/'+type+'/'+Date.now()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
      const {error:uploadError}=await db.storage.from('member-documents').upload(path,file,{upsert:false,contentType:file.type});
      if(uploadError)throw uploadError;
      const {data:userData}=await db.auth.getUser();
      const {error}=await db.from('member_documents').insert({member_id:selectedMember.id,document_type:type,file_name:file.name,storage_path:path,content_type:file.type,file_size:file.size,uploaded_by:userData.user?.id,uploaded_by_name:fullName});
      if(error){await db.storage.from('member-documents').remove([path]);throw error;}
      await loadDocs(selectedMember);setNotice('ডকুমেন্ট আপলোড হয়েছে।');
    }catch(err){setNotice('আপলোড হয়নি: '+(err instanceof Error?err.message:'অজানা সমস্যা'));}
    finally{setBusy(false);}
  }
  async function viewDocument(doc:any){
    const {data,error}=await db.storage.from('member-documents').createSignedUrl(doc.storage_path,60);
    if(error)setNotice('ফাইল খোলা যায়নি: '+error.message);else window.open(data.signedUrl,'_blank','noopener,noreferrer');
  }
  async function deleteDocument(doc:any){
    if(!canDo('members','delete')||!window.confirm('এই ডকুমেন্ট মুছে ফেলবেন?'))return;
    const {error}=await db.storage.from('member-documents').remove([doc.storage_path]);
    if(error){setNotice('ফাইল মুছে ফেলা যায়নি: '+error.message);return;}
    const {error:dbError}=await db.from('member_documents').delete().eq('id',doc.id);
    if(dbError)setNotice('ডকুমেন্ট তথ্য মুছতে সমস্যা: '+dbError.message);else{setDocuments(old=>old.filter(x=>x.id!==doc.id));setNotice('ডকুমেন্ট মুছে ফেলা হয়েছে।');}
  }
  const field=(label:string,key:string,required=false,type='text',options?:string[])=><label className="field">{label}{required?' *':''}{options?<select required={required} value={form[key]||''} onChange={e=>set(key,e.target.value)}><option value="">নির্বাচন করুন</option>{options.map(x=><option key={x} value={x}>{x}</option>)}</select>:<input required={required} type={type} value={form[key]??''} onChange={e=>set(key,e.target.value)} />}</label>;
  const areaSelect=(label:string,key:string,rows:any[],parentKey?:string,resetKeys:string[]=[],required=true)=> <label className="field">{label}{required?' *':''}<select required={required} value={form[key]||''} onChange={e=>setForm((old:any)=>({...old,[key]:e.target.value,...Object.fromEntries(resetKeys.map(k=>[k,'' ])),...(old.permanent_same_as_present?Object.fromEntries(resetKeys.filter(k=>mirrored[k]).map(k=>[mirrored[k],'' ])):{}),...(old.permanent_same_as_present&&mirrored[key]?{[mirrored[key]]:e.target.value}:{})}))}><option value="">নির্বাচন করুন</option>{rows.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>;
  const steps=['Basic Info','Contact Details','Other Info','Savings Info','Documents'];
  return <section className="workspace">
    <div className="panel"><div><p className="eyebrow">{initialTab==='schemes'?'OPTIONAL SAVINGS MANAGEMENT':'MEMBER MANAGEMENT'}</p><h2>{initialTab==='schemes'?'Optional Savings Setup':'সদস্য নিবন্ধন ও তালিকা'}</h2><p>{initialTab==='schemes'?'ঐচ্ছিক সঞ্চয় স্কিম তৈরি, সংস্করণ ও নীতিমালা পরিচালনা।':'সদস্য তালিকা, নতুন সদস্য নিবন্ধন এবং সদস্যের ডকুমেন্ট ব্যবস্থাপনা।'}</p></div>{initialTab!=='schemes'&&<div className="form-actions"><button type="button" onClick={()=>{setTab('list');setSelectedMember(null);setEditingMemberId(null);}}>সদস্য তালিকা</button>{canDo('members','create')&&<button type="button" onClick={()=>{setForm({...emptyForm});setSelectedMember(null);setEditingMemberId(null);setExistingLookup('');setStep(0);setTab('register');setNotice('');}}>নতুন সদস্য নিবন্ধন</button>}</div>}</div>
    {notice&&<div className="notice">{notice}</div>}
    {initialTab!=='schemes'&&tab==='list'&&<><label className="field">সদস্য খুঁজুন<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Member Code / নাম / মোবাইল" /></label><div className="table-wrap"><table><thead><tr><th>Member Code</th><th>সদস্যের নাম</th><th>Mobile</th><th>Admission Date</th><th>Action</th></tr></thead><tbody>{filtered.map(m=><tr key={m.id}><td>{m.member_code}</td><td>{m.full_name}</td><td>{m.phone||'—'}</td><td>{m.admission_date}</td><td>{canDo('members','update')&&<button type="button" className="secondary" onClick={()=>{const {id,member_code,created_at,updated_at,created_by,is_active,...editable}=m;setForm({...emptyForm,...Object.fromEntries(Object.keys(emptyForm).map(k=>[k,m[k]??emptyForm[k]])),branch_id:m.branch_id||'',samity_id:m.samity_id||'',mandatory_amount:'0',optional_product_id:''});setEditingMemberId(m.id);setExistingLookup(m.id);loadDocs(m);setTab('register');setStep(0);}}>Edit</button>} <button type="button" className="secondary" onClick={()=>{setEditingMemberId(null);setForm({...emptyForm});loadDocs(m);setTab('register');setStep(4);}}>Documents</button></td></tr>)}{!filtered.length&&<tr><td colSpan={5} className="empty">কোনো সদস্য পাওয়া যায়নি।</td></tr>}</tbody></table></div></>}
    {initialTab!=='schemes'&&tab==='register'&&<><div className="step-tabs">{steps.map((s,i)=><button type="button" key={s} className={step===i?'active':''} onClick={()=>setStep(i)}>{i+1}. {s}</button>)}</div>
      {step===0&&<div><label className="field">Existing Member (search)<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Member Code / নাম / মোবাইল"/><select value={existingLookup} onChange={e=>{setExistingLookup(e.target.value);const m=members.find(x=>x.id===e.target.value);if(m){const {id,member_code,created_at,updated_at,created_by,is_active,...editable}=m;setForm({...emptyForm,...Object.fromEntries(Object.keys(emptyForm).map(k=>[k,m[k]??emptyForm[k]])),branch_id:m.branch_id||'',samity_id:m.samity_id||'',mandatory_amount:'0',optional_product_id:''});setEditingMemberId(m.id);loadDocs(m);setStep(0);}else{setEditingMemberId(null);setSelectedMember(null);setForm({...emptyForm});}}}><option value="">নতুন সদস্য / নির্বাচন করুন</option>{members.filter(m=>[m.member_code,m.full_name,m.phone].some(v=>String(v||'').toLowerCase().includes(query.toLowerCase()))).map(m=><option key={m.id} value={m.id}>{m.member_code} — {m.full_name}</option>)}</select></label><div className="form-grid">
        <label className="field">Branch *<select required disabled={Boolean(editingMemberId)} value={form.branch_id} onChange={e=>setForm((o:any)=>({...o,branch_id:e.target.value,samity_id:''}))}><option value="">Branch নির্বাচন</option>{branches.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.branch_code} — {x.branch_name}</option>)}</select></label>
        <label className="field">Branch Code<input readOnly value={selectedBranch?.branch_code||''}/></label>
        <label className="field">Samity Name *<select required disabled={Boolean(editingMemberId)} value={form.samity_id} onChange={e=>set('samity_id',e.target.value)}><option value="">সমিতি নির্বাচন</option>{activeSamities.map(x=><option key={x.id} value={x.id}>{x.samity_code} — {x.samity_name}</option>)}</select></label>
        <label className="field">Samity Group Code<input readOnly value={selectedSamity?.samity_code||''}/></label>
        {field('Member Name','full_name',true)}{field('Member Surname','member_surname')}{field('Primary Product','primary_product',true)}
        <label className="field">Gender *<select required value={form.gender} onChange={e=>set('gender',e.target.value)}><option value="female">Female</option><option value="male">Male</option></select></label>
        <label className="field">Third Gender? *<select required value={form.is_third_gender?'yes':'no'} onChange={e=>set('is_third_gender',e.target.value==='yes')}><option value="no">No</option><option value="yes">Yes</option></select></label>
        {field('Admission Date','admission_date',true,'date')}{field('Date of Birth','date_of_birth',true,'date')}<label className="field">Age<input readOnly value={form.date_of_birth?Math.max(0,Math.floor((new Date().getTime()-new Date(form.date_of_birth).getTime())/31557600000)):''}/></label>{field('Father Name','father_name',true)}{field('Mother Name','mother_name',true)}
        {field('Marital Status','marital_status',true,'text',['Unmarried','Married','Divorced','Widower','Widow'])}{field('Admission Fee','admission_fee',false,'number')}{field('Admission No','admission_no')}{field('Application No','application_no')}
        {field('Education Level','education_level',true,'text',['B.Com','B.Sc','BA','BBA','BBS','BSS','HSC','JSC','M.Com','M.Sc','MA','MBA','MBS','MSS','Pre-Primary','PSC','SSC'])}
        {field('Mobile Number','phone',true,'tel')}{field('Nationality','nationality',true)}{field('Smart ID (10 digit)','smart_id')}{field('National ID (17 digit)','national_id')}{field('Birth Registration No','birth_registration_no')}{field('TIN No','tin_no')}
        {field('Other Card Type','other_card_type',true,'text',['Passport','Driving License'])}{field('Other Card No','other_card_no')}
      </div><div className="form-actions"><button type="button" className="secondary" onClick={()=>setStep(1)}>পরবর্তী: Contact Details</button></div></div>}
      {step===1&&<><h3>Present Address</h3><div className="form-grid">
        {areaSelect('Division','present_division_id',divisions)}{areaSelect('District','present_district_id',districtsFor(form.present_division_id),'present_division_id',['present_upazila_id','present_post_office_id','present_village_id'])}
        {areaSelect('Thana / Upazila','present_upazila_id',upazilasFor(form.present_district_id),'present_district_id',['present_post_office_id','present_village_id'])}{field('Union / Ward','present_union',true)}
        {areaSelect('Post Office','present_post_office_id',postFor(form.present_upazila_id),'present_upazila_id',['present_village_id'],false)}{areaSelect('Village / Block','present_village_id',villagesFor(form.present_post_office_id))}
        {field('Present House / Street','present_house_street')}{field('Family Contact No','family_contact_no')}
      </div><h3>Permanent Address</h3><label><input type="checkbox" checked={form.permanent_same_as_present} onChange={e=>sameAddress(e.target.checked)}/> Same as Present</label>
      {!form.permanent_same_as_present&&<div className="form-grid">
        {areaSelect('Division','permanent_division_id',divisions)}{areaSelect('District','permanent_district_id',districtsFor(form.permanent_division_id),'permanent_division_id',['permanent_upazila_id','permanent_post_office_id','permanent_village_id'])}{areaSelect('Thana / Upazila','permanent_upazila_id',upazilasFor(form.permanent_district_id),'permanent_district_id',['permanent_post_office_id','permanent_village_id'])}
        {field('Union / Ward','permanent_union')}{areaSelect('Post Office','permanent_post_office_id',postFor(form.permanent_upazila_id),'permanent_upazila_id',['permanent_village_id'],false)}{areaSelect('Village / Block','permanent_village_id',villagesFor(form.permanent_post_office_id))}
        {field('Permanent House / Street','permanent_house_street')}{field('Permanent Contact No','permanent_contact_no')}
      </div>}<div className="form-actions"><button type="button" className="secondary" onClick={()=>setStep(0)}>পূর্ববর্তী</button><button type="button" onClick={()=>setStep(2)}>পরবর্তী</button></div></>}
      {step===2&&<><div className="form-grid">{field('Member Type','member_type',false,'text',['General'])}{field('Profession','profession',true)}{field('Religion','religion',false,'text',['Muslim','Hindu','Christian','Buddhist','Other'])}{field('Remarks','remarks')}{field('No of Family Member','family_member_count',false,'number')}{field('Yearly Income','yearly_income',false,'number')}{field('Land Area','land_area',false,'number')}{field('Land Area Unit','land_area_unit',false,'text',['Acre','Decimal','Bigha'])}{field('Note','other_note')}</div><div className="form-actions"><button type="button" className="secondary" onClick={()=>setStep(1)}>পূর্ববর্তী</button><button type="button" onClick={()=>setStep(3)}>পরবর্তী</button></div></>}
      {step===3&&<form onSubmit={saveMember}><div className="form-grid">{editingMemberId?<p className="muted">পুরোনো সদস্যের সঞ্চয় চুক্তি পরিবর্তন এখানে করা হবে না; নতুন সঞ্চয়ের হিসাব Savings মডিউলে পরিচালনা করুন।</p>:<>{field('Mandatory Savings Amount','mandatory_amount',false,'number')}<label className="field">Optional Savings Scheme<select value={form.optional_product_id} onChange={e=>set('optional_product_id',e.target.value)}><option value="">কোনো স্কিম নয়</option>{schemes.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.product_name}</option>)}</select></label>{form.optional_product_id&&<label className="field">মাসিক জমার পরিমাণ (৳) *<select required value={optionalAmount} onChange={e=>setOptionalAmount(e.target.value)}>{Array.from({length:20},(_,i)=>(i+1)*100).map(amount=><option key={amount} value={String(amount)}>৳{amount.toLocaleString('en-US')}</option>)}</select></label>}</>}</div><p className="muted">Optional Savings স্কিম আগে Optional Savings Setup থেকে তৈরি করতে হবে।</p><div className="form-actions"><button type="button" className="secondary" onClick={()=>setStep(2)}>পূর্ববর্তী</button><button disabled={busy}>{editingMemberId?'পরিবর্তন সংরক্ষণ করুন':'সদস্য সংরক্ষণ করুন'}</button></div></form>}
      {step===4&&<><h3>{selectedMember?'Member Documents — '+selectedMember.member_code:'ডকুমেন্ট আপলোডের জন্য আগে সদস্য সংরক্ষণ করুন'}</h3>{selectedMember?<div className="table-wrap"><table><thead><tr><th>Type</th><th>Name</th><th>Uploaded By</th><th>Size</th><th>Date Modified</th><th>Action</th></tr></thead><tbody>{documentTypes.map(([type,label])=>{const doc=documents.find(x=>x.document_type===type);return <tr key={type}><td>{label}</td><td>{doc?.file_name||'—'}</td><td>{doc?.uploaded_by_name||'—'}</td><td>{doc?Math.ceil(doc.file_size/1024)+' KB':'—'}</td><td>{doc?String(doc.created_at).slice(0,10):'—'}</td><td>{doc?<><button type="button" className="secondary" onClick={()=>viewDocument(doc)}>View</button> {canDo('members','delete')&&<button type="button" className="danger" onClick={()=>deleteDocument(doc)}>Delete</button>}</>:<label className="upload-label">Upload<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={(!canDo('members','create')&&!canDo('members','update'))||busy} onChange={e=>{const f=e.target.files?.[0];if(f)uploadDocument(type,f);e.currentTarget.value='';}} /></label>}</td></tr>})}</tbody></table></div>:<p className="muted">প্রথমে Basic Info থেকে সদস্য সংরক্ষণ করুন, তারপর এই ট্যাবে ছবি, স্বাক্ষর ও অন্যান্য কাগজপত্র আপলোড করতে পারবেন।</p>}<div className="form-actions"><button type="button" className="secondary" onClick={()=>setStep(3)}>পূর্ববর্তী</button><button type="button" onClick={()=>setTab('list')}>সদস্য তালিকায় ফিরুন</button></div></>}
    </>}
    {initialTab==='schemes'&&tab==='schemes'&&<><h3>Optional Savings Setup — স্কিম ও সংস্করণ</h3>{(canDo('optional_savings','create')||editingSchemeId)&&<form onSubmit={saveScheme}><div className="form-grid">
      <label className="field">Scheme Name *<input required disabled={Boolean(editingSchemeId)} value={schemeForm.product_name} onChange={e=>setSchemeForm({...schemeForm,product_name:e.target.value})}/></label>
      
      <label className="field">মেয়াদ (মাস) *<input required type="number" min="1" step="1" value={schemeForm.term_months} onChange={e=>setSchemeForm({...schemeForm,term_months:e.target.value})}/></label>
      <label className="field">সুদের হার (%)<input type="number" min="0" step="0.0001" value={schemeForm.interest_rate} onChange={e=>setSchemeForm({...schemeForm,interest_rate:e.target.value})}/></label>
      <label className="field">কার্যকর হওয়ার তারিখ *<input required type="date" value={schemeForm.effective_from} onChange={e=>setSchemeForm({...schemeForm,effective_from:e.target.value})}/></label>
      <label className="field">বিবরণ<input value={schemeForm.description} onChange={e=>setSchemeForm({...schemeForm,description:e.target.value})}/></label>
      <label className="field">নীতিমালা / হিসাবের ফাইল (PDF, XLS, XLSX)<input type="file" accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e=>setSchemeFile(e.target.files?.[0]||null)}/></label>
    </div><p className="muted">প্রতিটি পরিবর্তনে নতুন সংস্করণ তৈরি হবে। আগের সদস্যদের শর্ত বদলাবে না। নীতিমালা অনুযায়ী মাসিক কিস্তির শেষ তারিখ ১৪ এবং ১৪ তারিখের পরে জমায় ১০ টাকা বিলম্ব ফি স্কিমের সংস্করণে সংরক্ষিত হবে। মেয়াদপূর্তির চূড়ান্ত প্রাপ্য টাকার সূত্র যাচাই করে আলাদাভাবে যুক্ত হবে।</p><div className="form-actions"><button disabled={busy}>{editingSchemeId?'নতুন সংস্করণ সংরক্ষণ':'নতুন স্কিম তৈরি'}</button>{editingSchemeId&&<button type="button" className="secondary" onClick={()=>{setEditingSchemeId(null);setSchemeForm({product_name:'',term_months:'60',interest_rate:'7',effective_from:new Date().toISOString().slice(0,10),description:''});setSchemeFile(null);}}>বাতিল</button>}</div></form>}
    <div className="table-wrap"><table><thead><tr><th>স্কিম</th><th>সংস্করণ</th><th>মাসিক জমার সীমা</th><th>মেয়াদ</th><th>সুদ</th><th>কার্যকর তারিখ</th><th>অবস্থা</th><th>কাজ</th></tr></thead><tbody>{schemes.map(x=>{const vs=schemeVersions.filter(v=>v.product_id===x.id).sort((a,b)=>b.version_no-a.version_no);const latest=vs[0];return <tr key={x.id}><td>{x.product_name}</td><td>{latest?'v'+latest.version_no:'সংস্করণ নেই'}</td><td>{latest?'৳১০০–৳২,০০০ (সদস্য নির্বাচন)':'—'}</td><td>{latest?latest.term_months+' মাস':'—'}</td><td>{latest&&latest.interest_rate!==null?latest.interest_rate+'%':'—'}</td><td>{latest?.effective_from||'—'}</td><td>{x.is_active?'Active':'Inactive'}</td><td>{canDo('optional_savings','update')&&<button type="button" className="secondary" onClick={()=>{setEditingSchemeId(x.id);setSchemeForm({product_name:x.product_name,term_months:String(latest?.term_months||60),interest_rate:latest?.interest_rate==null?'':String(latest.interest_rate),effective_from:new Date().toISOString().slice(0,10),description:x.description||''});setSchemeFile(null);}}>নতুন সংস্করণ</button>}</td></tr>})}</tbody></table></div></>}

  </section>;
}
