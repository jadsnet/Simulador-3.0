import {put,get,getAll,del} from "./db.js";
import {initializeAuth,signIn,signUp,signOut,getCloudUser,pushProgress,pullProgress,deleteCloudProgress,pushHistory,ensureCloudBank} from "./cloud.js";
const $=id=>document.getElementById(id);const LETTERS=["a","b","c","d","e"];
const ONBOARDING_KEY="simulador-academy-onboarding-v2";
let onboardingStep=0,onboardingTarget=null;
const onboardingSteps=[
  {selector:"#dashboard",icon:"⌂",title:"Visão geral",text:"Acompanhe simulados, questões respondidas, taxa de acertos e tempo de estudo.",placement:"bottom"},
  {selector:"#banks",icon:"▤",title:"Bancos de questões",text:"Abra um banco já importado para iniciar ou continuar um simulado.",placement:"right"},
  {selector:"#import",icon:"⇩",title:"Importar conteúdo",text:"Importe CSV, pasta de imagens ou um pacote ZIP completo.",placement:"top"},
  {selector:"#continueStudy",icon:"▶",title:"Continuar simulado",text:"Continue exatamente de onde você parou.",placement:"bottom"},
  {selector:"#studyInsights",icon:"☆",title:"Estudo inteligente",text:"Consulte favoritas, marcações, anotações e erros.",placement:"top"},
  {selector:"#history",icon:"◷",title:"Histórico",text:"Abra resultados anteriores e revise suas respostas.",placement:"top"}
];
let banks=[],selectedBank=null,questions=[],answers={},currentIndex=0,timerSeconds=0,timerHandle=null,settings={},favorites=new Set(),marked=new Set(),notes={},reviewData=[];
let authMode="signin", cloudSaveTimer=null;
document.addEventListener("DOMContentLoaded",init);

async function init(){
  setupApplicationPages();
  bind();
  bindAuth();
  bindSidebarNavigation();
  await initializeAuth(handleAuthChange);
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
}


let activeApplicationPage="home";
let reviewLibraryFilter="all";

function makeApplicationPage(id,title,subtitle){
  const page=document.createElement("section");
  page.id=id;
  page.className="app-page hidden";
  page.innerHTML=`<header class="page-heading"><div><p class="eyebrow">${esc(subtitle)}</p><h2>${esc(title)}</h2></div></header>`;
  return page;
}

function setupApplicationPages(){
  const root=$("homeScreen");
  if(!root||$("pageHome"))return;

  const metrics=$("dashboard");
  const dashboardColumns=document.querySelector(".dashboard-columns");
  const insights=$("studyInsights");
  const homeGrid=document.querySelector(".home-grid");
  const history=$("history");
  const backup=$("backup");

  const home=makeApplicationPage("pageHome","Início","ESTUDO");
  const historyPage=makeApplicationPage("pageHistory","Histórico","RESULTADOS");
  const reviewPage=makeApplicationPage("pageReview","Revisão","BIBLIOTECA DE QUESTÕES");
  const statsPage=makeApplicationPage("pageStats","Estatísticas","DESEMPENHO");
  const settingsPage=makeApplicationPage("pageSettings","Configurações","DADOS E BACKUP");

  if(dashboardColumns){
    const quick=dashboardColumns.querySelector(".home-quick-actions");
    if(quick)quick.remove();
    home.appendChild(dashboardColumns);
  }
  if(homeGrid)home.appendChild(homeGrid);

  if(history)historyPage.appendChild(history);

  if(insights){
    reviewPage.appendChild(insights);
    const cards=[...insights.querySelectorAll(".v7-insight-grid > div")];
    const filters=["favorite","marked","notes","wrong"];
    cards.forEach((card,index)=>{
      card.dataset.reviewLibraryFilter=filters[index];
      card.setAttribute("role","button");
      card.setAttribute("tabindex","0");
      card.setAttribute("aria-label","Abrir questões deste grupo");
      const activate=()=>showReviewLibrary(filters[index]);
      card.onclick=activate;
      card.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();activate()}};
    });
  }

  const library=document.createElement("article");
  library.id="reviewLibraryPanel";
  library.className="panel review-library-panel";
  library.innerHTML=`
    <div class="panel-title review-library-title">
      <div><p>QUESTÕES</p><h2 id="reviewLibraryHeading">Todas as questões revisadas</h2></div>
      <div class="review-library-filters">
        <button class="filter-btn review-library-filter" data-library-filter="all">Todas</button>
        <button class="filter-btn review-library-filter" data-library-filter="wrong">Erros</button>
        <button class="filter-btn review-library-filter" data-library-filter="correct">Acertos</button>
        <button class="filter-btn review-library-filter" data-library-filter="favorite">Favoritas</button>
        <button class="filter-btn review-library-filter" data-library-filter="marked">Marcadas</button>
        <button class="filter-btn review-library-filter" data-library-filter="notes">Anotações</button>
      </div>
    </div>
    <div id="reviewLibraryList" class="review-library-list"></div>`;
  reviewPage.appendChild(library);
  library.querySelectorAll("[data-library-filter]").forEach(btn=>{
    btn.onclick=()=>showReviewLibrary(btn.dataset.libraryFilter);
  });

  if(metrics)statsPage.appendChild(metrics);
  const statsNote=document.createElement("article");
  statsNote.className="panel stats-explanation";
  statsNote.innerHTML='<div class="panel-body"><strong>Resumo do seu desempenho</strong><p>Os indicadores acima são calculados a partir dos simulados finalizados e armazenados no histórico.</p></div>';
  statsPage.appendChild(statsNote);

  if(backup)settingsPage.appendChild(backup);

  root.innerHTML="";
  root.append(home,historyPage,reviewPage,statsPage,settingsPage);
  home.classList.remove("hidden");
}

function bindSidebarNavigation(){
  document.querySelectorAll(".side-link[data-page]").forEach(button=>{
    button.onclick=()=>{
      const page=button.dataset.page;
      if(page==="banks"){showApplicationPage("home","banks");return}
      if(page==="simulations"){showApplicationPage("home","continueStudy");return}
      if(page==="import"){showApplicationPage("home","import");return}
      if(page==="review"){
        showApplicationPage("review");
        showReviewLibrary(button.dataset.reviewFilter||"all");
        return;
      }
      showApplicationPage(page);
    };
  });
}

function updateSidebarActive(page){
  document.querySelectorAll(".side-link[data-page]").forEach(button=>{
    const value=button.dataset.page;
    const active=value===page||(page==="home"&&["banks","simulations","import"].includes(value)===false&&value==="home");
    button.classList.toggle("active",active);
  });
}

function showApplicationPage(page="home",scrollTarget=""){
  exitQuizMode();
  stopTimer();
  document.querySelectorAll(".screen").forEach(screen=>screen.classList.add("hidden"));
  $("homeScreen").classList.remove("hidden");
  document.querySelectorAll(".app-page").forEach(section=>section.classList.add("hidden"));

  const target=$(`page${page.charAt(0).toUpperCase()+page.slice(1)}`)||$("pageHome");
  target.classList.remove("hidden");
  activeApplicationPage=page;
  updateSidebarActive(page);

  if(page==="history")refreshHome();
  if(page==="review")renderReviewLibrary(reviewLibraryFilter);
  if(page==="stats")refreshHome();
  if(page==="settings")scanLegacyProgress();

  window.setTimeout(()=>{
    if(scrollTarget){
      const element=$(scrollTarget);
      if(element)element.scrollIntoView({behavior:"smooth",block:"start"});
    }else{
      window.scrollTo({top:0,behavior:"smooth"});
    }
  },50);
}

async function showReviewLibrary(filter="all"){
  reviewLibraryFilter=filter;
  if(activeApplicationPage!=="review")showApplicationPage("review");
  await renderReviewLibrary(filter);
}

async function renderReviewLibrary(filter="all"){
  const list=$("reviewLibraryList");
  if(!list)return;

  const headings={
    all:"Todas as questões revisadas",
    wrong:"Questões respondidas incorretamente",
    correct:"Questões respondidas corretamente",
    favorite:"Questões favoritas",
    marked:"Questões marcadas para revisão",
    notes:"Questões com anotações"
  };
  $("reviewLibraryHeading").textContent=headings[filter]||headings.all;
  document.querySelectorAll(".review-library-filter").forEach(btn=>{
    btn.classList.toggle("active",btn.dataset.libraryFilter===filter);
  });

  const history=await getAll("history");
  const metadata=await getAll("questionData");
  const metadataMap=new Map(metadata.map(item=>[`${item.bankId}::${item.questionId}`,item]));
  const rows=[];
  const seen=new Set();

  history
    .slice()
    .sort((a,b)=>String(b.finishedAt||"").localeCompare(String(a.finishedAt||"")))
    .forEach(record=>{
      (record.reviewData||[]).forEach((item,index)=>{
        if(!item?.q)return;
        const key=`${record.bankId}::${item.q.id}`;
        if(seen.has(key))return;
        seen.add(key);
        const meta=metadataMap.get(key)||{};
        rows.push({
          ...item,
          favorite:Boolean(meta.favorite||item.favorite),
          note:String(meta.note||item.note||""),
          historyId:record.id,
          finishedAt:record.finishedAt,
          originalIndex:index
        });
      });
    });

  const filtered=rows.filter(item=>{
    if(filter==="wrong")return !item.ok;
    if(filter==="correct")return item.ok;
    if(filter==="favorite")return item.favorite;
    if(filter==="marked")return item.marked;
    if(filter==="notes")return Boolean(item.note.trim());
    return true;
  });

  list.innerHTML="";
  if(!filtered.length){
    list.innerHTML='<div class="empty-state"><strong>Nenhuma questão encontrada.</strong><p>Quando houver itens neste grupo, eles aparecerão aqui.</p></div>';
    return;
  }

  filtered.forEach(item=>{
    const card=document.createElement("article");
    card.className=`review-library-card ${item.ok?"correct":"wrong"}`;
    card.innerHTML=`
      <div class="review-library-card-main">
        <div class="review-library-card-meta">
          <span class="review-category">${esc(item.q.categoria||"Sem categoria")}</span>
          <span class="review-status">${item.ok?"✓ Correta":"✕ Incorreta"}</span>
          ${item.favorite?'<span title="Favorita">★</span>':""}
          ${item.marked?'<span title="Marcada">⚑</span>':""}
          ${item.note?'<span title="Com anotação">📝</span>':""}
        </div>
        <h3>${esc(item.q.pergunta||"Questão sem enunciado")}</h3>
        <p><strong>Sua resposta:</strong> ${esc((item.u||[]).join(", ")||"Não respondida")}</p>
        <p><strong>Resposta correta:</strong> ${esc((item.r||[]).join(", ")||"Não informada")}</p>
        ${item.note?`<div class="library-note"><strong>Minha anotação:</strong> ${esc(item.note)}</div>`:""}
      </div>
      <button class="btn secondary open-reviewed-question" type="button">Abrir questão</button>`;
    card.querySelector(".open-reviewed-question").onclick=async()=>{
      await openHistoryDetails(item.historyId);
      window.setTimeout(()=>{
        const reviewItems=[...document.querySelectorAll("#reviewList .review-item")];
        const target=reviewItems[item.originalIndex];
        if(target){
          target.scrollIntoView({behavior:"smooth",block:"start"});
          target.classList.add("review-highlight");
          window.setTimeout(()=>target.classList.remove("review-highlight"),1800);
        }
      },180);
    };
    list.appendChild(card);
  });
}


function bindAuth(){
  const submitBtn=$("authSubmitBtn");
  const toggleBtn=$("authToggleBtn");
  const logoutBtn=$("logoutBtn");
  const syncBtn=$("syncNowBtn");
  const legacyBtn=$("importLegacyBtn");

  if(submitBtn) submitBtn.onclick=submitAuth;
  if(toggleBtn) toggleBtn.onclick=()=>{
    authMode=authMode==="signin"?"signup":"signin";
    $("authTitle").textContent=authMode==="signin"?"Entrar":"Criar conta";
    $("authSubmitBtn").textContent=authMode==="signin"?"Entrar":"Cadastrar";
    $("authToggleBtn").textContent=authMode==="signin"?"Criar uma conta":"Já tenho uma conta";
    $("authMessage").textContent="";
  };
  if(logoutBtn) logoutBtn.onclick=()=>signOut();
  if(syncBtn) syncBtn.onclick=syncAllNow;
  if(legacyBtn) legacyBtn.onclick=importLegacyProgress;
}

async function submitAuth(){
  const email=$("authEmail").value.trim();
  const password=$("authPassword").value;
  if(!email||password.length<8){$("authMessage").textContent="Informe um e-mail válido e uma senha com pelo menos 8 caracteres.";return;}
  $("authSubmitBtn").disabled=true;
  $("authMessage").textContent="Aguarde...";
  try{
    if(authMode==="signin"){
      await signIn(email,password);
      $("authMessage").textContent="Login confirmado. Carregando...";
    }else{
      await signUp(email,password);
      $("authMessage").textContent="Cadastro criado. Confirme o e-mail e depois entre.";
    }
  }catch(e){$("authMessage").textContent=e.message||"Falha na autenticação."}
  finally{$("authSubmitBtn").disabled=false;}
}

async function handleAuthChange(user){
  $("authScreen").classList.toggle("hidden",!!user);
  document.querySelector(".app-layout").classList.toggle("hidden",!user);
  if(!user)return;
  $("logoutBtn").textContent=(user.email||"U").slice(0,2).toUpperCase();
  setCloudStatus("Sincronizando","syncing");
  await refreshHome();
  populateLegacyBanks();
  setCloudStatus("Nuvem ativa","online");
  window.setTimeout(startOnboardingIfNeeded,500);
}

function setCloudStatus(text,state){
  const el=$("cloudStatus"); if(!el)return;
  el.textContent=text; el.className="cloud-status "+state;
}

async function syncAllNow(){
  if(!getCloudUser())return;
  setCloudStatus("Sincronizando","syncing");
  try{
    banks=await getAll("banks");
    for(const bank of banks){
      await ensureCloudBank(bank);
      const local=await get("progress",bank.id);
      const remote=await pullProgress(bank);
      if(remote && (!local || String(remote.savedAt||"")>String(local.savedAt||""))) await put("progress",remote);
      else if(local) await pushProgress(bank,local);
    }
    await refreshHome();
    setCloudStatus("Sincronizado","online");
    toast("Sincronização concluída.");
  }catch(e){setCloudStatus("Erro de sync","error");console.error(e);toast("Falha ao sincronizar.");}
}

function queueCloudProgress(progress){
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(async()=>{
    try{await pushProgress(selectedBank,progress);setCloudStatus("Salvo","online");}
    catch(e){console.error(e);setCloudStatus("Pendente","offline");}
  },500);
}

function populateLegacyBanks(){
  const sel=$("legacyBankSelect"); if(!sel)return;
  sel.innerHTML=banks.map(b=>`<option value="${esc(b.id)}">${esc(b.name)} (${b.questions?.length||0})</option>`).join("");
}

async function importLegacyProgress(){
  const file=$("legacyBackupFile").files[0];
  const bankId=$("legacyBankSelect").value;
  const bank=await get("banks",bankId);
  if(!file||!bank){alert("Selecione o backup antigo e o banco correspondente.");return;}
  try{
    const root=JSON.parse(await file.text());
    const raw=root["simulador_v2_progresso"];
    if(!raw)throw new Error("A chave simulador_v2_progresso não foi encontrada.");
    const old=typeof raw==="string"?JSON.parse(raw):raw;
    const list=Array.isArray(old.userAnswers)?old.userAnswers:[];
    const restored={};
    bank.questions.forEach((q,i)=>{
      const value=list[i];
      if(Array.isArray(value)&&value.length)restored[q.id]=normAnswers(value);
    });
    const order=bank.questions.map(q=>q.id);
    const progress={
      bankId:bank.id,
      currentIndex:Math.min(Number(old.currentQuestion)||0,Math.max(0,order.length-1)),
      order,answers:restored,timerSeconds:Number(old.timerSeconds)||0,
      settings:{limit:order.length,timeLimit:0,shuffle:false,warn:true},
      favorites:[],marked:[],notes:{},savedAt:new Date().toISOString()
    };
    await put("progress",progress);
    await pushProgress(bank,progress);
    toast(`${Object.keys(restored).length} respostas antigas recuperadas.`);
    await refreshHome();
  }catch(e){alert(e.message||"Não foi possível importar o progresso antigo.");}
}


function enterQuizMode(){
  document.body.classList.add("quiz-mode");
}

function exitQuizMode(){
  document.body.classList.remove("quiz-mode");
}

function bind(){
  $("refreshBanksBtn").onclick=refreshHome;
  window.setTimeout(scanLegacyProgress,300);
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
  $("favoriteQuestionBtn").onclick=toggleFavorite;
  $("markQuestionBtn").onclick=toggleMarked;
  $("noteQuestionBtn").onclick=openNoteModal;
  $("navigatorToggleBtn").onclick=toggleNavigator;
  $("closeNavigatorBtn").onclick=toggleNavigator;
  $("closeNoteBtn").onclick=closeNoteModal;
  $("saveNoteBtn").onclick=saveCurrentNote;
  $("deleteNoteBtn").onclick=deleteCurrentNote;
  $("noteTextarea").oninput=updateNoteCounter;
  $("noteModal").onclick=e=>{if(e.target===$("noteModal"))closeNoteModal()};
  document.addEventListener("keydown",handleExamShortcuts);
  $("newQuizBtn").onclick=()=>showSetup(selectedBank.id);
  $("goHomeBtn").onclick=showHome;
  $("onboardingNextBtn").onclick=nextOnboardingStep;
  $("onboardingPrevBtn").onclick=previousOnboardingStep;
  $("onboardingSkipBtn").onclick=finishOnboarding;
  $("onboardingExitBtn").onclick=finishOnboarding;
  $("openTutorialBtn").onclick=restartOnboarding;
  $("sidebarTutorialBtn").onclick=restartOnboarding;
  window.addEventListener("resize",()=>{if(!$("onboardingOverlay").classList.contains("hidden"))positionOnboarding()});
  $("closeImageModal").onclick=closeModal;
  $("imageModal").onclick=e=>{if(e.target===$("imageModal"))closeModal()};
  document.querySelectorAll(".review-filter").forEach(b=>b.onclick=()=>filterReview(b.dataset.filter));
}


function restartOnboarding(){
  localStorage.removeItem(ONBOARDING_KEY);
  showHome();
  window.setTimeout(()=>{
    onboardingStep=0;
    $("onboardingOverlay").classList.remove("hidden");
    $("onboardingOverlay").setAttribute("aria-hidden","false");
    showOnboardingStep();
  },180);
}

function startOnboardingIfNeeded(){
  if(localStorage.getItem(ONBOARDING_KEY)==="done")return;
  if(!$("homeScreen")||$("homeScreen").classList.contains("hidden"))return;

  onboardingStep=0;
  $("onboardingOverlay").classList.remove("hidden");
  $("onboardingOverlay").setAttribute("aria-hidden","false");
  showOnboardingStep();
}

function showOnboardingStep(){
  clearOnboardingTarget();

  const step=onboardingSteps[onboardingStep];
  const target=document.querySelector(step.selector);

  if(!target){
    if(onboardingStep<onboardingSteps.length-1){
      onboardingStep++;
      showOnboardingStep();
    }else{
      finishOnboarding();
    }
    return;
  }

  onboardingTarget=target;
  onboardingTarget.classList.add("onboarding-target-active");

  $("onboardingStepLabel").textContent=`Passo ${onboardingStep+1} de ${onboardingSteps.length}`;
  $("onboardingIcon").textContent=step.icon;
  $("onboardingTitle").textContent=step.title;
  $("onboardingText").textContent=step.text;
  $("onboardingPrevBtn").disabled=onboardingStep===0;
  $("onboardingNextBtn").textContent=onboardingStep===onboardingSteps.length-1?"Concluir ✓":"Próximo →";

  target.scrollIntoView({behavior:"smooth",block:"center"});
  window.setTimeout(positionOnboarding,260);
}

function positionOnboarding(){
  if(!onboardingTarget)return;

  const step=onboardingSteps[onboardingStep];
  const rect=onboardingTarget.getBoundingClientRect();
  const padding=8;
  const spotlight=$("onboardingSpotlight");
  const card=$("onboardingCard");

  spotlight.style.top=`${Math.max(6,rect.top-padding)}px`;
  spotlight.style.left=`${Math.max(6,rect.left-padding)}px`;
  spotlight.style.width=`${Math.min(window.innerWidth-12,rect.width+padding*2)}px`;
  spotlight.style.height=`${Math.min(window.innerHeight-12,rect.height+padding*2)}px`;

  const cardWidth=card.offsetWidth||410;
  const cardHeight=card.offsetHeight||240;
  const gap=14;

  let top=rect.bottom+gap;
  let left=Math.min(Math.max(14,rect.left),window.innerWidth-cardWidth-14);

  if(step.placement==="top"||top+cardHeight>window.innerHeight-14){
    top=rect.top-cardHeight-gap;
  }

  if(step.placement==="right"&&rect.right+cardWidth+gap<window.innerWidth){
    top=Math.max(14,rect.top);
    left=rect.right+gap;
  }

  if(top<14){
    top=Math.min(window.innerHeight-cardHeight-14,rect.bottom+gap);
  }

  card.style.top=`${Math.max(14,top)}px`;
  card.style.left=`${Math.max(14,left)}px`;
}

function nextOnboardingStep(){
  if(onboardingStep>=onboardingSteps.length-1){
    finishOnboarding();
    return;
  }
  onboardingStep++;
  showOnboardingStep();
}

function previousOnboardingStep(){
  if(onboardingStep<=0)return;
  onboardingStep--;
  showOnboardingStep();
}

function clearOnboardingTarget(){
  if(onboardingTarget){
    onboardingTarget.classList.remove("onboarding-target-active");
    onboardingTarget=null;
  }
}

function finishOnboarding(){
  clearOnboardingTarget();
  $("onboardingOverlay").classList.add("hidden");
  $("onboardingOverlay").setAttribute("aria-hidden","true");
  localStorage.setItem(ONBOARDING_KEY,"done");
}

async function refreshHome(){
  showLoading(true,"Carregando biblioteca...");
  banks=await getAll("banks");
  renderBanks();
  const history = await getAll("history");
  renderHistory(history);
  await renderDashboard(history);
  if(activeApplicationPage==="settings")await scanLegacyProgress();
  if(activeApplicationPage==="review")await renderReviewLibrary(reviewLibraryFilter);
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
  const metadata=await getAll("questionData");
  const latest=history.slice().sort((a,b)=>(b.finishedAt||"").localeCompare(a.finishedAt||""))[0];
  const favCount=metadata.filter(x=>x.favorite).length;
  const noteCount=metadata.filter(x=>String(x.note||"").trim()).length;
  const errorCount=history.reduce((sum,h)=>sum+Math.max(0,(h.total||0)-(h.correct||0)),0);
  if($("dashFavorites"))$("dashFavorites").textContent=favCount;
  if($("dashNotes"))$("dashNotes").textContent=noteCount;
  if($("dashMarked"))$("dashMarked").textContent=latest?.reviewData?.filter(x=>x.marked).length||0;
  if($("dashErrors"))$("dashErrors").textContent=errorCount;
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

async function scanLegacyProgress(showFeedback=false){
  const home=$("homeScreen");
  if(!home)return;

  let panel=$("legacyRecoveryPanel");
  const progress=await getAll("progress");
  const currentBanks=await getAll("banks");

  if(!panel){
    panel=document.createElement("article");
    panel.id="legacyRecoveryPanel";
    panel.className="panel legacy-recovery-panel";
    const settingsPage=$("pageSettings");
    if(settingsPage)settingsPage.insertBefore(panel,settingsPage.firstElementChild?.nextSibling||null);
    else home.appendChild(panel);
  }

  panel.innerHTML=`
    <div class="panel-title">
      <div>
        <p>RECUPERAÇÃO</p>
        <h2>Progresso salvo no navegador</h2>
      </div>
      <button id="legacyRescanBtn" class="btn secondary" type="button">Procurar novamente</button>
    </div>
    <div id="legacyRecoveryStatus" class="legacy-recovery-status">Verificando o IndexedDB...</div>
    <div class="legacy-recovery-list"></div>
  `;

  const rescanBtn=panel.querySelector("#legacyRescanBtn");
  const status=panel.querySelector("#legacyRecoveryStatus");
  const list=panel.querySelector(".legacy-recovery-list");

  rescanBtn.onclick=async()=>{
    rescanBtn.disabled=true;
    rescanBtn.textContent="Procurando...";
    try{
      await scanLegacyProgress(true);
    }finally{
      const newBtn=$("legacyRescanBtn");
      if(newBtn){
        newBtn.disabled=false;
        newBtn.textContent="Procurar novamente";
      }
    }
  };

  if(!progress.length){
    status.innerHTML="<strong>Nenhum progresso foi encontrado neste banco do navegador.</strong><p>Não apague os dados do site. Verifique também se você está usando o mesmo navegador, perfil e endereço do GitHub Pages.</p>";
    if(showFeedback)toast("Busca concluída: nenhum progresso encontrado.");
    return;
  }

  status.innerHTML=`<strong>${progress.length} progresso(s) encontrado(s).</strong><p>Escolha abaixo o simulado que deseja continuar.</p>`;

  const rows=[];
  for(const pr of progress.sort((a,b)=>(b.savedAt||"").localeCompare(a.savedAt||""))){
    const order=Array.isArray(pr.order)?pr.order.map(String):[];
    let bank=currentBanks.find(b=>b.id===pr.bankId);

    if(!bank&&order.length){
      let best=null,bestScore=0;
      for(const candidate of currentBanks){
        const ids=new Set((candidate.questions||[]).map(q=>String(q.id)));
        const score=order.filter(id=>ids.has(id)).length;
        if(score>bestScore){best=candidate;bestScore=score}
      }
      if(best&&bestScore>=Math.max(1,Math.ceil(order.length*.6)))bank=best;
    }

    const answered=Object.values(pr.answers||{}).filter(v=>Array.isArray(v)&&v.length).length;
    rows.push({pr,bank,answered,total:order.length});
  }

  rows.forEach(({pr,bank,answered,total})=>{
    const item=document.createElement("div");
    item.className="legacy-recovery-item";
    const when=pr.savedAt?new Date(pr.savedAt).toLocaleString("pt-BR"):"data não registrada";

    item.innerHTML=`
      <div>
        <strong>${bank?esc(bank.name):"Simulado salvo sem banco associado"}</strong>
        <p>${answered}/${total} respondidas · ${when}</p>
        ${bank?"":"<small>O progresso existe, mas o banco correspondente não foi localizado.</small>"}
      </div>
    `;

    const btn=document.createElement("button");
    btn.className="btn primary";
    btn.textContent=bank?"Recuperar e continuar":"Banco não localizado";
    btn.disabled=!bank;

    btn.onclick=async()=>{
      try{
        btn.disabled=true;
        btn.textContent="Recuperando...";

        if(pr.bankId!==bank.id){
          await put("progress",{...pr,bankId:bank.id,savedAt:new Date().toISOString()});
        }

        selectedBank=bank;
        await showSetup(bank.id);
        await resume();
        toast("Progresso recuperado com sucesso.");
      }catch(error){
        console.error(error);
        alert("Não foi possível recuperar o progresso: "+(error.message||error));
        btn.disabled=false;
        btn.textContent="Recuperar e continuar";
      }
    };

    item.appendChild(btn);
    list.appendChild(item);
  });

  if(showFeedback)toast(`Busca concluída: ${progress.length} progresso(s) encontrado(s).`);
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
  notes={};
  await loadQuestionMetadata();
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
  notes=p.notes||{};
  await loadQuestionMetadata();
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

  updateQuestionActions(q);
  updateLiveCounts();
  renderNavigator();

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
    if(favorites.has(q.id))b.classList.add("favorite");
    if(String(notes[q.id]||"").trim())b.classList.add("note");
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

async function toggleFavorite(){
  const id=questions[currentIndex].id;
  favorites.has(id)?favorites.delete(id):favorites.add(id);
  await persistQuestionMetadata(id);
  renderQuestion();
  toast(favorites.has(id)?"Questão adicionada aos favoritos.":"Questão removida dos favoritos.");
}

function toggleMarked(){
  const id=questions[currentIndex].id;
  marked.has(id)?marked.delete(id):marked.add(id);
  renderQuestion();
  toast(marked.has(id)?"Questão marcada para revisão.":"Marcação removida.");
}

function metadataKey(questionId){return `${selectedBank.id}::${questionId}`}

async function loadQuestionMetadata(){
  if(!selectedBank)return;
  const all=await getAll("questionData");
  all.filter(x=>x.bankId===selectedBank.id).forEach(x=>{
    if(x.favorite)favorites.add(x.questionId);
    if(String(x.note||"").trim())notes[x.questionId]=x.note;
  });
}

async function persistQuestionMetadata(questionId){
  await put("questionData",{
    key:metadataKey(questionId),
    bankId:selectedBank.id,
    questionId,
    favorite:favorites.has(questionId),
    note:notes[questionId]||"",
    updatedAt:new Date().toISOString()
  });
}

function updateQuestionActions(q){
  const fav=favorites.has(q.id),mark=marked.has(q.id),hasNote=Boolean(String(notes[q.id]||"").trim());
  const fb=$("favoriteQuestionBtn"),mb=$("markQuestionBtn"),nb=$("noteQuestionBtn");
  fb.classList.toggle("active",fav);fb.setAttribute("aria-pressed",String(fav));fb.querySelector("span").textContent=fav?"★":"☆";fb.querySelector("small").textContent=fav?"Questão salva":"Salvar questão";
  mb.classList.toggle("active",mark);mb.setAttribute("aria-pressed",String(mark));mb.querySelector("small").textContent=mark?"Marcada":"Revisar depois";
  nb.classList.toggle("active",hasNote);nb.setAttribute("aria-pressed",String(hasNote));$("noteIndicator").classList.toggle("hidden",!hasNote);
}

function updateLiveCounts(){
  const answered=questions.filter(q=>(answers[q.id]||[]).length).length;
  const noteCount=questions.filter(q=>String(notes[q.id]||"").trim()).length;
  if($("liveAnswered"))$("liveAnswered").textContent=answered;
  if($("liveRemaining"))$("liveRemaining").textContent=Math.max(0,questions.length-answered);
  if($("liveFavorites"))$("liveFavorites").textContent=favorites.size;
  if($("liveMarked"))$("liveMarked").textContent=marked.size;
  if($("liveNotes"))$("liveNotes").textContent=noteCount;
}

function toggleNavigator(){
  $("questionNavigator").classList.toggle("hidden");
  if(!$("questionNavigator").classList.contains("hidden"))renderNavigator();
}

function openNoteModal(){
  const q=questions[currentIndex];
  $("noteQuestionPreview").textContent=`Questão ${currentIndex+1}: ${q.pergunta||""}`;
  $("noteTextarea").value=notes[q.id]||"";
  updateNoteCounter();
  $("noteModal").classList.remove("hidden");
  document.body.style.overflow="hidden";
  setTimeout(()=>$("noteTextarea").focus(),50);
}

function closeNoteModal(){
  $("noteModal").classList.add("hidden");
  document.body.style.overflow="";
}

function updateNoteCounter(){
  $("noteCharCount").textContent=`${$("noteTextarea").value.length}/4000`;
}

async function saveCurrentNote(){
  const id=questions[currentIndex].id;
  const value=$("noteTextarea").value.trim();
  if(value)notes[id]=value;else delete notes[id];
  await persistQuestionMetadata(id);
  await saveProgress();
  closeNoteModal();renderQuestion();toast(value?"Anotação salva.":"Anotação removida.");
}

async function deleteCurrentNote(){
  const id=questions[currentIndex].id;
  delete notes[id];$("noteTextarea").value="";
  await persistQuestionMetadata(id);await saveProgress();
  closeNoteModal();renderQuestion();toast("Anotação apagada.");
}

function handleExamShortcuts(e){
  if($("quizScreen").classList.contains("hidden")||!$("noteModal").classList.contains("hidden"))return;
  if(["INPUT","TEXTAREA","SELECT"].includes(document.activeElement?.tagName))return;
  const key=e.key.toLowerCase();
  if(key==="f"){e.preventDefault();toggleFavorite()}
  if(key==="r"){e.preventDefault();toggleMarked()}
  if(key==="n"){e.preventDefault();openNoteModal()}
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

  const progressRecord={
    bankId:selectedBank.id,
    currentIndex,
    order:questions.map(q=>q.id),
    answers,
    timerSeconds,
    settings,
    favorites:[...favorites],
    marked:[...marked],
    notes,
    savedAt:new Date().toISOString()
  };
  await put("progress",progressRecord);
  queueCloudProgress(progressRecord);
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
  try{await deleteCloudProgress(selectedBank)}catch(e){console.error(e)}
  await showSetup(selectedBank.id);
}

async function finish(){
  const unanswered=questions.filter(q=>!(answers[q.id]||[]).length).length;
  if(marked.size&&!confirm(`Há ${marked.size} questão(ões) marcada(s) para revisão. Deseja finalizar mesmo assim?`))return;
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
      marked:marked.has(q.id),
      note:notes[q.id]||""
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
  try{await pushHistory(selectedBank,historyRecord)}catch(e){console.error("Histórico pendente:",e)}
  await del("progress",selectedBank.id);
  try{await deleteCloudProgress(selectedBank)}catch(e){console.error(e)}

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
    e.dataset.notes=Boolean(String(x.note||"").trim());

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

    if(String(x.note||"").trim()){
      const n=document.createElement("div");
      n.className="personal-note";
      n.innerHTML=`<strong>📝 Minha anotação</strong><p>${esc(x.note)}</p>`;
      e.appendChild(n);
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
      f==="marked"&&e.dataset.marked==="true"||
      f==="notes"&&e.dataset.notes==="true";

    e.classList.toggle("hidden",!show);
  });
}

async function exportBackup(){
  const data={
    version:"7.0",
    exportedAt:new Date().toISOString(),
    banks:await getAll("banks"),
    progress:await getAll("progress"),
    history:await getAll("history"),
    questionData:await getAll("questionData")
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
  for(const x of data.questionData||[])await put("questionData",x);

  await refreshHome();
  toast("Backup restaurado.");
}

function showHome(){
  showApplicationPage("home");
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
