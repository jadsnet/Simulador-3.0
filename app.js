import {put,get,getAll,del} from "./db.js";
const $=id=>document.getElementById(id);const LETTERS=["a","b","c","d","e"];
let banks=[],selectedBank=null,questions=[],answers={},currentIndex=0,timerSeconds=0,timerHandle=null,settings={},favorites=new Set(),marked=new Set(),reviewData=[];
document.addEventListener("DOMContentLoaded",init);

async function init(){
  bind();
  await refreshHome();
  if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
}


function enterQuizMode(){
  document.body.classList.add("quiz-mode");
}

function exitQuizMode(){
  document.body.classList.remove("quiz-mode");
}

function bind(){
  $("refreshBanksBtn").onclick=refreshHome;
  $("importBankBtn").onclick=importBank;
  $("exportBackupBtn").onclick=exportBackup;
  $("importBackupBtn").onclick=importBackup;
  $("backHomeBtn").onclick=showHome;
  $("startQuizBtn").onclick=startNew;
  $("resumeBtn").onclick=resume;
  $("deleteProgressBtn").onclick=deleteProgress;
  $("prevBtn").onclick=()=>goTo(currentIndex-1);
  $("nextBtn").onclick=next;
  $("saveExitBtn").onclick=saveExit;
  $("newQuizBtn").onclick=()=>showSetup(selectedBank.id);
  $("goHomeBtn").onclick=showHome;
  $("closeImageModal").onclick=closeModal;
  $("imageModal").onclick=e=>{if(e.target===$("imageModal"))closeModal()};
  document.querySelectorAll(".review-filter").forEach(b=>b.onclick=()=>filterReview(b.dataset.filter));
}

async function refreshHome(){
  showLoading(true,"Carregando biblioteca...");
  banks=await getAll("banks");
  renderBanks();
  const history = await getAll("history");
  renderHistory(history);
  await renderDashboard(history);
  showLoading(false);
}


async function renderDashboard(history){
  const total = history.reduce((sum,h)=>sum+(h.total||0),0);
  const correct = history.reduce((sum,h)=>sum+(h.correct||0),0);
  const seconds = history.reduce((sum,h)=>sum+(h.time||0),0);
  const sim = document.getElementById("dashSimulations");
  if(sim) sim.textContent = history.length;
  const ans = document.getElementById("dashAnswered");
  if(ans) ans.textContent = total.toLocaleString("pt-BR");
  const acc = document.getElementById("dashAccuracy");
  if(acc) acc.textContent = total ? Math.round(correct/total*100)+"%" : "0%";
  const time = document.getElementById("dashTime");
  if(time){ const h=Math.floor(seconds/3600), m=Math.floor(seconds%3600/60); time.textContent=String(h).padStart(2,"0")+"h "+String(m).padStart(2,"0")+"m"; }
  const progress = await getAll("progress");
  const area = document.getElementById("continueStudy");
  if(!area) return;
  if(!progress.length){ area.innerHTML='<div class="empty-state">Nenhum simulado em andamento.</div>'; return; }
  const pr=progress.sort((a,b)=>(b.savedAt||"").localeCompare(a.savedAt||""))[0];
  const bank=await get("banks",pr.bankId);
  if(!bank) return;
  const answered=Object.values(pr.answers||{}).filter(v=>Array.isArray(v)&&v.length).length;
  const pct=Math.round(answered/pr.order.length*100);
  area.innerHTML=`<div class="resume-box" style="margin:0"><div><span>Em andamento</span><strong>${esc(bank.name)}</strong><p>${answered}/${pr.order.length} respondidas · ${pct}%</p></div><button class="btn primary" id="dashResume">Continuar</button></div>`;
  document.getElementById("dashResume").onclick=async()=>{await showSetup(bank.id);await resume();};
}
function renderBanks(){
  const list=$("bankList");
  list.innerHTML="";
  $("emptyBanks").classList.toggle("hidden",banks.length>0);

  for(const bank of banks){
    const el=document.createElement("div");
    el.className="bank-card";
    el.innerHTML=`<div><h3>${esc(bank.name)}</h3><p>${bank.questions.length} questões · importado em ${new Date(bank.createdAt).toLocaleDateString("pt-BR")}</p></div><div class="bank-actions"><button class="btn primary" data-open>Abrir</button><button class="btn danger" data-delete>Excluir</button></div>`;
    el.querySelector("[data-open]").onclick=()=>showSetup(bank.id);
    el.querySelector("[data-delete]").onclick=async()=>{
      if(confirm("Excluir este banco e seu progresso?")){
        await del("banks",bank.id);
        await del("progress",bank.id);
        await refreshHome();
      }
    };
    list.appendChild(el);
  }
}

function renderHistory(items){
  const list=$("historyList");
  list.innerHTML=items.length?"":"<div class='empty-state'>Nenhum resultado salvo.</div>";

  items.sort((a,b)=>b.finishedAt.localeCompare(a.finishedAt)).slice(0,20).forEach(h=>{
    const el=document.createElement("div");
    el.className="history-item history-item-with-actions";

    const summary=document.createElement("div");
    summary.className="history-summary";
    summary.innerHTML=`<strong>${esc(h.bankName)}</strong><p>${h.score}% · ${h.correct}/${h.total} · ${new Date(h.finishedAt).toLocaleString("pt-BR")}</p>`;

    const actions=document.createElement("div");
    actions.className="history-actions";

    const details=document.createElement("button");
    details.className="btn secondary history-details-btn";
    details.textContent="Ver detalhes";
    details.disabled=!Array.isArray(h.reviewData)||!h.reviewData.length;
    details.title=details.disabled
      ? "Este resultado foi criado por uma versão antiga e não contém os detalhes das questões."
      : "Abrir erros, acertos, respostas, feedbacks e imagens";
    details.onclick=()=>openHistoryDetails(h.id);

    actions.appendChild(details);
    el.append(summary,actions);
    list.appendChild(el);
  });
}

async function openHistoryDetails(historyId){
  const history=await get("history",historyId);

  if(!history||!Array.isArray(history.reviewData)||!history.reviewData.length){
    alert("Este resultado foi salvo por uma versão anterior e possui apenas o resumo. Os próximos simulados terão revisão completa no histórico.");
    return;
  }

  const bank=history.bankId?await get("banks",history.bankId):null;

  if(bank){
    selectedBank=bank;
  }else{
    selectedBank={
      id:history.bankId||"historico",
      name:history.bankName||"Resultado anterior",
      images:history.images||{},
      questions:history.reviewData.map(item=>item.q).filter(Boolean)
    };
  }

  reviewData=history.reviewData;
  questions=reviewData.map(item=>item.q).filter(Boolean);
  timerSeconds=Number(history.time)||0;

  $("resultTime").textContent="Tempo: "+formatTime(timerSeconds);
  $("correctCount").textContent=history.correct||0;
  $("wrongCount").textContent=Math.max(0,(history.total||reviewData.length)-(history.correct||0));
  $("scorePercent").textContent=(history.score||0)+"%";

  renderCategoryStats(reviewData);
  renderReview(reviewData);
  filterReview("wrong");

  $("homeScreen").classList.add("hidden");
  $("setupScreen").classList.add("hidden");
  $("quizScreen").classList.add("hidden");
  $("resultScreen").classList.remove("hidden");
  exitQuizMode();
  window.scrollTo({top:0,behavior:"smooth"});
}

async function importBank(){
  try{
    showLoading(true,"Importando banco...");
    let bank;
    if($("zipFile").files[0])bank=await importZip($("zipFile").files[0]);
    else bank=await importCsvAndImages();

    await put("banks",bank);
    toast("Banco importado com sucesso.");
    $("csvFile").value="";
    $("imageFolder").value="";
    $("zipFile").value="";
    await refreshHome();
  }catch(e){
    alert(e.message||"Erro na importação");
  }finally{
    showLoading(false);
  }
}

async function importCsvAndImages(){
  const csv=$("csvFile").files[0];
  if(!csv)throw new Error("Selecione um CSV ou ZIP.");

  const qs=await parseCsv(csv);
  const images={};

  for(const f of $("imageFolder").files){
    images[normPath(f.webkitRelativePath||f.name)]=await fileToDataURL(f);
    images[normPath(f.name)]=images[normPath(f.webkitRelativePath||f.name)];
  }

  return makeBank($("bankName").value||csv.name.replace(/\.csv$/i,""),qs,images);
}

async function importZip(file){
  if(!window.JSZip)throw new Error("JSZip não carregado.");

  const zip=await JSZip.loadAsync(file);
  const entries=Object.values(zip.files);
  const csvEntry=entries.find(e=>!e.dir&&e.name.toLowerCase().endsWith(".csv"));

  if(!csvEntry)throw new Error("O ZIP não contém CSV.");

  const csvText=await csvEntry.async("string");
  const qs=await parseCsvText(csvText);
  const images={};

  for(const e of entries){
    if(e.dir||e===csvEntry)continue;
    if(/\.(png|jpe?g|gif|webp|svg)$/i.test(e.name)){
      const blob=await e.async("blob");
      const data=await blobToDataURL(blob);
      images[normPath(e.name)]=data;
      images[normPath(e.name.split("/").pop())]=data;
    }
  }

  return makeBank($("bankName").value||file.name.replace(/\.zip$/i,""),qs,images);
}

function makeBank(name,qs,images){
  return{id:crypto.randomUUID(),name,createdAt:new Date().toISOString(),questions:qs,images};
}

function parseCsv(file){
  return new Promise((res,rej)=>Papa.parse(file,{
    header:true,
    skipEmptyLines:"greedy",
    transformHeader:h=>h.replace(/^\uFEFF/,"").trim().toLowerCase(),
    complete:r=>res(normalizeQuestions(r.data)),
    error:()=>rej(new Error("Erro no CSV"))
  }));
}

function parseCsvText(text){
  return new Promise(res=>Papa.parse(text,{
    header:true,
    skipEmptyLines:"greedy",
    transformHeader:h=>h.replace(/^\uFEFF/,"").trim().toLowerCase(),
    complete:r=>res(normalizeQuestions(r.data))
  }));
}

function normalizeQuestions(rows){
  return rows.map((q,i)=>{
    const x={};
    for(const[k,v]of Object.entries(q))x[k.trim().toLowerCase()]=typeof v==="string"?v.trim():v;
    x.id=String(x.id||i+1);
    x.tipo=/multiple|multipla|múltipla|multi/i.test(x.tipo||"")?"multiple":"single";
    x.correta=normAnswers(x.correta);
    return x;
  }).filter(q=>q.pergunta);
}

async function showSetup(id){
  exitQuizMode();
  selectedBank=await get("banks",id);
  if(!selectedBank)return;

  $("homeScreen").classList.add("hidden");
  $("resultScreen").classList.add("hidden");
  $("setupScreen").classList.remove("hidden");
  $("selectedBankName").textContent=selectedBank.name;
  $("questionLimit").max=selectedBank.questions.length;
  $("questionLimit").value=Math.min(50,selectedBank.questions.length);

  const p=await get("progress",id);
  $("resumeBox").classList.toggle("hidden",!p);
  $("deleteProgressBtn").classList.toggle("hidden",!p);

  if(p)$("resumeText").textContent=`Questão ${p.currentIndex+1} de ${p.order.length} · ${Object.keys(p.answers).length} respondidas`;
}

async function startNew(){
  settings={
    limit:Math.min(parseInt($("questionLimit").value)||selectedBank.questions.length,selectedBank.questions.length),
    timeLimit:Math.max(0,parseInt($("timeLimit").value)||0),
    shuffle:$("shuffleQuestions").checked,
    warn:$("warnUnanswered").checked
  };

  questions=[...selectedBank.questions];
  if(settings.shuffle)shuffle(questions);
  questions=questions.slice(0,settings.limit);

  answers={};
  favorites=new Set();
  marked=new Set();
  currentIndex=0;
  timerSeconds=0;

  await saveProgress();
  openQuiz();
}

async function resume(){
  const p=await get("progress",selectedBank.id);
  if(!p)return;

  const byId=new Map(selectedBank.questions.map(q=>[q.id,q]));
  questions=p.order.map(id=>byId.get(id)).filter(Boolean);
  answers=p.answers||{};
  favorites=new Set(p.favorites||[]);
  marked=new Set(p.marked||[]);
  currentIndex=p.currentIndex||0;
  timerSeconds=p.timerSeconds||0;
  settings=p.settings||{};

  openQuiz();
}

function openQuiz(){
  enterQuizMode();
  $("setupScreen").classList.add("hidden");
  $("homeScreen").classList.add("hidden");
  $("resultScreen").classList.add("hidden");
  $("quizScreen").classList.remove("hidden");
  const examTitle=document.getElementById("examBankTitle");
  if(examTitle)examTitle.textContent=selectedBank?.name||"Simulado";
  renderQuestion();
  startTimer();
  window.scrollTo(0,0);
}

function renderQuestion(){
  const q=questions[currentIndex];

  $("currentQuestion").textContent=currentIndex+1;
  $("totalQuestions").textContent=questions.length;
  $("answeredCount").textContent=Object.keys(answers).filter(k=>(answers[k]||[]).length).length;
  $("progressBar").style.width=`${(currentIndex+1)/questions.length*100}%`;
  $("questionText").textContent=q.pergunta||"";
  $("categoryBadge").textContent=q.categoria||"";
  $("categoryBadge").classList.toggle("hidden",!q.categoria);
  $("typeBadge").textContent=q.tipo==="multiple"?"Múltiplas respostas":"Resposta única";
  $("multipleNotice").classList.toggle("hidden",q.tipo!=="multiple");

  renderImage("questionImageWrap","questionImage",q.imagem_pergunta);
  renderOptions(q);

  $("prevBtn").disabled=currentIndex===0;
  $("nextBtn").textContent=currentIndex===questions.length-1?"Finalizar":"Próxima →";

  saveProgress();
}

function renderOptions(q){
  const c=$("optionsContainer");
  c.innerHTML="";

  for(const l of LETTERS){
    const t=q[`alt_${l}`],img=q[`img_${l}`];
    if(!t&&!img)continue;

    const U=l.toUpperCase();
    const label=document.createElement("label");
    label.className="option";
    label.classList.toggle("selected",(answers[q.id]||[]).includes(U));

    const input=document.createElement("input");
    input.type=q.tipo==="multiple"?"checkbox":"radio";
    input.name="answer";
    input.checked=(answers[q.id]||[]).includes(U);
    input.onchange=()=>selectAnswer(q,U);

    const content=document.createElement("div");
    content.className="option-content";
    content.innerHTML=`<div><span class="option-letter">${U})</span>${esc(t||"")}</div>`;

    const url=resolveImage(img);
    if(url)content.appendChild(makeImageBlock(url,`Imagem da alternativa ${U}`));

    label.append(input,content);
    c.appendChild(label);
  }
}

function selectAnswer(q,a){
  let arr=[...(answers[q.id]||[])];

  if(q.tipo==="multiple")arr=arr.includes(a)?arr.filter(x=>x!==a):[...arr,a];
  else arr=[a];

  answers[q.id]=arr.sort();
  renderQuestion();
}

function renderImage(wrapId,imgId,name){
  const url=resolveImage(name),w=$(wrapId),im=$(imgId);
  if(!url){w.classList.add("hidden");return}
  im.src=url;
  im.onclick=()=>openModal(url);
  w.classList.remove("hidden");
}

function resolveImage(name){
  if(!name)return"";
  const n=normPath(name);
  return selectedBank.images[n]||selectedBank.images[n.split("/").pop()]||"";
}

function renderNavigator(){
  const g=$("navigatorGrid");
  g.innerHTML="";

  questions.forEach((q,i)=>{
    const b=document.createElement("button");
    b.className="nav-number";
    if((answers[q.id]||[]).length)b.classList.add("answered");
    if(marked.has(q.id))b.classList.add("marked");
    if(i===currentIndex)b.classList.add("current");
    b.textContent=i+1;
    b.onclick=()=>goTo(i);
    g.appendChild(b);
  });
}

function goTo(i){
  if(i<0||i>=questions.length)return;
  currentIndex=i;
  renderQuestion();
  window.scrollTo(0,0);
}

function next(){
  if(currentIndex<questions.length-1)goTo(currentIndex+1);
  else finish();
}

function toggleFavorite(){
  const id=questions[currentIndex].id;
  favorites.has(id)?favorites.delete(id):favorites.add(id);
  renderQuestion();
}

function toggleMarked(){
  const id=questions[currentIndex].id;
  marked.has(id)?marked.delete(id):marked.add(id);
  renderQuestion();
}

function startTimer(){
  stopTimer();
  timerHandle=setInterval(()=>{
    timerSeconds++;
    $("timer").textContent=formatTime(timerSeconds);

    if(settings.timeLimit&&timerSeconds>=settings.timeLimit*60){
      stopTimer();
      alert("Tempo encerrado.");
      finish();
    }

    if(timerSeconds%5===0)saveProgress();
  },1000);

  $("timer").textContent=formatTime(timerSeconds);
}

function stopTimer(){
  if(timerHandle){
    clearInterval(timerHandle);
    timerHandle=null;
  }
}

async function saveProgress(){
  if(!selectedBank||!questions.length)return;

  await put("progress",{
    bankId:selectedBank.id,
    currentIndex,
    order:questions.map(q=>q.id),
    answers,
    timerSeconds,
    settings,
    favorites:[...favorites],
    marked:[...marked],
    savedAt:new Date().toISOString()
  });
}

async function saveExit(){
  exitQuizMode();
  await saveProgress();
  stopTimer();
  $("quizScreen").classList.add("hidden");
  await showSetup(selectedBank.id);
  toast("Progresso salvo.");
}

async function deleteProgress(){
  await del("progress",selectedBank.id);
  await showSetup(selectedBank.id);
}

async function finish(){
  const unanswered=questions.filter(q=>!(answers[q.id]||[]).length).length;
  if(settings.warn&&unanswered&&!confirm(`Há ${unanswered} não respondidas. Finalizar?`))return;

  stopTimer();
  exitQuizMode();
  let correct=0;
  reviewData=[];

  for(const q of questions){
    const u=normAnswers(answers[q.id]||[]);
    const r=normAnswers(q.correta);
    const ok=eq(u,r);

    if(ok)correct++;

    reviewData.push({
      q,u,r,ok,
      unanswered:!u.length,
      favorite:favorites.has(q.id),
      marked:marked.has(q.id)
    });
  }

  const score=Math.round(correct/questions.length*100);

  const historyRecord={
    id:crypto.randomUUID(),
    bankId:selectedBank.id,
    bankName:selectedBank.name,
    finishedAt:new Date().toISOString(),
    score,
    correct,
    total:questions.length,
    unanswered,
    time:timerSeconds,
    reviewData
  };

  await put("history",historyRecord);

  await del("progress",selectedBank.id);

  $("quizScreen").classList.add("hidden");
  $("resultScreen").classList.remove("hidden");
  $("resultTime").textContent="Tempo: "+formatTime(timerSeconds);

  animateNumber("correctCount",correct,"");
  animateNumber("wrongCount",questions.length-correct,"");
  animateNumber("scorePercent",score,"%");

  renderCategoryStats(reviewData);
  renderReview(reviewData);
  filterReview("wrong");
}

function animateNumber(id,target,suffix){
  const el=$(id);
  const duration=550;
  const start=performance.now();

  function frame(now){
    const progress=Math.min((now-start)/duration,1);
    const eased=1-Math.pow(1-progress,3);
    el.textContent=Math.round(target*eased)+suffix;
    if(progress<1)requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

function renderCategoryStats(items){
  const map={};

  for(const x of items){
    const c=x.q.categoria||"Sem categoria";
    map[c]??={ok:0,total:0};
    map[c].total++;
    if(x.ok)map[c].ok++;
  }

  const box=$("categoryStats");
  box.innerHTML="";

  Object.entries(map).forEach(([c,v])=>{
    const e=document.createElement("div");
    e.className="category-card";
    e.innerHTML=`<strong>${esc(c)}</strong><p>${Math.round(v.ok/v.total*100)}% · ${v.ok}/${v.total}</p>`;
    box.appendChild(e);
  });
}

function renderReview(items){
  const box=$("reviewList");
  box.innerHTML="";

  items.forEach((x,i)=>{
    const e=document.createElement("article");
    e.className=`review-item ${x.ok?"correct":"wrong"}`;
    e.dataset.correct=x.ok;
    e.dataset.unanswered=x.unanswered;
    e.dataset.favorite=x.favorite;
    e.dataset.marked=x.marked;

    const cat=document.createElement("div");
    cat.className="review-category";
    cat.textContent=x.q.categoria||"Sem categoria";

    const h=document.createElement("h3");
    h.textContent=`Questão ${i+1} — ${x.ok?"Correta":"Incorreta"}`;

    const qt=document.createElement("div");
    qt.className="review-question";
    qt.textContent=x.q.pergunta||"";

    const ua=document.createElement("div");
    ua.className="review-answer user";
    ua.textContent=`Sua resposta: ${x.u.join(", ")||"Não respondida"}`;

    const ca=document.createElement("div");
    ca.className="review-answer correct";
    ca.textContent=`Resposta correta: ${x.r.join(", ")||"Não informada"}`;

    e.append(cat,h,qt,ua,ca);

    const qImg=resolveImage(x.q.imagem_pergunta);
    if(qImg)e.appendChild(makeLabeledImage("Imagem do enunciado",qImg));

    const relevant=[...new Set([...x.u,...x.r])];
    for(const letter of relevant){
      const img=resolveImage(x.q[`img_${letter.toLowerCase()}`]);
      if(img)e.appendChild(makeLabeledImage(`Imagem da alternativa ${letter}`,img));
    }

    if(x.q.feedback){
      const f=document.createElement("div");
      f.className="feedback";
      f.textContent=x.q.feedback;
      e.appendChild(f);
    }

    box.appendChild(e);
  });
}

function makeLabeledImage(title,url){
  const wrap=document.createElement("div");
  const t=document.createElement("div");
  t.className="review-image-title";
  t.textContent=title;
  wrap.appendChild(t);
  wrap.appendChild(makeImageBlock(url,title));
  return wrap;
}

function makeImageBlock(url,alt){
  const w=document.createElement("div");
  w.className="image-scroll";

  const im=document.createElement("img");
  im.className="source-image";
  im.src=url;
  im.alt=alt;
  im.onclick=e=>{
    e.preventDefault();
    openModal(url);
  };

  w.appendChild(im);
  return w;
}

function filterReview(f){
  document.querySelectorAll(".review-item").forEach(e=>{
    const show=
      f==="all"||
      f==="wrong"&&e.dataset.correct==="false"||
      f==="correct"&&e.dataset.correct==="true"||
      f==="unanswered"&&e.dataset.unanswered==="true"||
      f==="favorite"&&e.dataset.favorite==="true"||
      f==="marked"&&e.dataset.marked==="true";

    e.classList.toggle("hidden",!show);
  });
}

async function exportBackup(){
  const data={
    version:"5.0",
    exportedAt:new Date().toISOString(),
    banks:await getAll("banks"),
    progress:await getAll("progress"),
    history:await getAll("history")
  };

  download("simulador-backup.json",JSON.stringify(data,null,2),"application/json");
}

async function importBackup(){
  const f=$("backupFile").files[0];
  if(!f)return alert("Selecione um backup.");

  const data=JSON.parse(await f.text());

  for(const x of data.banks||[])await put("banks",x);
  for(const x of data.progress||[])await put("progress",x);
  for(const x of data.history||[])await put("history",x);

  await refreshHome();
  toast("Backup restaurado.");
}

function showHome(){
  exitQuizMode();
  stopTimer();
  document.querySelectorAll(".screen").forEach(s=>s.classList.add("hidden"));
  $("homeScreen").classList.remove("hidden");
  refreshHome();
}

function openModal(url){
  $("modalImage").src=url;
  $("imageModal").classList.remove("hidden");
  document.body.style.overflow="hidden";
}

function closeModal(){
  $("imageModal").classList.add("hidden");
  $("modalImage").src="";
  document.body.style.overflow="";
}

function showLoading(s,t="Carregando..."){
  $("loadingText").textContent=t;
  $("loading").classList.toggle("hidden",!s);
}

function toast(t){
  $("toast").textContent=t;
  $("toast").classList.remove("hidden");
  setTimeout(()=>$("toast").classList.add("hidden"),2500);
}

function normAnswers(v){
  if(Array.isArray(v))return v.map(String).map(x=>x.trim().toUpperCase()).filter(Boolean).sort();
  return String(v||"").replace(/["']/g,"").toUpperCase().split(/[,\s;|/]+/).filter(x=>/^[A-E]$/.test(x)).sort();
}

function eq(a,b){return a.length===b.length&&a.every((v,i)=>v===b[i])}

function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
}

function normPath(s){
  return String(s||"").trim().replace(/\\/g,"/").replace(/^\.?\//,"").toLowerCase();
}

function esc(s){
  return String(s??"").replace(/[&<>"']/g,m=>({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

function fileToDataURL(f){return blobToDataURL(f)}

function blobToDataURL(b){
  return new Promise((r,j)=>{
    const x=new FileReader();
    x.onload=()=>r(x.result);
    x.onerror=j;
    x.readAsDataURL(b);
  });
}

function formatTime(s){
  const h=Math.floor(s/3600),m=Math.floor(s%3600/60),sec=s%60;
  return(h?[h,m,sec]:[m,sec]).map(x=>String(x).padStart(2,"0")).join(":");
}

function download(n,c,t){
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([c],{type:t}));
  a.download=n;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
