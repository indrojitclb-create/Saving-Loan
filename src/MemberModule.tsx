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
  const [documents,setDocuments]=useState<any[]>([]);
  const [selectedMember,setSelectedMember]=useState<any>(null);
  const [query,setQuery]=useState('');
  const [existingLookup,setExistingLookup]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const [schemeForm,setSchemeForm]=useState({product_name:'',installment_amount:'',term_months:'',description:''});
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
    const [m,s]=await Promise.all([
      db.from('members').select('id,member_code,full_name,phone,admission_date,branch_id,samity_id,is_active').order('created_at',{ascending:false}),
      db.from('optional_savings_products').select('*').order('product_name')
    ]);
    if(m.error)setNotice('সদস্য তালিকা পড়া যায়নি: '+m.error.message);else setMembers(m.data||[]);
    if(s.error)setNotice('সঞ্চয় স্কিম পড়া যায়নি: '+s.error.message);else setSchemes(s.data||[]);
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
    if(!canDo('members','create'))return;
    if(!form.samity_id||!form.full_name.trim()||!form.primary_product||!form.gender||!form.admission_date||!form.date_of_birth||!form.father_name.trim()||!form.mother_name.trim()||!form.marital_status||!form.education_level||!form.phone.trim()||!form.nationality||!form.present_division_id||!form.present_district_id||!form.present_upazila_id||!form.present_union.trim()||!form.present_village_id||(!form.permanent_same_as_present&&(!form.permanent_division_id||!form.permanent_district_id||!form.permanent_upazila_id||!form.permanent_union.trim()||!form.permanent_village_id))){
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
        created_by:userData.user?.id,phone:form.phone.trim()};
      delete payload.mandatory_amount;delete payload.optional_product_id;
      const {data,error}=await db.from('members').insert(payload).select('*').single();
      if(error)throw error;
      const enrollments:any[]=[];
      if(Number(form.mandatory_amount)>0)enrollments.push({member_id:data.id,savings_type:'mandatory',amount:Number(form.mandatory_amount),created_by:userData.user?.id});
      if(form.optional_product_id){
        const p=schemes.find(x=>x.id===form.optional_product_id);
        if(p)enrollments.push({member_id:data.id,savings_type:'optional',product_id:p.id,amount:Number(p.installment_amount),term_months:p.term_months,product_name_snapshot:p.product_name,created_by:userData.user?.id});
      }
      setSelectedMember(data);setTab('register');setStep(4);await refresh();
      if(enrollments.length){const {error:saveError}=await db.from('member_savings_enrollments').insert(enrollments);if(saveError){setNotice('সদস্য নিবন্ধন হয়েছে, কিন্তু সঞ্চয়ের তথ্য সংরক্ষণ হয়নি: '+saveError.message);return;}}
      setNotice('সদস্য নিবন্ধন সফল হয়েছে। Member Code: '+data.member_code);
    }catch(err){setNotice('সদস্য সংরক্ষণ হয়নি: '+(err instanceof Error?err.message:'অজানা সমস্যা'));}
    finally{setBusy(false);}
  }
  async function saveScheme(e:FormEvent){
    e.preventDefault();if(!canDo('optional_savings','create')&&!canDo('optional_savings','update'))return;
    setBusy(true);setNotice('');
    const {data:userData}=await db.auth.getUser();
    const values={product_name:schemeForm.product_name.trim(),installment_amount:Number(schemeForm.installment_amount),term_months:Number(schemeForm.term_months),description:schemeForm.description||null};
    const result=editingSchemeId
      ? await db.from('optional_savings_products').update(values).eq('id',editingSchemeId)
      : await db.from('optional_savings_products').insert({...values,created_by:userData.user?.id});
    setBusy(false);if(result.error)setNotice('স্কিম সংরক্ষণ হয়নি: '+result.error.message);else{setSchemeForm({product_name:'',installment_amount:'',term_months:'',description:''});setEditingSchemeId(null);setNotice('Optional Savings স্কিম সংরক্ষণ হয়েছে।');refresh();}
  }
  async function uploadDocument(type:string,file:File){
    if(!selectedMember||!canDo('members','create'))return;
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
  const areaSelect=(label:string,key:string,rows:any[],parentKey?:string,resetKeys:string[]=[],required=true)=> <label className="field">{label}{required?' *':''}<select required={required} value={form[key]||''} onChange={e=>setForm((old:any)=>({...old,[key]:e.target.value,...Object.fromEntries(resetKeys.map(k=>[k,'' ])),...(old.permanent_same_as_present&&mirrored[key]?{[mirrored[key]]:e.target.value}:{})}))}><option value="">নির্বাচন করুন</option>{rows.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>;
  const steps=['Basic Info','Contact Details','Other Info','Savings Info','Documents'];
  return <section className="workspace">
    <div className="panel"><div><p className="eyebrow">MEMBER MANAGEMENT</p><h2>সদস্য নিবন্ধন ও তালিকা</h2><p>নতুন সদস্য, সঞ্চয় স্কিম এবং সদস্যের ডকুমেন্ট ব্যবস্থাপনা।</p></div><div className="form-actions"><button type="button" onClick={()=>{setTab('list');setSelectedMember(null);}}>সদস্য তালিকা</button>{canDo('members','create')&&<button type="button" onClick={()=>{setForm({...emptyForm});setSelectedMember(null);setStep(0);setTab('register');setNotice('');}}>নতুন সদস্য নিবন্ধন</button>}{canDo('optional_savings','view')&&<button type="button" onClick={()=>setTab('schemes')}>Optional Savings Setup</button>}</div></div>
    {notice&&<div className="notice">{notice}</div>}
    {tab==='list'&&<><label className="field">সদস্য খুঁজুন<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Member Code / নাম / মোবাইল" /></label><div className="table-wrap"><table><thead><tr><th>Member Code</th><th>সদস্যের নাম</th><th>Mobile</th><th>Admission Date</th><th>Action</th></tr></thead><tbody>{filtered.map(m=><tr key={m.id}><td>{m.member_code}</td><td>{m.full_name}</td><td>{m.phone||'—'}</td><td>{m.admission_date}</td><td><button type="button" className="secondary" onClick={()=>{loadDocs(m);setTab('register');setStep(4);}}>Documents</button></td></tr>)}{!filtered.length&&<tr><td colSpan={5} className="empty">কোনো সদস্য পাওয়া যায়নি।</td></tr>}</tbody></table></div></>}
    {tab==='register'&&<><div className="step-tabs">{steps.map((s,i)=><button type="button" key={s} className={step===i?'active':''} onClick={()=>setStep(i)}>{i+1}. {s}</button>)}</div>
      {step===0&&<div><label className="field">Existing Member (search)<select value={existingLookup} onChange={e=>{setExistingLookup(e.target.value);const m=members.find(x=>x.id===e.target.value);if(m){loadDocs(m);setStep(4);}}}><option value="">নতুন সদস্য / নির্বাচন করুন</option>{members.map(m=><option key={m.id} value={m.id}>{m.member_code} — {m.full_name}</option>)}</select></label><div className="form-grid">
        <label className="field">Branch *<select required value={form.branch_id} onChange={e=>setForm((o:any)=>({...o,branch_id:e.target.value,samity_id:''}))}><option value="">Branch নির্বাচন</option>{branches.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.branch_code} — {x.branch_name}</option>)}</select></label>
        <label className="field">Branch Code<input readOnly value={selectedBranch?.branch_code||''}/></label>
        <label className="field">Samity Name *<select required value={form.samity_id} onChange={e=>set('samity_id',e.target.value)}><option value="">সমিতি নির্বাচন</option>{activeSamities.map(x=><option key={x.id} value={x.id}>{x.samity_code} — {x.samity_name}</option>)}</select></label>
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
      {step===3&&<form onSubmit={saveMember}><div className="form-grid">{field('Mandatory Savings Amount','mandatory_amount',false,'number')}<label className="field">Optional Savings Scheme<select value={form.optional_product_id} onChange={e=>set('optional_product_id',e.target.value)}><option value="">কোনো স্কিম নয়</option>{schemes.filter(x=>x.is_active).map(x=><option key={x.id} value={x.id}>{x.product_name} — ৳{x.installment_amount} / {x.term_months} মাস</option>)}</select></label></div><p className="muted">Optional Savings স্কিম আগে Optional Savings Setup থেকে তৈরি করতে হবে।</p><div className="form-actions"><button type="button" className="secondary" onClick={()=>setStep(2)}>পূর্ববর্তী</button><button disabled={busy}>সদস্য সংরক্ষণ করুন</button></div></form>}
      {step===4&&<><h3>{selectedMember?'Member Documents — '+selectedMember.member_code:'ডকুমেন্ট আপলোডের জন্য আগে সদস্য সংরক্ষণ করুন'}</h3>{selectedMember?<div className="table-wrap"><table><thead><tr><th>Type</th><th>Name</th><th>Uploaded By</th><th>Size</th><th>Date Modified</th><th>Action</th></tr></thead><tbody>{documentTypes.map(([type,label])=>{const doc=documents.find(x=>x.document_type===type);return <tr key={type}><td>{label}</td><td>{doc?.file_name||'—'}</td><td>{doc?.uploaded_by_name||'—'}</td><td>{doc?Math.ceil(doc.file_size/1024)+' KB':'—'}</td><td>{doc?String(doc.created_at).slice(0,10):'—'}</td><td>{doc?<><button type="button" className="secondary" onClick={()=>viewDocument(doc)}>View</button> {canDo('members','delete')&&<button type="button" className="danger" onClick={()=>deleteDocument(doc)}>Delete</button>}</>:<label className="upload-label">Upload<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={!canDo('members','create')||busy} onChange={e=>{const f=e.target.files?.[0];if(f)uploadDocument(type,f);e.currentTarget.value='';}} /></label>}</td></tr>})}</tbody></table></div>:<p className="muted">প্রথমে Basic Info থেকে সদস্য সংরক্ষণ করুন, তারপর এই ট্যাবে ছবি, স্বাক্ষর ও অন্যান্য কাগজপত্র আপলোড করতে পারবেন।</p>}<div className="form-actions"><button type="button" className="secondary" onClick={()=>setStep(3)}>পূর্ববর্তী</button><button type="button" onClick={()=>setTab('list')}>সদস্য তালিকায় ফিরুন</button></div></>}
    </>}
    {tab==='schemes'&&<><h3>Optional Savings Setup</h3>{(canDo('optional_savings','create')||editingSchemeId)&&<form onSubmit={saveScheme}><div className="form-grid"><label className="field">Scheme Name *<input required value={schemeForm.product_name} onChange={e=>setSchemeForm({...schemeForm,product_name:e.target.value})}/></label><label className="field">Installment Amount *<input required type="number" min="1" value={schemeForm.installment_amount} onChange={e=>setSchemeForm({...schemeForm,installment_amount:e.target.value})}/></label><label className="field">Term (Months) *<input required type="number" min="1" value={schemeForm.term_months} onChange={e=>setSchemeForm({...schemeForm,term_months:e.target.value})}/></label><label className="field">Description<input value={schemeForm.description} onChange={e=>setSchemeForm({...schemeForm,description:e.target.value})}/></label></div><div className="form-actions"><button disabled={busy}>{editingSchemeId?'পরিবর্তন সংরক্ষণ':'স্কিম সংরক্ষণ করুন'}</button>{editingSchemeId&&<button type="button" className="secondary" onClick={()=>{setEditingSchemeId(null);setSchemeForm({product_name:'',installment_amount:'',term_months:'',description:''});}}>বাতিল</button>}</div></form>}<div className="table-wrap"><table><thead><tr><th>Scheme</th><th>Amount</th><th>Term</th><th>Status</th><th>Action</th></tr></thead><tbody>{schemes.map(x=><tr key={x.id}><td>{x.product_name}</td><td>৳{x.installment_amount}</td><td>{x.term_months} মাস</td><td>{x.is_active?'Active':'Inactive'}</td><td>{canDo('optional_savings','update')&&<button type="button" className="secondary" onClick={()=>{setEditingSchemeId(x.id);setSchemeForm({product_name:x.product_name,installment_amount:String(x.installment_amount),term_months:String(x.term_months),description:x.description||''});}}>Edit</button>} {canDo('optional_savings','update')&&<button type="button" className="secondary" onClick={async()=>{const {error}=await db.from('optional_savings_products').update({is_active:!x.is_active}).eq('id',x.id);if(error)setNotice('Status পরিবর্তন হয়নি: '+error.message);else{setNotice('স্কিমের Status পরিবর্তন হয়েছে।');refresh();}}}>{x.is_active?'Deactivate':'Activate'}</button>}</td></tr>)}</tbody></table></div></>}
  </section>;
}
