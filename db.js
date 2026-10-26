const DB_BASE_NAME="simulador-v43";const DB_VERSION=3;let DB_NAME=`${DB_BASE_NAME}-anonymous`;let dbPromise;let trainingDbPromise;
export function setDBUserScope(userId){
  const scope=String(userId||"anonymous").replace(/[^a-zA-Z0-9_-]/g,"_");
  const nextName=`${DB_BASE_NAME}-${scope}`;
  if(nextName===DB_NAME)return false;
  if(dbPromise)dbPromise.then(db=>db.close()).catch(()=>{});
  dbPromise=undefined; if(trainingDbPromise)trainingDbPromise.then(db=>db.close()).catch(()=>{});trainingDbPromise=undefined;DB_NAME=nextName;
  return true;
}
export function openDB(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains("banks"))d.createObjectStore("banks",{keyPath:"id"});if(!d.objectStoreNames.contains("progress"))d.createObjectStore("progress",{keyPath:"bankId"});if(!d.objectStoreNames.contains("trainingProgress"))d.createObjectStore("trainingProgress",{keyPath:"bankId"});if(!d.objectStoreNames.contains("history"))d.createObjectStore("history",{keyPath:"id"});if(!d.objectStoreNames.contains("questionData"))d.createObjectStore("questionData",{keyPath:"key"})};req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result)};req.onerror=()=>reject(req.error);req.onblocked=()=>reject(new Error("Banco local bloqueado. Feche outras abas do simulador e recarregue a página."))});return dbPromise}
function openTrainingDB(){
  if(trainingDbPromise)return trainingDbPromise;
  const name=`${DB_NAME}-training`;
  trainingDbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(name,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("trainingProgress"))db.createObjectStore("trainingProgress",{keyPath:"bankId"})};
    req.onsuccess=()=>{req.result.onversionchange=()=>req.result.close();resolve(req.result)};
    req.onerror=()=>reject(req.error);
    req.onblocked=()=>reject(new Error("Armazenamento de treinamento bloqueado. Feche outras abas."));
  }).catch(error=>{trainingDbPromise=undefined;throw error});
  return trainingDbPromise;
}
async function store(name,mode="readonly"){const d=name==="trainingProgress"?await openTrainingDB():await openDB();return d.transaction(name,mode).objectStore(name)}
export async function put(name,value){const s=await store(name,"readwrite");return new Promise((r,j)=>{const q=s.put(value);q.onsuccess=()=>r(value);q.onerror=()=>j(q.error)})}
export async function get(name,key){const s=await store(name);return new Promise((r,j)=>{const q=s.get(key);q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error)})}
export async function getAll(name){const s=await store(name);return new Promise((r,j)=>{const q=s.getAll();q.onsuccess=()=>r(q.result||[]);q.onerror=()=>j(q.error)})}
export async function del(name,key){const s=await store(name,"readwrite");return new Promise((r,j)=>{const q=s.delete(key);q.onsuccess=()=>r();q.onerror=()=>j(q.error)})}
