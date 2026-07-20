
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qktvxmihtraxdoekobsg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_T9CUAKZCQPQlw33c0dPC_A_jzBmtW9p";
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null;
const IMAGE_BUCKET="question-images";
const imageManifestCache=new Map();
let storageDisabledForSession=false;
let storageReport={found:0,uploaded:0,downloaded:0,error:""};
export function getCloudUser(){ return currentUser; }

export async function initializeAuth(onChange){
  const { data:{ session } } = await supabase.auth.getSession();
  currentUser = session?.user || null;
  onChange(currentUser);
  supabase.auth.onAuthStateChange((_event, nextSession)=>{
    currentUser = nextSession?.user || null;
    onChange(currentUser);
  });
}

export async function signIn(email,password){
  const {error}=await supabase.auth.signInWithPassword({email,password});
  if(error) throw error;
}
export async function signUp(email,password){
  const {error}=await supabase.auth.signUp({
    email,password,
    options:{emailRedirectTo:"https://jadsnet.github.io/Simulador-3.0/"}
  });
  if(error) throw error;
}
export async function signOut(){ await supabase.auth.signOut(); }

async function requireUser(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) throw new Error("Usuário não autenticado.");
  currentUser=user; return user;
}

// O ID gerado pelo navegador muda entre computadores. Esta assinatura usa o
// conteúdo do banco e, portanto, permanece igual ao importar o mesmo CSV/ZIP.
function stableBankId(bank){
  const questions=Array.isArray(bank?.questions)?bank.questions:[];
  const source=questions.map(q=>[
    q.id,q.pergunta,q.alt_a,q.alt_b,q.alt_c,q.alt_d,q.alt_e,
    Array.isArray(q.correta)?q.correta.join(","):q.correta
  ].map(v=>String(v??"").trim()).join("\u001f")).join("\u001e");
  let h1=0x811c9dc5,h2=0x9e3779b9;
  for(let i=0;i<source.length;i++){
    const c=source.charCodeAt(i);
    h1=Math.imul(h1^c,0x01000193);
    h2=Math.imul(h2^c,0x85ebca6b);
  }
  return `bank-${questions.length}-${(h1>>>0).toString(16).padStart(8,"0")}${(h2>>>0).toString(16).padStart(8,"0")}`;
}

function hashString(value){
  let hash=0x811c9dc5;
  for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),0x01000193);
  return (hash>>>0).toString(16).padStart(8,"0");
}

function dataUrlToBlob(dataUrl){
  const [header,body]=String(dataUrl).split(",",2);
  const mime=(header.match(/^data:([^;]+)/)||[])[1]||"application/octet-stream";
  const bytes=header.includes(";base64")?atob(body):decodeURIComponent(body);
  const array=new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++)array[i]=bytes.charCodeAt(i);
  return new Blob([array],{type:mime});
}

function blobToDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(reader.result); reader.onerror=()=>reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function imageExtension(blob){
  return ({"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/webp":"webp","image/svg+xml":"svg"})[blob.type]||"bin";
}

async function uploadBankImages(bank){
  const stableId=stableBankId(bank);
  const images=bank.images&&typeof bank.images==="object"?bank.images:{};
  const localImageCount=Object.values(images).filter(value=>String(value||"").startsWith("data:")).length;
  const cached=imageManifestCache.get(stableId);
  if(cached&&Object.keys(cached).length>=localImageCount)return cached;
  if(storageDisabledForSession)return {};
  const user=await requireUser();
  const manifest={};
  const uploadedByContent=new Map();

  try{
    for(const [logicalName,value] of Object.entries(images)){
      if(!String(value||"").startsWith("data:"))continue;
      const contentKey=hashString(String(value));
      let objectPath=uploadedByContent.get(contentKey);
      if(!objectPath){
        const blob=dataUrlToBlob(value);
        objectPath=`${user.id}/${stableId}/${contentKey}.${imageExtension(blob)}`;
        const {error}=await supabase.storage.from(IMAGE_BUCKET).upload(objectPath,blob,{upsert:true,contentType:blob.type,cacheControl:"31536000"});
        if(error)throw error;
        uploadedByContent.set(contentKey,objectPath);
        storageReport.uploaded++;
      }
      manifest[logicalName]=objectPath;
    }
    storageReport.found=Math.max(storageReport.found,Object.keys(manifest).length);
    imageManifestCache.set(stableId,manifest);
    return manifest;
  }catch(error){
    storageDisabledForSession=true;
    storageReport.error=error.message||"Storage indisponível";
    console.warn("Imagens não foram enviadas ao Storage",error);
    return {};
  }
}

async function downloadBankImages(manifest){
  if(!manifest||typeof manifest!=="object"||storageDisabledForSession)return {};
  const images={};
  const downloadedByPath=new Map();
  try{
    for(const [logicalName,objectPath] of Object.entries(manifest)){
      let dataUrl=downloadedByPath.get(objectPath);
      if(!dataUrl){
        const {data,error}=await supabase.storage.from(IMAGE_BUCKET).download(objectPath);
        if(error)throw error;
        dataUrl=await blobToDataUrl(data);
        downloadedByPath.set(objectPath,dataUrl);
        storageReport.downloaded++;
      }
      images[logicalName]=dataUrl;
    }
    return images;
  }catch(error){
    storageReport.error=error.message||"Não foi possível baixar as imagens";
    console.warn("Imagens não foram baixadas do Storage",error);
    return {};
  }
}

async function cloudBankSnapshot(bank){
  const cloudImages=await uploadBankImages(bank);
  return {
    id:stableBankId(bank),name:bank.name||"Banco de questões",
    fileName:bank.fileName||null,createdAt:bank.createdAt||new Date().toISOString(),
    questions:Array.isArray(bank.questions)?bank.questions:[],images:{},cloudImages
  };
}

async function resolveCloudBank(bank,{create=true}={}){
  const user=await requireUser();
  const stableId=stableBankId(bank);
  const columns="id,local_bank_id,name,file_name,question_count,updated_at";

  // Reúne tanto o registro estável quanto os registros legados/duplicados.
  let {data:stableRow,error}=await supabase.from("question_banks").select(columns)
    .eq("user_id",user.id).eq("local_bank_id",stableId).maybeSingle();
  if(error)throw error;

  const directResult=await supabase.from("question_banks").select(columns)
    .eq("user_id",user.id).eq("local_bank_id",String(bank.id)).maybeSingle();
  if(directResult.error)throw directResult.error;

  const count=Array.isArray(bank.questions)?bank.questions.length:0;
  const legacy=await supabase.from("question_banks").select(columns)
    .eq("user_id",user.id).eq("question_count",count)
    .order("updated_at",{ascending:false}).limit(50);
  if(legacy.error)throw legacy.error;

  const fileName=String(bank.fileName||"").trim().toLowerCase();
  const name=String(bank.name||"").trim().toLowerCase();
  const rows=[stableRow,directResult.data,...(legacy.data||[])].filter(Boolean);
  const unique=[...new Map(rows.map(r=>[r.id,r])).values()];
  const compatible=unique.filter(r=>r.local_bank_id===stableId
    ||r.local_bank_id===String(bank.id)
    ||(fileName&&String(r.file_name||"").trim().toLowerCase()===fileName)
    ||(name&&String(r.name||"").trim().toLowerCase()===name));
  const candidates=compatible.length?compatible:(unique.length===1?unique:[]);

  let data=null;
  if(candidates.length){
    const ids=candidates.map(r=>r.id);
    const progressRows=await supabase.from("quiz_progress")
      .select("bank_id,answers,current_index,client_updated_at,updated_at")
      .eq("user_id",user.id).in("bank_id",ids);
    if(progressRows.error)throw progressRows.error;
    const progressByBank=new Map((progressRows.data||[]).map(p=>[p.bank_id,p]));
    const score=row=>{
      const p=progressByBank.get(row.id);
      return {answered:p&&p.answers&&typeof p.answers==="object"?Object.keys(p.answers).length:0,
        index:Number(p?.current_index)||0,date:String(p?.client_updated_at||p?.updated_at||"")};
    };
    data=[...candidates].sort((a,b)=>{
      const sa=score(a),sb=score(b);
      return sb.answered-sa.answered||sb.index-sa.index||sb.date.localeCompare(sa.date)
        ||Number(b.local_bank_id===stableId)-Number(a.local_bank_id===stableId);
    })[0];
  }

  if(data){
    // Só migra o ID legado quando ainda não existe outro registro estável.
    // Se houver duplicidade, mantém o vínculo do registro que contém respostas.
    if(stableRow&&data.id!==stableRow.id)return data;
    if(data.local_bank_id===stableId)return data;
    const migrated=await supabase.from("question_banks")
      .update({local_bank_id:stableId,name:bank.name||data.name,updated_at:new Date().toISOString()})
      .eq("id",data.id).eq("user_id",user.id).select(columns).single();
    if(migrated.error)throw migrated.error;
    return migrated.data;
  }

  if(!create)return null;
  const payload={
    user_id:user.id,local_bank_id:stableId,
    name:bank.name||"Banco de questões",file_name:bank.fileName||null,
    question_count:Array.isArray(bank.questions)?bank.questions.length:0,
    updated_at:new Date().toISOString()
  };
  const inserted=await supabase.from("question_banks")
    .upsert(payload,{onConflict:"user_id,local_bank_id"}).select(columns).single();
  if(inserted.error)throw inserted.error;
  return inserted.data;
}

export async function ensureCloudBank(bank){
  const data=await resolveCloudBank(bank);
  return data.id;
}

export async function pushProgress(bank,progress){
  const user=await requireUser();
  const cloudBankId=await ensureCloudBank(bank);
  const payload={
    user_id:user.id, bank_id:cloudBankId,
    current_index:Number(progress.currentIndex)||0,
    question_order:progress.order||[],
    answers:progress.answers||{},
    timer_seconds:Number(progress.timerSeconds)||0,
    settings:{...(progress.settings||{}),__cloudBank:await cloudBankSnapshot(bank)},
    favorites:progress.favorites||[],
    marked:progress.marked||[],
    notes:progress.notes||{},
    status:"in_progress",
    client_updated_at:progress.savedAt||new Date().toISOString()
  };
  const {error}=await supabase.from("quiz_progress")
    .upsert(payload,{onConflict:"user_id,bank_id"});
  if(error) throw error;
}

export async function pullProgress(bank){
  const user=await requireUser();
  const bankRow=await resolveCloudBank(bank,{create:false});
  if(!bankRow) return null;
  // Não baixa aqui o snapshot completo do banco guardado em settings. Isso
  // mantém a abertura de um simulado rápida mesmo após versões antigas terem
  // gravado imagens Base64 muito grandes nesse campo.
  const progressColumns="current_index,question_order,answers,timer_seconds,favorites,marked,notes,client_updated_at,updated_at";
  const {data,error}=await supabase.from("quiz_progress").select(progressColumns)
    .eq("user_id",user.id).eq("bank_id",bankRow.id).maybeSingle();
  if(error) throw error;
  if(!data) return null;
  return {
    bankId:bank.id, currentIndex:data.current_index,
    order:data.question_order||[], answers:data.answers||{},
    timerSeconds:data.timer_seconds||0,
    settings:{limit:(data.question_order||[]).length,timeLimit:0,shuffle:false,warn:true},
    favorites:data.favorites||[], marked:data.marked||[],
    notes:data.notes||{}, savedAt:data.client_updated_at||data.updated_at
  };
}

export async function deleteCloudProgress(bank){
  const user=await requireUser();
  const data=await resolveCloudBank(bank,{create:false});
  if(data?.id) await supabase.from("quiz_progress").delete().eq("user_id",user.id).eq("bank_id",data.id);
}

export async function pushHistory(bank,h){
  const user=await requireUser();
  const cloudBankId=await ensureCloudBank(bank);
  const payload={
    id:h.id, user_id:user.id, bank_id:cloudBankId, bank_name:h.bankName,
    total_questions:h.total||0,
    answered_questions:(h.total||0)-(h.unanswered||0),
    correct_answers:h.correct||0,
    wrong_answers:Math.max(0,(h.total||0)-(h.correct||0)),
    score:h.score||0, elapsed_seconds:h.time||0,
    answers:{reviewData:h.reviewData||[]}, settings:{__cloudBank:await cloudBankSnapshot(bank)},
    finished_at:h.finishedAt||new Date().toISOString()
  };
  const {error}=await supabase.from("quiz_history").upsert(payload);
  if(error) throw error;
}

export async function pullCloudState(){
  const user=await requireUser();
  storageReport={found:storageReport.found,uploaded:storageReport.uploaded,downloaded:0,error:storageReport.error};
  const [progressResult,historyResult]=await Promise.all([
    supabase.from("quiz_progress").select("*").eq("user_id",user.id).limit(200),
    supabase.from("quiz_history").select("*").eq("user_id",user.id)
      .order("finished_at",{ascending:false}).limit(1000)
  ]);
  if(progressResult.error)throw progressResult.error;
  if(historyResult.error)throw historyResult.error;

  const banks=new Map();
  const cloudBankIds=new Map();
  const addSnapshot=async(snapshot,cloudBankId)=>{
    if(!snapshot||!Array.isArray(snapshot.questions)||!snapshot.questions.length)return null;
    const downloadedImages=await downloadBankImages(snapshot.cloudImages||{});
    const bank={...snapshot,id:stableBankId(snapshot),images:{...(snapshot.images||{}),...downloadedImages}};
    delete bank.cloudImages;
    banks.set(bank.id,bank);
    if(cloudBankId)cloudBankIds.set(cloudBankId,bank.id);
    return bank.id;
  };

  for(const row of progressResult.data||[])await addSnapshot(row.settings?.__cloudBank,row.bank_id);
  for(const row of historyResult.data||[]){
    let localId=await addSnapshot(row.settings?.__cloudBank,row.bank_id);
    if(!localId){
      const reviewData=Array.isArray(row.answers?.reviewData)?row.answers.reviewData:[];
      const questions=reviewData.map(item=>item?.q).filter(Boolean);
      if(questions.length)localId=await addSnapshot({name:row.bank_name||"Banco recuperado",questions,images:{}},row.bank_id);
    }
  }

  const progress=(progressResult.data||[]).map(row=>{
    const bankId=cloudBankIds.get(row.bank_id);
    if(!bankId)return null;
    const cleanSettings={...(row.settings||{})}; delete cleanSettings.__cloudBank;
    return {bankId,currentIndex:Number(row.current_index)||0,order:row.question_order||[],
      answers:row.answers||{},timerSeconds:Number(row.timer_seconds)||0,settings:cleanSettings,
      favorites:row.favorites||[],marked:row.marked||[],notes:row.notes||{},
      savedAt:row.client_updated_at||row.updated_at||new Date().toISOString()};
  }).filter(Boolean);

  const history=(historyResult.data||[]).map(row=>{
    const reviewData=Array.isArray(row.answers?.reviewData)?row.answers.reviewData:[];
    const total=Number(row.total_questions)||reviewData.length;
    const answered=Number(row.answered_questions)||0;
    return {id:row.id,bankId:cloudBankIds.get(row.bank_id)||null,
      bankName:row.bank_name||"Banco de questões",finishedAt:row.finished_at||new Date().toISOString(),
      score:Number(row.score)||0,correct:Number(row.correct_answers)||0,total,
      unanswered:Math.max(0,total-answered),time:Number(row.elapsed_seconds)||0,reviewData};
  });

  return {banks:[...banks.values()],progress,history,diagnostics:{
    cloudBanks:banks.size,cloudProgress:progress.length,cloudHistory:history.length,
    imagesFound:storageReport.found,imagesUploaded:storageReport.uploaded,imagesDownloaded:storageReport.downloaded,
    storageError:storageReport.error
  }};
}
