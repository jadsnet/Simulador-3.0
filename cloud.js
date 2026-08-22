
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qktvxmihtraxdoekobsg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_T9CUAKZCQPQlw33c0dPC_A_jzBmtW9p";
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null;
const IMAGE_BUCKET="question-images";
const imageManifestCache=new Map();
const storageManifestCache=new Map();
const storageUploadPromises=new Map();
const STORAGE_DISABLED_KEY="simulador-storage-disabled-v7106";
let storageUploadQueue=Promise.resolve();
let storageDisabledForSession=false;
try{storageDisabledForSession=sessionStorage.getItem(STORAGE_DISABLED_KEY)==="1"}catch{}
let storageReport={found:0,catalog:0,uploaded:0,downloaded:0,skipped:0,error:""};
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

export async function ensurePublicProfile(){
  const user=await requireUser();
  const email=user.email||"usuario@sem-email.local";
  const displayName=user.user_metadata?.display_name||email.split("@")[0]||"Usuário";
  const {data,error}=await supabase.from("user_profiles").upsert({
    user_id:user.id,email,display_name:displayName,updated_at:new Date().toISOString()
  },{onConflict:"user_id"}).select("daily_goal,display_name,email,avatar_url").single();
  if(error)throw error;
  return data;
}

export async function listFriendProfiles(){
  await requireUser();
  const {data,error}=await supabase.from("user_profiles")
    .select("user_id,email,display_name,avatar_url,created_at")
    .eq("is_discoverable",true)
    .order("display_name",{ascending:true})
    .limit(500);
  if(error)throw error;
  return data||[];
}

export async function updatePublicProfile({displayName,avatarFile}={}){
  const user=await requireUser();
  const name=String(displayName||"").trim().slice(0,80)||String(user.email||"Usuário").split("@")[0];
  let avatarUrl;
  if(avatarFile){
    if(!/^image\/(png|jpeg|webp|gif)$/i.test(avatarFile.type))throw new Error("Escolha uma imagem PNG, JPG, WEBP ou GIF.");
    if(avatarFile.size>5*1024*1024)throw new Error("A foto deve ter no máximo 5 MB.");
    const extension=(avatarFile.name.split(".").pop()||"png").replace(/[^a-z0-9]/gi,"").toLowerCase();
    const path=`${user.id}/avatar.${extension}`;
    const uploaded=await supabase.storage.from("profile-avatars").upload(path,avatarFile,{upsert:true,contentType:avatarFile.type,cacheControl:"3600"});
    if(uploaded.error)throw uploaded.error;
    const publicResult=supabase.storage.from("profile-avatars").getPublicUrl(path);
    avatarUrl=`${publicResult.data.publicUrl}?v=${Date.now()}`;
  }
  const payload={display_name:name,updated_at:new Date().toISOString()};
  if(avatarUrl)payload.avatar_url=avatarUrl;
  const result=await supabase.from("user_profiles").update(payload).eq("user_id",user.id)
    .select("daily_goal,display_name,email,avatar_url").single();
  if(result.error)throw result.error;
  await supabase.auth.updateUser({data:{display_name:name,avatar_url:result.data.avatar_url||null}});
  return result.data;
}

export async function getFriendProgressSummary(userId){
  await requireUser();
  const {data,error}=await supabase.rpc("get_friend_progress_summary",{target_user_id:userId});
  if(error)throw error;
  return data;
}

export async function updatePublicGoal(dailyGoal){
  const user=await requireUser();
  const goal=Math.max(1,Math.min(500,Number(dailyGoal)||20));
  const {error}=await supabase.from("user_profiles").update({daily_goal:goal,updated_at:new Date().toISOString()}).eq("user_id",user.id);
  if(error)throw error;
}

export async function getCloudRevision(){
  const user=await requireUser();
  const [banksResult,progressResult,historyResult]=await Promise.all([
    supabase.from("question_banks").select("updated_at",{count:"exact"}).eq("user_id",user.id).order("updated_at",{ascending:false}).limit(1),
    supabase.from("quiz_progress").select("client_updated_at,updated_at",{count:"exact"}).eq("user_id",user.id).order("client_updated_at",{ascending:false}).limit(1),
    supabase.from("quiz_history").select("finished_at",{count:"exact"}).eq("user_id",user.id).order("finished_at",{ascending:false}).limit(1)
  ]);
  for(const result of [banksResult,progressResult,historyResult])if(result.error)throw result.error;
  return JSON.stringify({
    banks:[banksResult.count||0,banksResult.data?.[0]?.updated_at||""],
    progress:[progressResult.count||0,progressResult.data?.[0]?.client_updated_at||progressResult.data?.[0]?.updated_at||""],
    history:[historyResult.count||0,historyResult.data?.[0]?.finished_at||""]
  });
}

async function requireUser(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) throw new Error("Usuário não autenticado.");
  currentUser=user; return user;
}

// A identidade do banco NÃO pode depender do conteúdo. Nas versões anteriores
// o hash incluía todas as questões; ao adicionar uma nova questão o hash mudava
// e o Supabase interpretava a mesma biblioteca como um banco novo inteiro.
// O id local é persistente e também viaja dentro do snapshot para os outros PCs.
function stableBankId(bank){
  const persisted=String(bank?.syncId||bank?.id||"").trim();
  if(persisted)return persisted;
  // Fallback apenas para snapshots legados sem id. Não deve ser usado em bancos
  // criados pelas versões atuais.
  const questions=Array.isArray(bank?.questions)?bank.questions:[];
  const source=questions.map(q=>[q.id,q.pergunta].map(v=>String(v??"").trim()).join("\u001f")).join("\u001e");
  let h=0x811c9dc5;for(let i=0;i<source.length;i++)h=Math.imul(h^source.charCodeAt(i),0x01000193);
  return `legacy-${questions.length}-${(h>>>0).toString(16).padStart(8,"0")}`;
}

function questionFingerprint(q){
  return [q?.id,q?.pergunta,q?.alt_a,q?.alt_b,q?.alt_c,q?.alt_d,q?.alt_e]
    .map(v=>String(v??"").trim().toLowerCase()).join("\u001f");
}

function bankOverlapScore(bank,snapshot){
  const a=Array.isArray(bank?.questions)?bank.questions:[];
  const b=Array.isArray(snapshot?.questions)?snapshot.questions:[];
  if(!a.length||!b.length)return 0;
  const setB=new Set(b.map(questionFingerprint));
  let common=0;for(const q of a)if(setB.has(questionFingerprint(q)))common++;
  return common/Math.max(1,Math.min(a.length,b.length));
}

function hashString(value){
  let hash=0x811c9dc5;
  for(let i=0;i<value.length;i++)hash=Math.imul(hash^value.charCodeAt(i),0x01000193);
  return (hash>>>0).toString(16).padStart(8,"0");
}

// Usa um hash criptográfico para identificar o conteúdo das imagens. O hash
// FNV de 32 bits anterior podia, embora raramente, produzir colisões e fazer
// dois arquivos diferentes compartilharem o mesmo caminho no Storage.
async function imageContentKey(value){
  if(globalThis.crypto?.subtle){
    const bytes=new TextEncoder().encode(String(value));
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  }
  return hashString(String(value));
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

async function runPool(items,limit,task){
  let next=0;
  let stopped=false,firstError=null;
  async function worker(){
    while(!stopped&&next<items.length){
      const index=next++;
      try{await task(items[index],index)}catch(error){stopped=true;firstError=firstError||error}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},()=>worker()));
  if(firstError)throw firstError;
}

async function readStorageManifest(userId,stableId){
  const cacheKey=`${userId}/${stableId}`;
  if(storageManifestCache.has(cacheKey))return storageManifestCache.get(cacheKey);
  const objectPath=`${cacheKey}/manifest.json`;

  // Supabase Storage responde HTTP 400 para download de objeto inexistente.
  // Isso poluía o Console com dezenas de "Failed to load resource" mesmo
  // quando a ausência do manifesto era esperada. Primeiro listamos a pasta e
  // só fazemos o GET se manifest.json realmente estiver presente.
  const listed=await supabase.storage.from(IMAGE_BUCKET).list(cacheKey,{limit:1000,sortBy:{column:"name",order:"asc"}});
  if(listed.error)throw listed.error;
  if(!(listed.data||[]).some(item=>item.name==="manifest.json")){
    storageManifestCache.set(cacheKey,{});
    return {};
  }

  const {data,error}=await supabase.storage.from(IMAGE_BUCKET).download(objectPath);
  if(error)throw error;
  try{
    const manifest=JSON.parse(await data.text());
    const clean=manifest&&typeof manifest==="object"?manifest:{};
    storageReport.catalog=Math.max(storageReport.catalog,Object.keys(clean).length);
    storageManifestCache.set(cacheKey,clean); return clean;
  }catch{
    storageManifestCache.set(cacheKey,{});
    return {};
  }
}

async function writeStorageManifest(userId,stableId,manifest){
  const cacheKey=`${userId}/${stableId}`;
  const objectPath=`${cacheKey}/manifest.json`;
  const blob=new Blob([JSON.stringify(manifest)],{type:"application/json"});
  const {error}=await supabase.storage.from(IMAGE_BUCKET).upload(objectPath,blob,{upsert:true,contentType:"application/json",cacheControl:"60"});
  if(error)throw error;
  storageManifestCache.set(cacheKey,manifest);
  storageReport.catalog=Math.max(storageReport.catalog,Object.keys(manifest).length);
}

async function uploadBankImages(bank){
  const stableId=stableBankId(bank);
  if(storageUploadPromises.has(stableId))return storageUploadPromises.get(stableId);
  const uploadPromise=storageUploadQueue.then(()=>uploadBankImagesInternal(bank));
  storageUploadQueue=uploadPromise.catch(()=>({}));
  storageUploadPromises.set(stableId,uploadPromise);
  try{return await uploadPromise}finally{storageUploadPromises.delete(stableId)}
}

async function uploadBankImagesInternal(bank){
  const stableId=stableBankId(bank);
  const images=bank.images&&typeof bank.images==="object"?bank.images:{};
  const localEntries=Object.entries(images)
    .filter(([,value])=>String(value||"").startsWith("data:"));
  const localSignature=localEntries
    .map(([logicalName,value])=>`${logicalName}:${hashString(String(value))}`)
    .sort().join("|");
  const cached=imageManifestCache.get(stableId);
  // Só reutiliza o manifesto quando nomes E conteúdos continuam idênticos.
  // Comparar apenas a quantidade mantinha manifestos antigos após reimportar
  // imagens corrigidas com a mesma contagem de arquivos.
  if(cached?.signature===localSignature)return cached.manifest;
  if(storageDisabledForSession)return {};
  const user=await requireUser();
  let manifest={};
  const uniqueImages=new Map();
  const supportedMimeTypes=new Set(["image/png","image/jpeg","image/gif","image/webp","image/svg+xml"]);

  try{
    manifest={...await readStorageManifest(user.id,stableId)};
    for(const [logicalName,value] of localEntries){
      const blob=dataUrlToBlob(value);
      if(!supportedMimeTypes.has(blob.type)){
        storageReport.skipped++;
        continue;
      }
      const contentKey=await imageContentKey(value);
      const fileName=`${contentKey}.${imageExtension(blob)}`;
      const objectPath=`${user.id}/${stableId}/${fileName}`;
      if(!uniqueImages.has(contentKey))uniqueImages.set(contentKey,{fileName,objectPath,blob});
      manifest[logicalName]=objectPath;
    }

    storageReport.found=Math.max(storageReport.found,uniqueImages.size);
    if(uniqueImages.size){
      const folder=`${user.id}/${stableId}`;
      const listed=await supabase.storage.from(IMAGE_BUCKET).list(folder,{limit:1000,sortBy:{column:"name",order:"asc"}});
      if(listed.error)throw listed.error;
      const existingFiles=new Set((listed.data||[]).map(item=>item.name));
      const missing=[...uniqueImages.values()].filter(item=>!existingFiles.has(item.fileName));
      await runPool(missing,1,async item=>{
        const {error}=await supabase.storage.from(IMAGE_BUCKET).upload(item.objectPath,item.blob,{upsert:false,contentType:item.blob.type,cacheControl:"31536000"});
        const conflict=error&&(String(error.statusCode||error.status||"")==="409"||/already exists|duplicate/i.test(error.message||""));
        if(error&&!conflict)throw error;
        if(!error)storageReport.uploaded++;
      });
    }
    await writeStorageManifest(user.id,stableId,manifest);
    imageManifestCache.set(stableId,{signature:localSignature,manifest});
    return manifest;
  }catch(error){
    storageDisabledForSession=true;
    try{sessionStorage.setItem(STORAGE_DISABLED_KEY,"1")}catch{}
    storageReport.error=`Envio de imagens bloqueado nesta sessão. Execute SUPABASE_STORAGE_REPAIR_V7_10_6.sql no Supabase. ${error.message||"Storage indisponível"}`;
    console.warn("Imagens não foram enviadas ao Storage",error);
    return {};
  }
}

async function downloadBankImages(manifest){
  if(!manifest||typeof manifest!=="object"||storageDisabledForSession)return {};
  const images={};
  const downloadedByPath=new Map();
  const declaredPaths=[...new Set(Object.values(manifest).map(value=>String(value||"").trim()).filter(value=>value&&!/^https?:\/\//i.test(value)))];
  const pathsByFolder=new Map();
  for(const objectPath of declaredPaths){
    const slash=objectPath.lastIndexOf("/");
    if(slash<1){storageReport.skipped++;continue}
    const folder=objectPath.slice(0,slash),fileName=objectPath.slice(slash+1);
    if(!pathsByFolder.has(folder))pathsByFolder.set(folder,[]);
    pathsByFolder.get(folder).push({objectPath,fileName});
  }
  // O manifesto pode conservar referências de imagens removidas. Listar a
  // pasta primeiro evita uma requisição GET 400 para cada arquivo órfão.
  const uniquePaths=[];
  let firstError=null;
  for(const [folder,candidates] of pathsByFolder){
    const listed=await supabase.storage.from(IMAGE_BUCKET).list(folder,{limit:1000,sortBy:{column:"name",order:"asc"}});
    if(listed.error){firstError=firstError||listed.error;storageReport.skipped+=candidates.length;continue}
    const available=new Set((listed.data||[]).filter(item=>!item.id||item.name).map(item=>item.name));
    for(const candidate of candidates){
      if(available.has(candidate.fileName))uniquePaths.push(candidate.objectPath);
      else storageReport.skipped++;
    }
  }
  await runPool(uniquePaths,6,async objectPath=>{
    try{
        const {data,error}=await supabase.storage.from(IMAGE_BUCKET).download(objectPath);
        if(error)throw error;
        const dataUrl=await blobToDataUrl(data);
        downloadedByPath.set(objectPath,dataUrl);
        storageReport.downloaded++;
    }catch(error){
      firstError=firstError||error;
    }
  });
  for(const [logicalName,objectPath] of Object.entries(manifest)){
    if(downloadedByPath.has(objectPath))images[logicalName]=downloadedByPath.get(objectPath);
  }
  if(firstError){
    storageReport.error=`${downloadedByPath.size}/${uniquePaths.length} imagens existentes baixadas. ${firstError.message||"Falha em um arquivo"}`;
    console.warn("Algumas imagens não foram baixadas do Storage",firstError);
  }
  return images;
}

function cleanSnapshotImages(images){
  if(!images||typeof images!=="object")return {};
  return Object.fromEntries(Object.entries(images).filter(([,value])=>{
    const raw=String(value||"").trim();
    if(!raw)return false;
    if(!/^https?:\/\//i.test(raw))return true;
    try{
      const url=new URL(raw);
      return !(/\.supabase\.co$/i.test(url.hostname)
        && /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?question-images\//i.test(url.pathname));
    }catch{return true}
  }));
}

async function cloudBankSnapshot(bank){
  const cloudImages=await uploadBankImages(bank);
  const syncId=stableBankId(bank);
  return {
    id:syncId,syncId,name:bank.name||"Banco de questões",
    fileName:bank.fileName||null,createdAt:bank.createdAt||new Date().toISOString(),
    questions:Array.isArray(bank.questions)?bank.questions:[],images:{},cloudImages
  };
}

async function resolveCloudBank(bank,{create=true}={}){
  const user=await requireUser();
  const stableId=stableBankId(bank);
  const columns="id,local_bank_id,name,file_name,question_count,updated_at,snapshot";

  // Caminho principal: o banco já possui uma identidade persistente.
  let direct=await supabase.from("question_banks").select(columns)
    .eq("user_id",user.id).eq("local_bank_id",stableId).maybeSingle();
  if(direct.error)throw direct.error;
  let data=direct.data||null;

  // Migração das versões 7.10.15 e anteriores: nelas local_bank_id era um hash
  // do CONTEÚDO. Ao adicionar uma questão o hash mudava e um novo registro era
  // criado. Se o id persistente ainda não foi encontrado, procuramos apenas
  // bancos com o mesmo nome/arquivo e escolhemos aquele cujo snapshot mais se
  // sobrepõe ao banco atual. Assim 24 -> 25 questões é tratado como atualização,
  // não como um novo banco.
  if(!data){
    const name=String(bank.name||"").trim();
    const fileName=String(bank.fileName||"").trim();
    let query=supabase.from("question_banks").select(columns).eq("user_id",user.id);
    if(fileName)query=query.eq("file_name",fileName);
    else if(name)query=query.eq("name",name);
    const legacy=await query.order("updated_at",{ascending:false}).limit(100);
    if(legacy.error)throw legacy.error;
    const rows=legacy.data||[];
    const ranked=rows.map(row=>({row,score:bankOverlapScore(bank,row.snapshot)}))
      .filter(item=>item.score>=0.80)
      .sort((a,b)=>b.score-a.score
        ||Number(b.row.question_count||0)-Number(a.row.question_count||0)
        ||String(b.row.updated_at||"").localeCompare(String(a.row.updated_at||"")));
    if(ranked.length)data=ranked[0].row;
  }

  const count=Array.isArray(bank.questions)?bank.questions.length:0;
  if(data){
    const refreshed=await supabase.from("question_banks")
      .update({local_bank_id:stableId,name:bank.name||data.name,file_name:bank.fileName||data.file_name,
        question_count:count,updated_at:new Date().toISOString()})
      .eq("id",data.id).eq("user_id",user.id).select(columns).single();
    if(refreshed.error)throw refreshed.error;
    return refreshed.data;
  }

  if(!create)return null;
  const payload={
    user_id:user.id,local_bank_id:stableId,
    name:bank.name||"Banco de questões",file_name:bank.fileName||null,
    question_count:count,updated_at:new Date().toISOString()
  };
  const inserted=await supabase.from("question_banks")
    .upsert(payload,{onConflict:"user_id,local_bank_id"}).select(columns).single();
  if(inserted.error)throw inserted.error;
  return inserted.data;
}

export async function ensureCloudBank(bank){
  const data=await resolveCloudBank(bank);
  const snapshot=await cloudBankSnapshot(bank);
  const saved=await supabase.from("question_banks")
    .update({snapshot,question_count:Array.isArray(bank.questions)?bank.questions.length:0,updated_at:new Date().toISOString()})
    .eq("id",data.id).eq("user_id",(await requireUser()).id);
  if(saved.error)throw saved.error;
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
  const progressColumns="current_index,question_order,answers,timer_seconds,settings,favorites,marked,notes,client_updated_at,updated_at";
  const {data,error}=await supabase.from("quiz_progress").select(progressColumns)
    .eq("user_id",user.id).eq("bank_id",bankRow.id).maybeSingle();
  if(error) throw error;
  if(!data) return null;
  const cleanSettings={...(data.settings||{})};
  delete cleanSettings.__cloudBank;
  return {
    bankId:bank.id, currentIndex:data.current_index,
    order:data.question_order||[], answers:data.answers||{},
    timerSeconds:data.timer_seconds||0,
    settings:{limit:(data.question_order||[]).length,timeLimit:0,shuffle:false,warn:true,...cleanSettings},
    favorites:data.favorites||[], marked:data.marked||[],
    notes:data.notes||{}, savedAt:data.client_updated_at||data.updated_at
  };
}

export async function deleteCloudProgress(bank){
  const user=await requireUser();
  const data=await resolveCloudBank(bank,{create:false});
  if(data?.id) await supabase.from("quiz_progress").delete().eq("user_id",user.id).eq("bank_id",data.id);
}

export async function deleteCloudBank(bank){
  const user=await requireUser();
  const stableId=stableBankId(bank);
  const name=String(bank?.name||"").trim().toLowerCase();
  const questionCount=Array.isArray(bank?.questions)?bank.questions.length:0;
  const columns="id,local_bank_id,name,question_count";
  const result=await supabase.from("question_banks").select(columns).eq("user_id",user.id).limit(200);
  if(result.error)throw result.error;

  const matches=(result.data||[]).filter(row=>
    row.local_bank_id===stableId||
    row.local_bank_id===String(bank.id)||
    (String(row.name||"").trim().toLowerCase()===name&&Number(row.question_count)===questionCount)
  );
  const bankIds=matches.map(row=>row.id);

  if(bankIds.length){
    const progressDelete=await supabase.from("quiz_progress").delete().eq("user_id",user.id).in("bank_id",bankIds);
    if(progressDelete.error)throw progressDelete.error;
    const historyDelete=await supabase.from("quiz_history").delete().eq("user_id",user.id).in("bank_id",bankIds);
    if(historyDelete.error)throw historyDelete.error;
    const bankDelete=await supabase.from("question_banks").delete().eq("user_id",user.id).in("id",bankIds);
    if(bankDelete.error)throw bankDelete.error;
  }

  const folder=`${user.id}/${stableId}`;
  let paths=[];
  let storageWarning="";
  try{
    const listed=await supabase.storage.from(IMAGE_BUCKET).list(folder,{limit:1000,sortBy:{column:"name",order:"asc"}});
    if(listed.error)throw listed.error;
    paths=(listed.data||[]).map(item=>`${folder}/${item.name}`);
    for(let index=0;index<paths.length;index+=100){
      const removed=await supabase.storage.from(IMAGE_BUCKET).remove(paths.slice(index,index+100));
      if(removed.error)throw removed.error;
    }
  }catch(error){
    // A limpeza do Storage é secundária. O registro do banco/progresso/histórico
    // já foi removido; não deve ser recriado ou impedir a exclusão por causa de
    // um arquivo órfão ou de uma política de Storage temporariamente inválida.
    storageWarning=error.message||String(error);
    console.warn("Banco excluído; limpeza das imagens ficou pendente",error);
  }

  imageManifestCache.delete(stableId);
  storageManifestCache.delete(`${user.id}/${stableId}`);
  return {banks:bankIds.length,files:paths.length,storageWarning};
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
    answers:{reviewData:h.reviewData||[],answerAudit:h.answerAudit||[],bankSignature:h.bankSignature||""}, settings:{__cloudBank:await cloudBankSnapshot(bank)},
    finished_at:h.finishedAt||new Date().toISOString()
  };
  const {error}=await supabase.from("quiz_history").upsert(payload);
  if(error) throw error;
}

export async function pullCloudState(options={}){
  const user=await requireUser();
  storageReport={found:storageReport.found,catalog:storageReport.catalog,uploaded:storageReport.uploaded,downloaded:0,skipped:storageReport.skipped,error:storageReport.error};
  // Não baixa todos os snapshots gigantes em uma única resposta. Depois que as
  // versões antigas começaram a duplicar o banco inteiro, esse SELECT podia
  // ultrapassar o limite/timeout do PostgREST e retornar HTTP 500. Primeiro
  // buscamos somente metadados leves e depois os snapshots em lotes pequenos.
  const [bankMetaResult,progressResult,historyResult]=await Promise.all([
    supabase.from("question_banks").select("id,local_bank_id,name,file_name,question_count,updated_at")
      .eq("user_id",user.id).order("updated_at",{ascending:false}).limit(1000),
    supabase.from("quiz_progress").select("*").eq("user_id",user.id).limit(200),
    supabase.from("quiz_history").select("*").eq("user_id",user.id)
      .order("finished_at",{ascending:false}).limit(1000)
  ]);
  if(bankMetaResult.error)throw bankMetaResult.error;
  if(progressResult.error)throw progressResult.error;
  if(historyResult.error)throw historyResult.error;

  const bankRows=[];
  await runPool(bankMetaResult.data||[],4,async meta=>{
    const rowResult=await supabase.from("question_banks").select("id,snapshot")
      .eq("user_id",user.id).eq("id",meta.id).single();
    if(rowResult.error)throw rowResult.error;
    bankRows.push({...meta,...rowResult.data});
  });

  const banks=new Map();
  const cloudBankIds=new Map();
  const addSnapshot=async(snapshot,cloudBankId)=>{
    if(!snapshot||!Array.isArray(snapshot.questions)||!snapshot.questions.length)return null;
    const snapshotId=stableBankId(snapshot);
    let canonicalManifest={};
    try{canonicalManifest=await readStorageManifest(user.id,snapshotId)}
    catch(error){storageReport.error=error.message||"Não foi possível ler o manifesto de imagens"}
    const effectiveManifest={...(snapshot.cloudImages||{}),...canonicalManifest};
    if(banks.has(snapshotId)){
      const existing=banks.get(snapshotId);
      if(options.downloadImages!==false&&Object.keys(effectiveManifest).length){
        const missing=Object.keys(effectiveManifest).some(key=>!existing.images?.[key]);
        if(missing)existing.images={...(existing.images||{}),...await downloadBankImages(effectiveManifest)};
      }
      if(cloudBankId)cloudBankIds.set(cloudBankId,snapshotId);
      return snapshotId;
    }
    const downloadedImages=options.downloadImages===false?{}:await downloadBankImages(effectiveManifest);
    // URLs diretas de snapshots antigos apontavam para um bucket privado e
    // geravam GET 400. Só preserva dados locais/externos válidos; os objetos do
    // Supabase entram pelo download autenticado acima.
    const bank={...snapshot,id:snapshotId,images:{...cleanSnapshotImages(snapshot.images),...downloadedImages}};
    delete bank.cloudImages;
    banks.set(bank.id,bank);
    if(cloudBankId)cloudBankIds.set(cloudBankId,bank.id);
    return bank.id;
  };

  // Colapsa revisões duplicadas criadas pelo bug antigo. Duas linhas só são
  // consideradas a mesma biblioteca quando têm o mesmo nome/arquivo e forte
  // sobreposição de questões. Mantemos a revisão mais recente e apontamos os
  // ids legados para o mesmo banco local, preservando progresso/histórico.
  const canonicalRows=[];
  const duplicateToCanonical=new Map();
  for(const row of [...bankRows].sort((a,b)=>String(b.updated_at||"").localeCompare(String(a.updated_at||"")))){
    if(!row.snapshot||!Array.isArray(row.snapshot.questions))continue;
    const sameSource=canonicalRows.filter(c=>{
      const sameFile=row.file_name&&c.file_name&&String(row.file_name)===String(c.file_name);
      const sameName=String(row.name||"").trim().toLowerCase()===String(c.name||"").trim().toLowerCase();
      return sameFile||sameName;
    });
    const match=sameSource.find(c=>bankOverlapScore(row.snapshot,c.snapshot)>=0.80);
    if(match)duplicateToCanonical.set(row.id,match.id);
    else canonicalRows.push(row);
  }
  for(const row of canonicalRows)await addSnapshot(row.snapshot,row.id);
  for(const [duplicateId,canonicalId] of duplicateToCanonical){
    const localId=cloudBankIds.get(canonicalId);
    if(localId)cloudBankIds.set(duplicateId,localId);
  }
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
      unanswered:Math.max(0,total-answered),time:Number(row.elapsed_seconds)||0,reviewData,
      answerAudit:Array.isArray(row.answers?.answerAudit)?row.answers.answerAudit:[],
      bankSignature:row.answers?.bankSignature||""};
  });

  return {banks:[...banks.values()],progress,history,diagnostics:{
    cloudBanks:banks.size,cloudProgress:progress.length,cloudHistory:history.length,
    imagesFound:storageReport.found,manifestEntries:storageReport.catalog,
    imagesUploaded:storageReport.uploaded,imagesDownloaded:storageReport.downloaded,
    filesSkipped:storageReport.skipped,
    storageError:storageReport.error
  }};
}
