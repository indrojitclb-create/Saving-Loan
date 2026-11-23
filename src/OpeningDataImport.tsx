import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
import { supabase } from './lib/supabase';
import { calculateLoanSchedule, calculateFirstInstallmentDate, buildInstallmentDates } from './lib/loanCalculation';

type Tab = 'member' | 'savings' | 'loan';
type Props = {
  tab: Tab;
  members: any[];
  samities: any[];
  canDo: (moduleKey: string, action: 'view'|'create'|'update'|'delete') => boolean;
  userId: string;
  onDone: () => void;
};
type ImportRow = { line: number; member_code: string; member_id?: string; name?: string; data: Record<string, any>; error: string };
const aliases: Record<string,string[]> = {
  member_code:['member code','member_code','সদস্য কোড','সদস্যের কোড','কোড'],
  father_name:['father name','father_name','পিতার নাম','বাবার নাম'],
  mother_name:['mother name','mother_name','মাতার নাম','মায়ের নাম'],
  spouse_name:['spouse name','spouse_name','স্বামী/স্ত্রীর নাম'],
  admission_date:['admission date','admission_date','ভর্তির তারিখ'],
  date_of_birth:['date of birth','dob','date_of_birth','জন্ম তারিখ'],
  marital_status:['marital status','marital_status','বৈবাহিক অবস্থা'],
  education_level:['education level','education_level','শিক্ষাগত যোগ্যতা','শিক্ষা'],
  phone:['phone','mobile','mobile number','মোবাইল','মোবাইল নম্বর'],
  nationality:['nationality','জাতীয়তা'],
  smart_id:['smart id','smart_id','স্মার্ট আইডি'],
  national_id:['national id','national_id','nid','জাতীয় পরিচয়পত্র','জাতীয় পরিচয় পত্র'],
  birth_registration_no:['birth registration no','birth_registration_no','জন্ম নিবন্ধন','জন্ম নিবন্ধন নম্বর'],
  tin_no:['tin','tin no','tin_no','টিআইএন'],
  profession:['profession','পেশা'],
  religion:['religion','ধর্ম'],
  member_type:['member type','member_type','সদস্যের ধরন'],
  present_union:['present union','present_union','ইউনিয়ন','ইউনিয়ন/ওয়ার্ড'],
  present_house_street:['present address','present_house_street','বর্তমান ঠিকানা'],
  family_contact_no:['family contact no','family_contact_no','পরিবারের যোগাযোগ নম্বর'],
  permanent_house_street:['permanent address','permanent_house_street','স্থায়ী ঠিকানা'],
  permanent_contact_no:['permanent contact no','permanent_contact_no','স্থায়ী যোগাযোগ নম্বর'],
  family_member_count:['family member count','family_member_count','পরিবারের সদস্য সংখ্যা'],
  yearly_income:['yearly income','yearly_income','বার্ষিক আয়'],
  land_area:['land area','land_area','জমির পরিমাণ'],
  land_area_unit:['land area unit','land_area_unit','জমির একক'],
  remarks:['remarks','notes','মন্তব্য'],
  opening_date:['opening date','opening_date','ওপেনিং তারিখ','প্রারম্ভিক তারিখ'],
  gs_balance:['gs balance','gs_balance','general savings','জিএস স্থিতি','সাধারণ সঞ্চয়'],
  lts_new_balance:['lts new balance','lts_new_balance','lts balance','এলটিএস স্থিতি'],
  optional_balance:['optional balance','optional_balance','optional savings','ঐচ্ছিক সঞ্চয়','অপশনাল সঞ্চয়'],
  optional_opening_date:['optional opening date','optional_opening_date','optional savings opening date','ঐচ্ছিক সঞ্চয়ের তারিখ'],
  optional_monthly_installment_amount:['optional monthly installment amount','optional_monthly_installment_amount','মাসিক জমা','মাসিক কিস্তি'],
  optional_installments_paid:['optional installments paid','optional_installments_paid','জমাকৃত কিস্তি','কিস্তি সংখ্যা'],
  loan_no:['loan no','loan_no','ঋণ নম্বর','ঋণ নং'],
  disbursement_date:['disbursement date','disbursement_date','ঋণ বিতরণের তারিখ','বিতরণের তারিখ'],
  project_name:['project','project name','project_name','প্রকল্প','প্রকল্পের নাম'],
  loan_cycle:['loan cycle','loan_cycle','দফা','দফা নং','কততম দফা'],
  principal_amount:['principal','principal amount','principal_amount','আসল','আসল ঋণ'],
  service_charge_amount:['service charge','service charge amount','service_charge_amount','সেবামূল্য'],
  amount_repaid_to_date:['amount repaid','amount repaid to date','amount_repaid_to_date','এ পর্যন্ত আদায়','মোট আদায়'],
  overdue_balance:['overdue balance','overdue_balance','বকেয়া স্থিতি','খেলাপি স্থিতি'],
  last_installment_no:['last installment no','last_installment_no','সর্বশেষ কিস্তি নম্বর','শেষ কিস্তি নম্বর'],
  last_installment_date:['last installment date','last_installment_date','সর্বশেষ কিস্তির তারিখ','শেষ কিস্তির তারিখ'],
  current_status:['status','current_status','অবস্থা']
};
const norm = (v:any) => String(v ?? '').trim().toLowerCase().replace(/[\\s_\\-]+/g,' ');
const keyFor = (h:any) => Object.keys(aliases).find(k => aliases[k].some(a => norm(a) === norm(h)));
const num = (v:any) => v === '' || v === null || v === undefined || String(v).trim() === '-' ? 0 : Number(String(v).replace(/[,৳\\s]/g,''));
const dateValue = (v:any) => {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0,10);
  const s=String(v??'').trim();
  if (!s) return '';
  if (/^\\d{4}-\\d{2}-\\d{2}$/.test(s)) return s;
  const d=new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0,10);
};
const fieldList: Record<Tab,string[]> = {
  member:['member_code','father_name','mother_name','spouse_name','admission_date','date_of_birth','marital_status','education_level','phone','nationality','smart_id','national_id','birth_registration_no','tin_no','profession','religion','member_type','present_union','present_house_street','family_contact_no','permanent_house_street','permanent_contact_no','family_member_count','yearly_income','land_area','land_area_unit','remarks'],
  savings:['member_code','opening_date','gs_balance','lts_new_balance','optional_balance','optional_opening_date','optional_monthly_installment_amount','optional_installments_paid'],
  loan:['member_code','loan_no','disbursement_date','project_name','loan_cycle','principal_amount','service_charge_amount','amount_repaid_to_date','overdue_balance','last_installment_no','last_installment_date','current_status']
};
const labels: Record<string,string> = {member_code:'সদস্য কোড',gs_balance:'GS স্থিতি',lts_new_balance:'LTS-New স্থিতি',optional_balance:'Optional স্থিতি',opening_date:'ওপেনিং তারিখ',loan_no:'ঋণ নম্বর',disbursement_date:'ঋণ বিতরণের তারিখ',project_name:'প্রকল্প',principal_amount:'আসল ঋণ',service_charge_amount:'সেবামূল্য',amount_repaid_to_date:'এ পর্যন্ত আদায়'};
export default function OpeningDataImport({tab,members,samities,canDo,userId,onDone}:Props){
  const [rows,setRows]=useState<ImportRow[]>([]);
  const [fileName,setFileName]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [fileKind,setFileKind]=useState('');
  const [validated,setValidated]=useState(false);
  const [savedRows,setSavedRows]=useState<ImportRow[]>([]);
  const [savedCount,setSavedCount]=useState(0);
  const ready=rows.length>0 && rows.every(r=>!r.error);
  const title=tab==='member'?'সদস্যের সার্বিক তথ্য':tab==='savings'?'সঞ্চয় ওপেনিং':'ঋণ ওপেনিং';
  const validCount=useMemo(()=>rows.filter(r=>!r.error).length,[rows]);
  async function readFile(file:File){
    setNotice('');setRows([]);setSavedRows([]);setSavedCount(0);setValidated(false);setFileName(file.name);
    try{
      let matrix:any[]=[];
      if(/\\.pdf$/i.test(file.name)){
        setFileKind('PDF');
        const bytes=await file.arrayBuffer();
        const pdf=await pdfjsLib.getDocument({data:bytes}).promise;
        const lines:string[]=[];
        for(let p=1;p<=pdf.numPages;p++){
          const page=await pdf.getPage(p);
          const content=await page.getTextContent();
          const groups=new Map<number,{x:number,t:string}[]>();
          for(const item of content.items as any[]){
            if(!('str' in item)||!item.str.trim())continue;
            const y=Math.round(item.transform?.[5]||0);
            const arr=groups.get(y)||[];arr.push({x:item.transform?.[4]||0,t:item.str});groups.set(y,arr);
          }
          for(const [,items] of [...groups.entries()].sort((a,b)=>b[0]-a[0])){
            items.sort((a,b)=>a.x-b.x);
            lines.push(items.map(x=>x.t).join(' | '));
          }
        }
        const nonempty=lines.map(x=>x.trim()).filter(Boolean);
        if(nonempty.length<2)throw new Error('PDF থেকে পড়ার মতো লেখা পাওয়া যায়নি। এটি স্ক্যান করা PDF হলে আগে OCR করে searchable PDF তৈরি করুন।');
        matrix=nonempty.map(line=>line.split(/\\s*\\|\\s*|\\t/).map(x=>x.trim()));
      }else{
        setFileKind(file.name.toLowerCase().endsWith('.csv')?'CSV':'Excel');
        const buf=await file.arrayBuffer();
        const wb=XLSX.read(buf,{type:'array',cellDates:true});
        const ws=wb.Sheets[wb.SheetNames[0]];
        matrix=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''}) as any[][];
      }
      // Support the approved two-row Member migration balance sheet.
      // Row 3 is the product label; totals and footer rows are excluded.
      if(tab==='savings' && matrix.length>=4){
        const top=(matrix[0]||[]).map((v:any)=>String(v??'').trim());
        const sub=(matrix[1]||[]).map((v:any)=>String(v??'').trim());
        const combined=top.map((v:string,j:number)=>sub[j]||v);
        const migrationHeaders=combined.some((v:string)=>norm(v)==='member code')
          && combined.some((v:string)=>norm(v)==='general savings')
          && combined.some((v:string)=>norm(v)==='optional savings opening date');
        if(migrationHeaders){
          const codeIndex=combined.findIndex((v:string)=>norm(v)==='member code');
          const slIndex=top.findIndex((v:string)=>norm(v)==='sl');
          const addDateIndex=top.findIndex((v:string)=>norm(v)==='add. date'||norm(v)==='add date');
          const normalizedHeaders=combined.map((v:string,j:number)=>j===addDateIndex?'opening date':v);
          const dataRows=matrix.slice(3).map((r:any[],j:number)=>({r,sourceLine:j+4}))
            .filter(({r}:any)=>String(r?.[codeIndex]??'').trim()!=='' && (slIndex<0 || /^\\d+$/.test(String(r?.[slIndex]??'').trim())));
          if(!dataRows.length)throw new Error('এই Migration Sheet-এ কোনো সদস্যের ডেটা সারি পাওয়া যায়নি।');
          matrix=[normalizedHeaders.concat('__source_line'),...dataRows.map(({r,sourceLine}:any)=>r.concat(sourceLine))];
        }
      }
      if(matrix.length<2)throw new Error('ফাইলে শিরোনামসহ অন্তত একটি ডেটা সারি থাকতে হবে।');
      const headers=matrix[0].map(keyFor);
      if(!headers.includes('member_code'))throw new Error('সদস্য কোড (Member Code) কলাম পাওয়া যায়নি।');
      const missing=fieldList[tab].filter(k=>!headers.includes(k) && (tab==='savings'?['opening_date','gs_balance','lts_new_balance','optional_balance'].includes(k):tab==='loan'?['loan_no','disbursement_date','project_name','principal_amount'].includes(k):false));
      if(missing.length)throw new Error('প্রয়োজনীয় কলাম পাওয়া যায়নি: '+missing.map(k=>labels[k]||k).join(', '));
      const existing=new Map(members.map(m=>[String(m.member_code).trim().toLowerCase(),m]));
      const seen=new Set<string>();
      const parsed:ImportRow[]=matrix.slice(1).map((cells:any[],i)=>{
        const data:Record<string,any>={};
        headers.forEach((k: string | undefined,j: number)=>{if(k)data[k]=cells[j]??'';});
        const code=String(data.member_code??'').trim();
        const member=existing.get(code.toLowerCase());
        let error='';
        if(!code)error='সদস্য কোড নেই';
        else if(tab!=='loan'&&seen.has(code.toLowerCase()))error='ফাইলে একই সদস্য কোড একাধিকবার আছে';
        else if(!member)error='এই সদস্য কোডের কোনো নিবন্ধিত সদস্য নেই';
        const duplicateKey=tab==='loan'?code.toLowerCase()+'|'+String(data.loan_no||'').trim().toLowerCase():code.toLowerCase();
        if(tab==='loan'&&seen.has(duplicateKey))error='একই সদস্যের একই ঋণ নম্বর একাধিকবার আছে';
        seen.add(duplicateKey);
        if(tab==='member'){
          if(member && data.phone && !/^01[3-9]\\d{8}$/.test(String(data.phone).trim()))error='মোবাইল নম্বর ১১ ডিজিট হতে হবে';
          if(member && data.smart_id && !/^\\d{10}$/.test(String(data.smart_id).trim()))error='Smart ID ১০ ডিজিট হতে হবে';
          if(member && data.national_id && !/^\\d{17}$/.test(String(data.national_id).trim()))error='National ID ১৭ ডিজিট হতে হবে';
        }else if(tab==='savings'){
          const total=num(data.gs_balance)+num(data.lts_new_balance)+num(data.optional_balance);
          if(!dateValue(data.opening_date))error='ওপেনিং তারিখ নেই বা ভুল';
          else if(![data.gs_balance,data.lts_new_balance,data.optional_balance].every(v=>Number.isFinite(num(v))&&num(v)>=0)||total<=0)error='সঞ্চয় স্থিতি শূন্যের বেশি এবং ঋণাত্মক নয় হতে হবে';
          else if(num(data.optional_balance)>0&&(!dateValue(data.optional_opening_date)||num(data.optional_monthly_installment_amount)<=0||num(data.optional_installments_paid)<0||!Number.isInteger(num(data.optional_installments_paid))))error='Optional Savings-এর তারিখ, মাসিক জমা ও কিস্তি সংখ্যা যাচাই করুন';
        }else{
          const principal=num(data.principal_amount),charge=num(data.service_charge_amount),repaid=num(data.amount_repaid_to_date),arrears=num(data.overdue_balance),cycle=num(data.loan_cycle||1),last=num(data.last_installment_no||0);
          if(!String(data.loan_no||'').trim()||!dateValue(data.disbursement_date)||!String(data.project_name||'').trim())error='ঋণ নম্বর, বিতরণের তারিখ ও প্রকল্প আবশ্যক';
          else if(![principal,charge,repaid,arrears,cycle,last].every(Number.isFinite)||principal<1000||principal>200000||principal%1000!==0||charge<0||repaid<0||repaid>principal+charge||arrears<0||cycle<1||!Number.isInteger(cycle)||last<0||last>46||!Number.isInteger(last))error='ঋণের পরিমাণ/দফা/কিস্তির তথ্য সঠিক নয়';
          else if(last>0&&!dateValue(data.last_installment_date))error='সর্বশেষ কিস্তির তারিখ আবশ্যক';
          else if(data.current_status==='closed'&&principal+charge-repaid>0)error='অবশিষ্ট স্থিতি থাকলে ঋণ বন্ধ করা যাবে না';
        }
        return {line:Number(data.__source_line)||i+2,member_code:code,member_id:member?.id,name:member?.full_name,data,error};
      }).filter(r=>r.member_code||Object.keys(r.data).length);
      if(!parsed.length)throw new Error('ফাইলে কোনো ডেটা সারি পাওয়া যায়নি।');
      if(tab==='savings'||tab==='loan'){
        const ids=[...new Set(parsed.filter(r=>r.member_id).map(r=>r.member_id!))];
        const balanceCheck=await supabase!.from('member_savings_opening_balances').select('member_id,gs_balance,lts_new_balance,optional_balance').in('member_id',ids);
        if(balanceCheck.error)throw balanceCheck.error;
        const hasSavings=new Set((balanceCheck.data||[]).filter((b:any)=>Number(b.gs_balance||0)+Number(b.lts_new_balance||0)+Number(b.optional_balance||0)>0).map((b:any)=>b.member_id));
        if(tab==='loan'){
          parsed.forEach(r=>{if(!r.error&&!hasSavings.has(r.member_id!))r.error='এই সদস্যের সঞ্চয় স্থিতি নেই; আগে সঞ্চয় ওপেনিং দিন';});
        }else{
          const existing=new Set((balanceCheck.data||[]).map((b:any)=>b.member_id));
          parsed.forEach(r=>{if(!r.error&&existing.has(r.member_id!)&&!canDo('opening_data','update'))r.error='এই সদস্যের সঞ্চয় ওপেনিং আগে থেকেই আছে; Update অনুমতি প্রয়োজন';});
        }
      }
      setRows(parsed);
      setValidated(false);
      setNotice('ফাইল পড়া হয়েছে। এখন “ফাইল যাচাই” চাপুন; যাচাই সফল না হলে সংরক্ষণ করা যাবে না।');
    }catch(err){setNotice(err instanceof Error?err.message:'ফাইল পড়া যায়নি।');}
  }
  async function saveImport(){
    if(!supabase||!userId||!ready)return;
    const action=tab==='member'?'update':'create';
    if(!canDo('opening_data',action)){setNotice('এই Import করার অনুমতি নেই।');return;}
    setBusy(true);setNotice('');
    let saved=0;const errors:string[]=[];const savedLines:number[]=[];
    try{
      if(tab==='member'){
        const balanceResult=await supabase.from('member_savings_opening_balances').select('member_id,gs_balance,lts_new_balance,optional_balance').in('member_id',rows.map(r=>r.member_id));
        if(balanceResult.error)throw balanceResult.error;
        const balances=new Map((balanceResult.data||[]).map((b:any)=>[b.member_id,Number(b.gs_balance||0)+Number(b.lts_new_balance||0)+Number(b.optional_balance||0)]));
        for(const r of rows){
          if(!((balances.get(r.member_id!)||0)>0)){errors.push('লাইন '+r.line+': সদস্যের সঞ্চয় স্থিতি নেই');continue;}
          const payload:Record<string,any>={};
          for(const k of fieldList.member){if(k==='member_code'||r.data[k]===undefined||r.data[k]==='')continue;payload[k]=['family_member_count','yearly_income','land_area'].includes(k)?num(r.data[k]):r.data[k];}
          const res=await supabase.from('members').update(payload).eq('id',r.member_id);
          if(res.error)errors.push('লাইন '+r.line+': '+res.error.message);else {saved++;savedLines.push(r.line);}
        }
      }else if(tab==='savings'){
        for(const r of rows){
          const d=r.data;
          const res=await supabase.from('member_savings_opening_balances').upsert({
            member_id:r.member_id,opening_date:dateValue(d.opening_date),gs_balance:num(d.gs_balance),lts_new_balance:num(d.lts_new_balance),optional_balance:num(d.optional_balance),
            optional_opening_date:num(d.optional_balance)>0?dateValue(d.optional_opening_date):null,
            optional_monthly_installment_amount:num(d.optional_balance)>0?num(d.optional_monthly_installment_amount):0,
            optional_installments_paid:num(d.optional_balance)>0?num(d.optional_installments_paid):0,created_by:userId,updated_by:userId
          },{onConflict:'member_id'});
          if(res.error)errors.push('লাইন '+r.line+': '+res.error.message);else saved++;
        }
      }else{
        const closuresResult=await supabase.from('samity_week_closures').select('samity_id,closure_date');
        const holidaysResult=await supabase.from('holiday_calendar').select('scope,branch_id,samity_id,date_from,date_to,is_active').eq('is_active',true);
        const fridayResult=await supabase.from('holiday_calendar_settings').select('friday_holiday_enabled').eq('id',1).maybeSingle();
        const closures=closuresResult.data||[],holidays=holidaysResult.data||[],friday=fridayResult.data?.friday_holiday_enabled!==false;
        for(const r of rows){
          const d=r.data,m=members.find(x=>x.id===r.member_id),samity=samities.find(x=>x.id===m?.samity_id);
          if(!samity||!Number.isInteger(Number(samity.meeting_day))){errors.push('লাইন '+r.line+': সমিতির সভার দিন পাওয়া যায়নি');continue;}
          const principal=num(d.principal_amount),charge=num(d.service_charge_amount),repaid=num(d.amount_repaid_to_date),arrears=num(d.overdue_balance),cycle=num(d.loan_cycle||1),last=num(d.last_installment_no||0);
          const remaining=Math.max(0,principal+charge-repaid),collectible=Math.max(0,remaining-arrears);
          const closedDates=closures.filter((x:any)=>x.samity_id===samity.id).map((x:any)=>x.closure_date);
          for(const h of holidays.filter((h:any)=>h.scope==='organization'||(h.scope==='branch'&&h.branch_id===samity.branch_id)||(h.scope==='samity'&&h.samity_id===samity.id))){
            const day=new Date(h.date_from+'T12:00:00'),end=new Date(h.date_to+'T12:00:00');
            while(day<=end){closedDates.push([day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-'));day.setDate(day.getDate()+1);}
          }
          if(friday){const day=new Date(dateValue(d.disbursement_date)+'T12:00:00'),end=new Date(day);end.setDate(end.getDate()+46*7+60);for(;day<=end;day.setDate(day.getDate()+1))if(day.getDay()===5)closedDates.push([day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-'));}
          let nextDate:string|null=null;let schedule:any[]=[];
          const status=(d.current_status||'active') as 'active'|'closed'|'written_off';
          if(status==='active'&&last<46&&collectible>0){
            try{
              const all=calculateLoanSchedule(principal);let first:string;
              if(last===0)first=calculateFirstInstallmentDate(dateValue(d.disbursement_date),Number(samity.meeting_day),closedDates);
              else{const day=new Date(dateValue(d.last_installment_date)+'T12:00:00');if(Number.isNaN(day.getTime())||day.getDay()!==Number(samity.meeting_day))throw new Error('শেষ কিস্তির তারিখ সভার দিনের সঙ্গে মেলে না');day.setDate(day.getDate()+7);while(closedDates.includes([day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-')))day.setDate(day.getDate()+7);first=[day.getFullYear(),String(day.getMonth()+1).padStart(2,'0'),String(day.getDate()).padStart(2,'0')].join('-');}
              const dates=buildInstallmentDates(first,Number(samity.meeting_day),closedDates).slice(0,46-last);
              const rest=all.filter(x=>x.weekNo>last),raw=rest.reduce((s,x)=>s+x.totalDue,0);let allocated=0;
              schedule=rest.map((x,i)=>{const total=i===rest.length-1?Math.max(0,collectible-allocated):collectible*x.totalDue/raw;allocated+=total;const p=x.totalDue?total*x.principalDue/x.totalDue:0;return {installment_no:x.weekNo,due_date:dates[i],principal_due:p,service_charge_due:total-p,total_due:total,status:'due'};});
              nextDate=dates[0]||null;
            }catch(err){errors.push('লাইন '+r.line+': '+(err instanceof Error?err.message:'কিস্তি সিডিউল তৈরি হয়নি'));continue;}
          }
          const duplicate=await supabase.from('member_opening_loans').select('id').eq('member_id',r.member_id).eq('loan_no',String(d.loan_no).trim()).maybeSingle();
          if(duplicate.error){errors.push('লাইন '+r.line+': '+duplicate.error.message);continue;}
          if(duplicate.data){errors.push('লাইন '+r.line+': এই সদস্যের এই ঋণ নম্বর আগে থেকেই আছে; নতুন রেকর্ড যোগ করা হয়নি');continue;}
          const savedLoan=await supabase.rpc('save_opening_loan_with_schedule',{
            p_loan_id:null,
            p_loan:{
              member_id:r.member_id,loan_no:String(d.loan_no).trim(),disbursement_date:dateValue(d.disbursement_date),project_name:String(d.project_name).trim(),loan_cycle:cycle,
              principal_amount:principal,service_charge_amount:charge,amount_repaid_to_date:repaid,current_status:status,overdue_balance:arrears,last_installment_no:last,
              last_installment_date:last?dateValue(d.last_installment_date):null,next_installment_date:nextDate,next_collectible_balance:collectible
            },
            p_schedule:schedule
          });
          if(savedLoan.error){errors.push('লাইন '+r.line+': '+savedLoan.error.message);continue;}
          saved++;
        }
      }
      setSavedCount(saved);setSavedRows(rows.filter(r=>savedLines.includes(r.line)));
      setNotice(saved+'টি রেকর্ড সংরক্ষিত হয়েছে।'+(errors.length?' সমস্যা: '+errors.join(' | '):''));
      if(saved)onDone();
    }catch(err){setNotice('Import বন্ধ হয়েছে: '+(err instanceof Error?err.message:'অজানা সমস্যা'));}
    finally{setBusy(false);}
  }
  return <section className="panel" style={{marginBottom:16}}>
    <h3>{title} — Excel / PDF Import</h3>
    <p className="muted">প্রথম শিটের প্রথম সারিতে কলামের নাম থাকতে হবে। Member Code দিয়ে আগে থেকে নিবন্ধিত সদস্য শনাক্ত হবে; নতুন সদস্য তৈরি হবে না। PDF-এর ক্ষেত্রে selectable text থাকতে হবে—স্ক্যান করা PDF হলে OCR করে নিতে হবে।</p>
    <div className="form-grid"><label>Excel / CSV / PDF ফাইল<input type="file" accept=".xlsx,.xls,.csv,.pdf" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)readFile(f);e.currentTarget.value='';}}/></label></div>
    {fileName&&<p className="muted">{fileName} · {fileKind}</p>}
    {notice&&<div className="notice">{notice}</div>}
    {rows.length>0&&<>
      <div className="form-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>{const ok=rows.length>0&&rows.every(r=>!r.error);setValidated(ok);setNotice(ok?'ফাইল যাচাই সফল। Preview দেখে সংরক্ষণ করুন।':'যাচাই ব্যর্থ: Preview-তে দেখানো ভুলগুলো সংশোধন করে ফাইল আবার দিন।');}}>{validated?'যাচাই সম্পন্ন':'ফাইল যাচাই করুন'}</button><span className="muted">{validated?'যাচাই সম্পন্ন':'যাচাই না হওয়া পর্যন্ত সংরক্ষণ বন্ধ'}</span></div>
      <p className="muted">Preview: মোট {rows.length} সারি · সঠিক {validCount} · সমস্যা {rows.length-validCount}</p>
      <div className="table-wrap"><table><thead><tr><th>লাইন</th><th>Member Code</th><th>সদস্য</th><th>Import তথ্য</th><th>যাচাই</th></tr></thead><tbody>
        {rows.slice(0,100).map(r=><tr key={r.line}><td>{r.line}</td><td>{r.member_code||'—'}</td><td>{r.name||'—'}</td><td>{fieldList[tab].filter(k=>k!=='member_code'&&r.data[k]!==undefined&&r.data[k]!=='').map(k=>(labels[k]||k)+': '+String(r.data[k])).join(' · ')||'—'}</td><td>{r.error||'সঠিক'}</td></tr>)}
      </tbody></table></div>
      {rows.length>100&&<p className="muted">প্রথম ১০০টি সারি দেখানো হচ্ছে; বাকি সারিও যাচাইয়ের পর সংরক্ষণ হবে।</p>}
      <div className="form-actions"><button type="button" disabled={!ready||!validated||busy||!canDo('opening_data',tab==='member'?'update':'create')} onClick={saveImport}>{busy?'সংরক্ষণ হচ্ছে...':rows.length+'টি রেকর্ড সংরক্ষণ'}</button><button type="button" className="secondary" disabled={busy} onClick={()=>{setRows([]);setFileName('');setNotice('');setValidated(false);setSavedRows([]);setSavedCount(0);}}>Preview বাতিল</button></div>
    </>}
    {savedCount>0&&<section className="panel" style={{marginTop:16}}><h3>সংরক্ষিত Opening Data — পর্যালোচনা</h3><p className="muted">সফলভাবে সংরক্ষিত {savedCount}টি রেকর্ডের তালিকা</p><div className="table-wrap"><table><thead><tr><th>লাইন</th><th>সদস্য কোড</th><th>সদস্য</th><th>সংরক্ষিত তথ্য</th><th>অবস্থা</th></tr></thead><tbody>{savedRows.map(r=><tr key={r.line}><td>{r.line}</td><td>{r.member_code}</td><td>{r.name||'—'}</td><td>{fieldList[tab].filter(k=>k!=='member_code'&&r.data[k]!==undefined&&r.data[k]!=='').map(k=>(labels[k]||k)+': '+String(r.data[k])).join(' · ')||'—'}</td><td>সংরক্ষিত</td></tr>)}</tbody></table></div></section>}
  </section>;
}
