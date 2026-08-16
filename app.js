import {put,get,getAll,del} from "./db.js";
import {initializeAuth,signIn,signUp,signOut,getCloudUser,pushProgress,pullProgress,deleteCloudProgress,deleteCloudBank,pushHistory,ensureCloudBank,pullCloudState,getCloudRevision} from "./cloud.js?v=7.1.0";
const $=id=>document.getElementById(id);const LETTERS=["a","b","c","d","e"];
const ONBOARDING_KEY="simulador-academy-onboarding-v2";
let onboardingStep=0,onboardingTarget=null;
const onboardingSteps=[
  {selector:"#dashboard",icon:"⌂",title:"Visão geral",text:"Acompanhe simulados, questões respondidas, taxa de acertos e tempo de estudo.",placement:"bottom"},
  {selector:"#banks",icon:"▤",title:"Bancos de questões",text:"Abra um banco já importado para iniciar ou continuar um simulado.",placement:"right"},
  {selector:"#import",icon:"⇩",title:"Importar conteúdo",text:"Importe CSV, pasta de imagens ou um pacote ZIP completo.",placement:"top"},
  {selector:"#continueStudy",icon:"▶",title:"Continuar simulado",text:"Continue exatamente de onde você parou.",placement:"bottom"},
  {selector:'.side-link[data-page="review"]',icon:"☆",title:"Estudo inteligente",text:"Consulte favoritas, marcações, anotações e erros.",placement:"right"},
  {selector:'.side-link[data-page="history"]',icon:"◷",title:"Histórico",text:"Abra resultados anteriores e revise suas respostas.",placement:"right"}
];
let banks=[],selectedBank=null,questions=[],answers={},currentIndex=0,timerSeconds=0,timerHandle=null,settings={},favorites=new Set(),marked=new Set(),notes={},reviewData=[],answerAudit=[];
let dragDropBuilder={imageData:"",imageName:"",promptImageData:"",promptImageName:"",zones:[]},activeDragDropTokenId="";
let commonQuestionBuilder={questionImageData:"",questionImageName:"",alternatives:{}};
let managedBankId="";
let editingQuestion=null;
let authMode="signin",cloudSaveTimer=null,pendingCloudProgress=null,cloudSaveInFlight=false;
document.addEventListener("DOMContentLoaded",init);

async function init(){
  setupApplicationPages();
  setupV6Features();
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

  const analytics=document.createElement("div");
  analytics.id="analyticsDashboard";
  analytics.className="analytics-dashboard";
  analytics.innerHTML=`
    <article class="panel analytics-card analytics-card-wide">
      <div class="analytics-card-head">
        <div><p>CURVA DE APRENDIZADO</p><h3>Evolução da taxa de acertos</h3></div>
        <span id="learningTrendBadge" class="analytics-badge">Sem dados</span>
      </div>
      <div class="chart-wrap chart-wrap-large"><canvas id="learningCurveChart"></canvas></div>
    </article>

    <article class="panel analytics-card">
      <div class="analytics-card-head">
        <div><p>DESEMPENHO</p><h3>Acertos x erros</h3></div>
      </div>
      <div class="chart-wrap chart-wrap-donut"><canvas id="accuracyDonutChart"></canvas></div>
      <div id="accuracyLegend" class="analytics-legend"></div>
    </article>

    <article class="panel analytics-card">
      <div class="analytics-card-head">
        <div><p>ATIVIDADE</p><h3>Questões por simulado</h3></div>
      </div>
      <div class="chart-wrap"><canvas id="questionsBarChart"></canvas></div>
    </article>

    <article class="panel analytics-card analytics-card-wide">
      <div class="analytics-card-head">
        <div><p>CATEGORIAS</p><h3>Taxa de acerto por assunto</h3></div>
      </div>
      <div id="categoryPerformance" class="category-performance"></div>
    </article>

    <article class="panel analytics-card">
      <div class="analytics-card-head">
        <div><p>RITMO</p><h3>Tempo médio por questão</h3></div>
      </div>
      <div class="analytics-focus-number"><strong id="averageQuestionTime">0s</strong><span>por questão respondida</span></div>
      <div id="studySummaryMini" class="study-summary-mini"></div>
    </article>`;
  statsPage.appendChild(analytics);

  const syncDiagnostics=document.createElement("article");
  syncDiagnostics.id="syncDiagnostics";
  syncDiagnostics.className="panel sync-diagnostics-panel";
  syncDiagnostics.innerHTML=`
    <div class="panel-title"><div><p>NUVEM</p><h2>Diagnóstico da sincronização</h2></div><span id="syncDiagBadge" class="sync-diag-badge">Aguardando</span></div>
    <div class="panel-body">
      <div class="sync-diag-grid">
        <div><span>Última sincronização</span><strong id="syncDiagTime">Ainda não executada</strong></div>
        <div><span>Bancos na nuvem</span><strong id="syncDiagBanks">0</strong></div>
        <div><span>Em andamento</span><strong id="syncDiagProgress">0</strong></div>
        <div><span>Históricos</span><strong id="syncDiagHistory">0</strong></div>
        <div><span>Imagens encontradas</span><strong id="syncDiagFound">0</strong></div>
        <div><span>Catálogo na nuvem</span><strong id="syncDiagCatalog">0</strong></div>
        <div><span>Imagens enviadas</span><strong id="syncDiagUploaded">0</strong></div>
        <div><span>Imagens baixadas</span><strong id="syncDiagDownloaded">0</strong></div>
        <div><span>Arquivos ignorados</span><strong id="syncDiagSkipped">0</strong></div>
      </div>
      <p id="syncDiagMessage" class="sync-diag-message">Clique em sincronizar para verificar sua conta.</p>
      <button id="syncDiagRetry" class="btn secondary" type="button">Sincronizar novamente</button>
    </div>`;
  syncDiagnostics.querySelector("#syncDiagRetry").onclick=()=>syncAllNow({force:true});
  settingsPage.appendChild(syncDiagnostics);
  if(backup)settingsPage.appendChild(backup);

  root.innerHTML="";
  root.append(home,historyPage,reviewPage,statsPage,settingsPage);
  home.classList.remove("hidden");
}

function bindSidebarNavigation(){
  document.querySelectorAll(".side-link[data-page]").forEach(button=>{
    button.onclick=()=>{
      const page=button.dataset.page;
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
    button.classList.toggle("active",button.dataset.page===page);
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
  if(page==="stats")refreshHome().then(renderAnalyticsDashboard);
  if(page==="flashcards")renderFlashcards();
  if(page==="profile")renderProfilePage();
  if(page==="search")renderGlobalSearch();
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
        <p><strong>Sua resposta:</strong> ${esc(formatAnswerForDisplay(item.q,item.u)||"Não respondida")}</p>
        <p><strong>Resposta correta:</strong> ${esc(formatAnswerForDisplay(item.q,item.r)||"Não informada")}</p>
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


const V6_GOAL_KEY="simulador-academy-v6-goal";
const V6_PROFILE_KEY="simulador-academy-v6-profile";
let deferredInstallPrompt=null;
let flashcardItems=[],flashcardIndex=0,flashcardRevealed=false;

function setupV6Features(){
  const root=$("homeScreen");
  if(!root||$("pageFlashcards"))return;

  const flashcards=makeApplicationPage("pageFlashcards","Flashcards","MEMORIZAÇÃO");
  flashcards.innerHTML+=`
    <article class="panel v6-toolbar">
      <div>
        <p>CRIADOS A PARTIR DOS ERROS</p>
        <h2>Revisão rápida</h2>
      </div>
      <div class="v6-toolbar-actions">
        <select id="flashcardCategoryFilter" class="v6-select"><option value="">Todas as categorias</option></select>
        <button id="shuffleFlashcardsBtn" class="btn secondary">Embaralhar</button>
      </div>
    </article>
    <div id="flashcardStage" class="flashcard-stage"></div>`;

  const profile=makeApplicationPage("pageProfile","Perfil e metas","PROGRESSO PESSOAL");
  profile.innerHTML+=`
    <section class="profile-grid">
      <article class="panel profile-hero">
        <div class="profile-avatar">JD</div>
        <div>
          <p>NÍVEL DE ESTUDO</p>
          <h2 id="profileLevel">Nível 1</h2>
          <div class="xp-track"><i id="profileXpBar"></i></div>
          <span id="profileXpText">0 XP</span>
        </div>
      </article>
      <article class="panel goal-card">
        <div class="panel-body">
          <p class="eyebrow">META DIÁRIA</p>
          <h2 id="dailyGoalTitle">20 questões por dia</h2>
          <div class="goal-progress"><i id="dailyGoalBar"></i></div>
          <p id="dailyGoalText">0 de 20 concluídas hoje</p>
          <label class="field compact-field"><span>Alterar meta</span><input id="dailyGoalInput" type="number" min="1" max="500" value="20"></label>
          <button id="saveDailyGoalBtn" class="btn primary">Salvar meta</button>
        </div>
      </article>
      <article class="panel streak-card">
        <div class="panel-body">
          <p class="eyebrow">SEQUÊNCIA</p>
          <strong id="studyStreak">0 dias</strong>
          <span>estudando consecutivamente</span>
        </div>
      </article>
    </section>
    <article class="panel study-calendar-card">
      <div class="panel-title"><div><p>ATIVIDADE</p><h2>Calendário de estudos</h2></div></div>
      <div id="activityHeatmap" class="activity-heatmap"></div>
    </article>
    <article class="panel">
      <div class="panel-title"><div><p>CONQUISTAS</p><h2>Marcos desbloqueados</h2></div></div>
      <div id="achievementGrid" class="achievement-grid"></div>
    </article>
    <article class="panel">
      <div class="panel-title"><div><p>RECOMENDAÇÕES</p><h2>Próximos assuntos para revisar</h2></div></div>
      <div id="recommendationList" class="recommendation-list"></div>
    </article>`;

  const search=makeApplicationPage("pageSearch","Busca global","QUESTÕES E CONTEÚDOS");
  search.innerHTML+=`
    <article class="panel">
      <div class="panel-body">
        <div class="global-search-controls">
          <input id="globalSearchInput" class="global-search-input" placeholder="Pesquisar enunciado, resposta, feedback ou categoria...">
          <select id="globalSearchFilter" class="v6-select">
            <option value="all">Tudo</option>
            <option value="wrong">Erros</option>
            <option value="favorite">Favoritas</option>
            <option value="image">Com imagens</option>
          </select>
          <button id="runGlobalSearchBtn" class="btn primary">Pesquisar</button>
        </div>
      </div>
    </article>
    <div id="globalSearchResults" class="global-search-results"></div>`;

  root.append(flashcards,profile,search);

  $("shuffleFlashcardsBtn").onclick=()=>{
    flashcardItems=flashcardItems.sort(()=>Math.random()-.5);
    flashcardIndex=0;flashcardRevealed=false;renderFlashcardCard();
  };
  $("flashcardCategoryFilter").onchange=renderFlashcards;
  $("saveDailyGoalBtn").onclick=saveDailyGoal;
  $("runGlobalSearchBtn").onclick=renderGlobalSearch;
  $("globalSearchInput").onkeydown=e=>{if(e.key==="Enter")renderGlobalSearch()};

  const searchBox=$("dashboardSearch");
  if(searchBox){
    searchBox.placeholder="Buscar em todo o sistema...";
    searchBox.onkeydown=e=>{
      if(e.key==="Enter"){
        showApplicationPage("search");
        $("globalSearchInput").value=searchBox.value;
        renderGlobalSearch();
      }
    };
  }

  window.addEventListener("beforeinstallprompt",e=>{
    e.preventDefault();
    deferredInstallPrompt=e;
    $("installAppBtn")?.classList.remove("hidden");
  });
  $("installAppBtn").onclick=async()=>{
    if(!deferredInstallPrompt)return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt=null;
    $("installAppBtn").classList.add("hidden");
  };
}

async function collectReviewedQuestions(){
  const history=await getAll("history");
  const metadata=await getAll("questionData");
  const metaMap=new Map(metadata.map(item=>[`${item.bankId}::${item.questionId}`,item]));
  const rows=[];
  history.slice().sort((a,b)=>String(b.finishedAt||"").localeCompare(String(a.finishedAt||""))).forEach(record=>{
    (record.reviewData||[]).forEach(item=>{
      if(!item?.q)return;
      const meta=metaMap.get(`${record.bankId}::${item.q.id}`)||{};
      rows.push({...item,bankId:record.bankId,historyId:record.id,favorite:Boolean(meta.favorite||item.favorite),note:meta.note||item.note||""});
    });
  });
  return rows;
}

async function renderFlashcards(){
  const rows=await collectReviewedQuestions();
  const categories=[...new Set(rows.map(x=>x.q.categoria||"Sem categoria"))].sort();
  const select=$("flashcardCategoryFilter");
  const selected=select.value;
  select.innerHTML='<option value="">Todas as categorias</option>'+categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");
  select.value=selected;
  flashcardItems=rows.filter(item=>!item.ok&&(!selected||(item.q.categoria||"Sem categoria")===selected));
  flashcardIndex=0;flashcardRevealed=false;
  renderFlashcardCard();
}

function renderFlashcardCard(){
  const stage=$("flashcardStage");
  if(!stage)return;
  if(!flashcardItems.length){
    stage.innerHTML='<div class="empty-state"><strong>Nenhum flashcard disponível.</strong><p>Finalize simulados com erros para gerar cartões automaticamente.</p></div>';
    return;
  }
  const item=flashcardItems[flashcardIndex];
  stage.innerHTML=`
    <article class="flashcard ${flashcardRevealed?"revealed":""}">
      <div class="flashcard-top">
        <span>${esc(item.q.categoria||"Sem categoria")}</span>
        <strong>${flashcardIndex+1} / ${flashcardItems.length}</strong>
      </div>
      <div class="flashcard-question">${esc(item.q.pergunta||"")}</div>
      <div class="flashcard-answer ${flashcardRevealed?"":"hidden"}">
        <p><strong>Resposta correta:</strong> ${esc(formatAnswerForDisplay(item.q,item.r))}</p>
        ${item.q.feedback?`<p>${esc(item.q.feedback)}</p>`:""}
      </div>
      <div class="flashcard-actions">
        <button id="prevFlashcardBtn" class="btn secondary">Anterior</button>
        <button id="revealFlashcardBtn" class="btn primary">${flashcardRevealed?"Ocultar resposta":"Mostrar resposta"}</button>
        <button id="nextFlashcardBtn" class="btn secondary">Próximo</button>
      </div>
    </article>`;
  $("prevFlashcardBtn").onclick=()=>{flashcardIndex=(flashcardIndex-1+flashcardItems.length)%flashcardItems.length;flashcardRevealed=false;renderFlashcardCard()};
  $("nextFlashcardBtn").onclick=()=>{flashcardIndex=(flashcardIndex+1)%flashcardItems.length;flashcardRevealed=false;renderFlashcardCard()};
  $("revealFlashcardBtn").onclick=()=>{flashcardRevealed=!flashcardRevealed;renderFlashcardCard()};
}

function getDailyGoal(){
  return Math.max(1,Number(localStorage.getItem(V6_GOAL_KEY))||20);
}

function saveDailyGoal(){
  const value=Math.max(1,Math.min(500,Number($("dailyGoalInput").value)||20));
  localStorage.setItem(V6_GOAL_KEY,String(value));
  renderProfilePage();
  toast("Meta diária atualizada.");
}

async function renderProfilePage(){
  const history=await getAll("history");
  const today=new Date().toISOString().slice(0,10);
  const todayAnswered=history.filter(h=>String(h.finishedAt||"").slice(0,10)===today).reduce((s,h)=>s+(Number(h.total)||0),0);
  const totalAnswered=history.reduce((s,h)=>s+(Number(h.total)||0),0);
  const totalCorrect=history.reduce((s,h)=>s+(Number(h.correct)||0),0);
  const xp=totalAnswered*5+totalCorrect*5+history.length*20;
  const level=Math.floor(xp/500)+1;
  const levelProgress=xp%500;
  $("profileLevel").textContent=`Nível ${level}`;
  $("profileXpText").textContent=`${xp} XP · faltam ${500-levelProgress} XP para o próximo nível`;
  $("profileXpBar").style.width=`${levelProgress/5}%`;

  const goal=getDailyGoal();
  $("dailyGoalInput").value=goal;
  $("dailyGoalTitle").textContent=`${goal} questões por dia`;
  $("dailyGoalText").textContent=`${todayAnswered} de ${goal} concluídas hoje`;
  $("dailyGoalBar").style.width=`${Math.min(100,todayAnswered/goal*100)}%`;

  const dates=[...new Set(history.map(h=>String(h.finishedAt||"").slice(0,10)).filter(Boolean))].sort();
  let streak=0;
  const cursor=new Date();
  for(;;){
    const key=cursor.toISOString().slice(0,10);
    if(dates.includes(key)){streak++;cursor.setDate(cursor.getDate()-1)}
    else break;
  }
  $("studyStreak").textContent=`${streak} dia${streak===1?"":"s"}`;

  renderActivityHeatmap(history);
  renderAchievements({history,totalAnswered,totalCorrect,streak});
  renderRecommendations(history);
}

function renderActivityHeatmap(history){
  const host=$("activityHeatmap");
  const counts={};
  history.forEach(h=>{
    const key=String(h.finishedAt||"").slice(0,10);
    counts[key]=(counts[key]||0)+(Number(h.total)||0);
  });
  const days=[];
  const cursor=new Date();cursor.setDate(cursor.getDate()-83);
  for(let i=0;i<84;i++){
    const key=cursor.toISOString().slice(0,10);
    days.push({key,count:counts[key]||0});
    cursor.setDate(cursor.getDate()+1);
  }
  host.innerHTML=days.map(day=>{
    const level=day.count===0?0:day.count<10?1:day.count<30?2:day.count<60?3:4;
    return `<i class="heat-${level}" title="${day.key}: ${day.count} questões"></i>`;
  }).join("");
}

function renderAchievements({history,totalAnswered,totalCorrect,streak}){
  const achievements=[
    ["🎯","Primeiro simulado",history.length>=1],
    ["📚","100 questões",totalAnswered>=100],
    ["🏅","500 questões",totalAnswered>=500],
    ["🔥","7 dias seguidos",streak>=7],
    ["⭐","80% de acertos",totalAnswered>0&&totalCorrect/totalAnswered>=.8],
    ["🚀","10 simulados",history.length>=10],
  ];
  $("achievementGrid").innerHTML=achievements.map(([icon,name,unlocked])=>`
    <div class="achievement ${unlocked?"unlocked":"locked"}"><span>${icon}</span><strong>${esc(name)}</strong><small>${unlocked?"Desbloqueada":"Bloqueada"}</small></div>`).join("");
}

function renderRecommendations(history){
  const map=new Map();
  history.forEach(record=>(record.reviewData||[]).forEach(item=>{
    const name=item?.q?.categoria||"Sem categoria";
    const row=map.get(name)||{total:0,correct:0};
    row.total++;if(item.ok)row.correct++;
    map.set(name,row);
  }));
  const weak=[...map.entries()].map(([name,v])=>({name,pct:v.total?Math.round(v.correct/v.total*100):0,total:v.total}))
    .filter(x=>x.total>=1).sort((a,b)=>a.pct-b.pct).slice(0,5);
  $("recommendationList").innerHTML=weak.length?weak.map(x=>`
    <button class="recommendation-item" type="button" data-category="${esc(x.name)}">
      <span><strong>${esc(x.name)}</strong><small>${x.pct}% de acerto em ${x.total} questão(ões)</small></span><b>Revisar →</b>
    </button>`).join(""):'<div class="empty-state">Conclua mais simulados para receber recomendações.</div>';
  document.querySelectorAll(".recommendation-item").forEach(btn=>btn.onclick=()=>{
    showApplicationPage("review");
    showReviewLibrary("wrong");
  });
}

async function renderGlobalSearch(){
  const input=$("globalSearchInput");
  if(!input)return;
  const term=input.value.trim().toLowerCase();
  const filter=$("globalSearchFilter").value;
  const rows=await collectReviewedQuestions();
  const filtered=rows.filter(item=>{
    const q=item.q||{};
    const text=[q.pergunta,q.feedback,q.categoria,q.alt_a,q.alt_b,q.alt_c,q.alt_d,q.alt_e,formatAnswerForDisplay(q,item.r)].join(" ").toLowerCase();
    if(term&&!text.includes(term))return false;
    if(filter==="wrong"&&item.ok)return false;
    if(filter==="favorite"&&!item.favorite)return false;
    if(filter==="image"&&!q.imagem_pergunta&&!q.img_a&&!q.img_b&&!q.img_c&&!q.img_d&&!q.img_e)return false;
    return true;
  }).slice(0,100);
  const host=$("globalSearchResults");
  host.innerHTML=filtered.length?filtered.map(item=>`
    <article class="panel global-search-card">
      <div>
        <span class="review-category">${esc(item.q.categoria||"Sem categoria")}</span>
        <h3>${esc(item.q.pergunta||"")}</h3>
        <p>${item.ok?"✓ Respondida corretamente":"✕ Respondida incorretamente"} · correta: ${esc(formatAnswerForDisplay(item.q,item.r))}</p>
      </div>
      <button class="btn secondary search-open-question" data-history="${esc(item.historyId)}">Abrir</button>
    </article>`).join(""):'<div class="empty-state">Nenhum resultado encontrado.</div>';
  host.querySelectorAll(".search-open-question").forEach(btn=>btn.onclick=()=>openHistoryDetails(btn.dataset.history));
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
  if(logoutBtn) logoutBtn.onclick=async()=>{
    logoutBtn.disabled=true;
    try{await signOut()}
    catch(error){console.error("Falha ao sair",error);toast("Não foi possível sair. Tente novamente.")}
    finally{logoutBtn.disabled=false}
  };
  if(syncBtn) syncBtn.onclick=()=>syncAllNow({force:true});
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
  if(!user){
    authMode="signin";
    $("authTitle").textContent="Entrar";
    $("authSubmitBtn").textContent="Entrar";
    $("authSubmitBtn").disabled=false;
    $("authToggleBtn").textContent="Criar uma conta";
    $("authMessage").textContent="";
    $("authPassword").value="";
    return;
  }
  $("logoutBtn").textContent=(user.email||"U").slice(0,2).toUpperCase();
  setCloudStatus("Sincronizando","syncing");
  try{
    await syncAllNow({silent:true});
    populateLegacyBanks();
    setCloudStatus("Nuvem ativa","online");
  }catch(error){
    console.error("Falha na sincronização inicial",error);
    await refreshHome();
    setCloudStatus("Sync pendente","offline");
  }
  window.setTimeout(startOnboardingIfNeeded,500);
}

function setCloudStatus(text,state){
  const el=$("cloudStatus"); if(!el)return;
  el.textContent=text; el.className="cloud-status "+state;
}

function updateSyncDiagnostics(data={}){
  const badge=$("syncDiagBadge"); if(!badge)return;
  const state=data.state||"idle";
  badge.textContent=state==="running"?"Sincronizando":state==="success"?"Saudável":"Atenção";
  badge.className="sync-diag-badge "+state;
  if(data.time)$("syncDiagTime").textContent=new Date(data.time).toLocaleString("pt-BR");
  if(data.banks!==undefined)$("syncDiagBanks").textContent=data.banks;
  if(data.progress!==undefined)$("syncDiagProgress").textContent=data.progress;
  if(data.history!==undefined)$("syncDiagHistory").textContent=data.history;
  if(data.found!==undefined)$("syncDiagFound").textContent=data.found;
  if(data.catalog!==undefined)$("syncDiagCatalog").textContent=data.catalog;
  if(data.uploaded!==undefined)$("syncDiagUploaded").textContent=data.uploaded;
  if(data.downloaded!==undefined)$("syncDiagDownloaded").textContent=data.downloaded;
  if(data.skipped!==undefined)$("syncDiagSkipped").textContent=data.skipped;
  $("syncDiagMessage").textContent=data.message||(state==="running"?"Sincronização em andamento...":"");
}

function syncStateKey(){
  return `simulador-cloud-sync-v5:${getCloudUser()?.id||"anonymous"}`;
}

function readSyncState(){
  try{return JSON.parse(localStorage.getItem(syncStateKey())||"{}")}
  catch{return {}}
}

function writeSyncState(value){
  localStorage.setItem(syncStateKey(),JSON.stringify({...readSyncState(),...value}));
}

function markCloudDirty(reason="alteração local"){
  if(getCloudUser())writeSyncState({dirty:true,dirtyReason:reason});
}

function markProgressPushSynced(progress){
  const state=readSyncState();
  if(!state.revision)return;
  try{
    const revision=JSON.parse(state.revision);
    if(Array.isArray(revision.progress))revision.progress[1]=progress.savedAt||new Date().toISOString();
    writeSyncState({dirty:false,dirtyReason:"",revision:JSON.stringify(revision),syncedAt:new Date().toISOString()});
  }catch{}
}

async function syncAllNow(options={}){
  if(!getCloudUser())return;
  setCloudStatus("Verificando","syncing");
  updateSyncDiagnostics({state:"running",message:"Verificando se existem alterações..."});
  try{
    const beforeRevision=await getCloudRevision();
    const previous=readSyncState();
    if(!options.force&&!previous.dirty&&previous.revision===beforeRevision){
      await refreshHome();
      setCloudStatus("Sincronizado","online");
      updateSyncDiagnostics({state:"success",time:previous.syncedAt||new Date().toISOString(),
        ...(previous.diagnostics||{}),message:"Nenhuma alteração encontrada. Sincronização completa dispensada."});
      return;
    }

    setCloudStatus("Sincronizando","syncing");
    updateSyncDiagnostics({state:"running",message:"Alterações encontradas. Sincronizando sua conta..."});
    banks=await getAll("banks");
    for(const bank of banks){
      await ensureCloudBank(bank);
      const local=await get("progress",bank.id);
      const remote=await pullProgress(bank);
      let winner=local;
      if(remote && shouldUseRemoteProgress(local,remote)){
        await put("progress",remote);
        winner=remote;
      }
      // Regrava o vencedor no formato leve da V6.1.1, removendo snapshots
      // Base64 pesados deixados pela versão anterior.
      if(winner)await pushProgress(bank,winner);
    }

    // Envia também os resultados antigos que ainda existiam apenas neste PC.
    const localHistory=await getAll("history");
    for(const item of localHistory){
      const bank=banks.find(b=>b.id===item.bankId);
      if(bank)await pushHistory(bank,item);
    }

    // O login restaura a biblioteca, os simulados em andamento e o histórico,
    // mesmo quando o IndexedDB está vazio (outro PC ou janela anônima).
    // Em uma sincronização completa, valida e baixa o manifesto de imagens.
    // A revisão incremental impede que esta etapa se repita após cada F5.
    const cloudState=await pullCloudState({downloadImages:true});
    const bankIdMap=new Map();
    for(const remoteBank of cloudState.banks){
      const matches=banks.filter(local=>local.id===remoteBank.id
        ||(String(local.name||"").trim().toLowerCase()===String(remoteBank.name||"").trim().toLowerCase()
          &&(local.questions?.length||0)===(remoteBank.questions?.length||0)));
      const existing=matches.find(local=>local.id===remoteBank.id)||matches[0];
      const localId=existing?.id||remoteBank.id;
      bankIdMap.set(remoteBank.id,localId);
      if(matches.length){
        // Versões antigas podiam criar mais de uma cópia local. Atualiza todas
        // para que qualquer progresso aberto encontre as imagens baixadas.
        for(const match of matches){
          // A cópia local é a fonte mais recente quando o usuário reimporta
          // imagens corrigidas. Um manifesto remoto antigo não pode
          // sobrescrever silenciosamente essas imagens.
          const preservedImages={...(remoteBank.images||{}),...(match.images||{})};
          match.images=preservedImages;
          await put("banks",{...remoteBank,id:match.id,createdAt:match.createdAt||remoteBank.createdAt,images:preservedImages});
        }
      }else{
        await put("banks",remoteBank);
      }
    }
    for(const remote of cloudState.progress){
      const normalized={...remote,bankId:bankIdMap.get(remote.bankId)||remote.bankId};
      const local=await get("progress",normalized.bankId);
      if(shouldUseRemoteProgress(local,normalized))await put("progress",normalized);
    }
    for(const item of cloudState.history){
      await put("history",{...item,bankId:bankIdMap.get(item.bankId)||item.bankId});
    }
    await refreshHome();
    const diag=cloudState.diagnostics||{};
    const syncedAt=new Date().toISOString();
    const diagView={banks:diag.cloudBanks||0,progress:diag.cloudProgress||0,history:diag.cloudHistory||0,
      found:diag.imagesFound||0,uploaded:diag.imagesUploaded||0,downloaded:diag.imagesDownloaded||0,
      catalog:diag.manifestEntries||0,skipped:diag.filesSkipped||0};
    const afterRevision=await getCloudRevision();
    writeSyncState({dirty:false,dirtyReason:"",revision:afterRevision,syncedAt,diagnostics:diagView});
    updateSyncDiagnostics({state:diag.storageError?"warning":"success",time:syncedAt,
      ...diagView,
      message:diag.storageError?`Dados sincronizados. Storage de imagens: ${diag.storageError}`:"Conta sincronizada sem erros."});
    setCloudStatus("Sincronizado","online");
    if(!options.silent)toast("Sincronização concluída.");
  }catch(e){
    setCloudStatus("Erro de sync","error");
    updateSyncDiagnostics({state:"error",time:new Date().toISOString(),message:e.message||"Erro desconhecido na sincronização."});
    console.error(e);
    if(!options.silent)toast("Falha ao sincronizar: "+(e.message||"erro desconhecido"));
    throw e;
  }
}

function answeredCount(progress){
  return progress?.answers&&typeof progress.answers==="object"?Object.keys(progress.answers).length:0;
}

function shouldUseRemoteProgress(local,remote){
  if(!remote)return false;
  if(!local)return true;
  const remoteAnswered=answeredCount(remote),localAnswered=answeredCount(local);
  if(remoteAnswered!==localAnswered)return remoteAnswered>localAnswered;
  const remoteIndex=Number(remote.currentIndex)||0,localIndex=Number(local.currentIndex)||0;
  if(remoteIndex!==localIndex)return remoteIndex>localIndex;
  return String(remote.savedAt||"")>String(local.savedAt||"");
}

function queueCloudProgress(progress){
  pendingCloudProgress=progress;
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(()=>flushCloudProgress(),250);
}

async function flushCloudProgress(){
  if(cloudSaveInFlight||!pendingCloudProgress||!selectedBank||!getCloudUser())return;
  const progress=pendingCloudProgress;
  pendingCloudProgress=null;
  cloudSaveInFlight=true;
  setCloudStatus("Salvando","syncing");
  try{
    await pushProgress(selectedBank,progress);
    markProgressPushSynced(progress);
    setCloudStatus("Salvo na nuvem","online");
  }catch(e){
    console.error("Falha ao salvar progresso na nuvem",e);
    pendingCloudProgress=progress;
    setCloudStatus("Pendente","offline");
  }finally{
    cloudSaveInFlight=false;
    if(pendingCloudProgress){
      clearTimeout(cloudSaveTimer);
      cloudSaveTimer=setTimeout(()=>flushCloudProgress(),1500);
    }
  }
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
      settings:{limit:order.length,timeLimit:0,shuffle:false,warn:true,
        __bankSignature:questionsSignature(bank.questions),__answerAudit:[]},
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
  $("openCommonQuestionBuilderBtn").onclick=openCommonQuestionBuilder;
  $("closeCommonQuestionBuilderBtn").onclick=closeCommonQuestionBuilder;
  $("commonQuestionBuilderModal").onclick=e=>{if(e.target===$("commonQuestionBuilderModal"))closeCommonQuestionBuilder()};
  $("commonQuestionBankSelect").onchange=updateCommonQuestionBankMode;
  $("commonQuestionType").onchange=updateCommonQuestionType;
  $("commonQuestionImageFile").onchange=loadCommonQuestionImage;
  $("clearCommonQuestionImageBtn").onclick=event=>{event.preventDefault();clearCommonQuestionImage()};
  $("previewCommonQuestionBtn").onclick=()=>openQuestionPreview("common");
  $("saveCommonQuestionBtn").onclick=saveCommonQuestion;
  for(const letter of LETTERS){
    $("commonAltImage"+letter.toUpperCase()).onchange=()=>loadCommonAlternativeImage(letter);
    $("clearCommonAltImage"+letter.toUpperCase()).onclick=event=>{event.preventDefault();clearCommonAlternativeImage(letter)};
  }
  $("openDragDropBuilderBtn").onclick=openDragDropBuilder;
  $("closeDragDropBuilderBtn").onclick=closeDragDropBuilder;
  $("dragDropBuilderModal").onclick=e=>{if(e.target===$("dragDropBuilderModal"))closeDragDropBuilder()};
  $("dragDropPromptFile").onchange=loadDragDropPromptImage;
  $("dragDropBackgroundFile").onchange=loadDragDropBuilderImage;
  $("clearDragDropPromptImageBtn").onclick=event=>{event.preventDefault();clearDragDropPromptImage()};
  $("clearDragDropActivityImageBtn").onclick=event=>{event.preventDefault();clearDragDropActivityImage()};
  $("clearDragDropCanvasImageBtn").onclick=event=>{event.preventDefault();clearDragDropActivityImage()};
  $("dragDropBankSelect").onchange=updateDragDropBankMode;
  $("dragDropItemsText").oninput=renderDragDropBuilderZones;
  $("addDragDropZoneBtn").onclick=addDragDropBuilderZone;
  $("previewDragDropQuestionBtn").onclick=()=>openQuestionPreview("dragdrop");
  $("saveDragDropQuestionBtn").onclick=saveDragDropQuestion;
  $("closeQuestionPreviewBtn").onclick=closeQuestionPreview;
  $("questionPreviewModal").onclick=e=>{if(e.target===$("questionPreviewModal"))closeQuestionPreview()};
  $("closeBankManagerBtn").onclick=closeBankManager;
  $("bankManagerModal").onclick=e=>{if(e.target===$("bankManagerModal"))closeBankManager()};
  $("bankManagerSearch").oninput=renderBankManagerQuestions;
  $("saveBankNameBtn").onclick=saveManagedBankName;
  document.addEventListener("click",()=>closeAllActionMenus());
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
  window.addEventListener("resize",()=>{if(activeApplicationPage==="stats")renderAnalyticsDashboard()});
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
  populateCommonQuestionBankSelect();
  populateDragDropBankSelect();
  const history = await getAll("history");
  renderHistory(history);
  await renderDashboard(history);
  if(activeApplicationPage==="settings")await scanLegacyProgress();
  if(activeApplicationPage==="review")await renderReviewLibrary(reviewLibraryFilter);
  if(activeApplicationPage==="stats")await renderAnalyticsDashboard(history);
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
  const answered=Object.values(pr.answers||{}).filter(storedAnswerHasValue).length;
  const pct=Math.round(answered/pr.order.length*100);
  area.innerHTML=`<div class="resume-box" style="margin:0"><div><span>Em andamento</span><strong>${esc(bank.name)}</strong><p>${answered}/${pr.order.length} respondidas · ${pct}%</p></div><button class="btn primary" id="dashResume">Continuar</button></div>`;
  document.getElementById("dashResume").onclick=async()=>{await showSetup(bank.id);await resume();};
}


function chartContext(canvas){
  if(!canvas)return null;
  const dpr=Math.max(1,window.devicePixelRatio||1);
  const rect=canvas.getBoundingClientRect();
  const width=Math.max(280,Math.floor(rect.width));
  const height=Math.max(180,Math.floor(rect.height));
  canvas.width=width*dpr;
  canvas.height=height*dpr;
  const ctx=canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {ctx,width,height};
}

function cssColor(name,fallback){
  const value=getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value||fallback;
}

function drawEmptyChart(ctx,width,height,message="Sem dados suficientes"){
  ctx.clearRect(0,0,width,height);
  ctx.fillStyle=cssColor("--muted","#8e9eb4");
  ctx.font='12px Inter, "Segoe UI", Arial';
  ctx.textAlign="center";
  ctx.fillText(message,width/2,height/2);
}

function roundedRect(ctx,x,y,w,h,r){
  const radius=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+radius,y);
  ctx.arcTo(x+w,y,x+w,y+h,radius);
  ctx.arcTo(x+w,y+h,x,y+h,radius);
  ctx.arcTo(x,y+h,x,y,radius);
  ctx.arcTo(x,y,x+w,y,radius);
  ctx.closePath();
}

function drawLearningCurve(history){
  const chart=chartContext($("learningCurveChart"));
  if(!chart)return;
  const {ctx,width,height}=chart;
  const ordered=history.slice().sort((a,b)=>String(a.finishedAt||"").localeCompare(String(b.finishedAt||""))).slice(-12);
  if(!ordered.length){drawEmptyChart(ctx,width,height);return}

  const pad={left:42,right:18,top:18,bottom:34};
  const plotW=width-pad.left-pad.right;
  const plotH=height-pad.top-pad.bottom;
  const scores=ordered.map(item=>Number(item.score)||0);
  const line=cssColor("--blue","#2f7df4");
  const grid=cssColor("--border","#22334b");
  const muted=cssColor("--muted","#8e9eb4");

  ctx.clearRect(0,0,width,height);
  ctx.strokeStyle=grid;
  ctx.lineWidth=1;
  ctx.fillStyle=muted;
  ctx.font='10px Inter, "Segoe UI", Arial';
  ctx.textAlign="right";
  [0,25,50,75,100].forEach(value=>{
    const y=pad.top+plotH-(value/100)*plotH;
    ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();
    ctx.fillText(value+"%",pad.left-8,y+3);
  });

  const points=scores.map((score,index)=>({
    x:pad.left+(ordered.length===1?plotW/2:index*plotW/(ordered.length-1)),
    y:pad.top+plotH-(score/100)*plotH
  }));

  const gradient=ctx.createLinearGradient(0,pad.top,0,pad.top+plotH);
  gradient.addColorStop(0,"rgba(47,125,244,.28)");
  gradient.addColorStop(1,"rgba(47,125,244,0)");
  ctx.beginPath();
  points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
  ctx.lineTo(points.at(-1).x,pad.top+plotH);
  ctx.lineTo(points[0].x,pad.top+plotH);
  ctx.closePath();
  ctx.fillStyle=gradient;ctx.fill();

  ctx.beginPath();
  points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
  ctx.strokeStyle=line;ctx.lineWidth=2.5;ctx.stroke();

  points.forEach((p,index)=>{
    ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);
    ctx.fillStyle=line;ctx.fill();
    if(index===points.length-1){
      ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);
      ctx.strokeStyle="rgba(47,125,244,.25)";ctx.lineWidth=5;ctx.stroke();
    }
  });

  ctx.fillStyle=muted;ctx.textAlign="center";
  ordered.forEach((item,index)=>{
    if(ordered.length>7 && index%2!==0 && index!==ordered.length-1)return;
    const date=new Date(item.finishedAt);
    ctx.fillText(date.toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"}),points[index].x,height-12);
  });

  const first=scores[0]||0,last=scores.at(-1)||0,diff=Math.round(last-first);
  const badge=$("learningTrendBadge");
  if(badge){
    badge.textContent=diff===0?"Estável":`${diff>0?"+":""}${diff}% no período`;
    badge.classList.toggle("positive",diff>0);
    badge.classList.toggle("negative",diff<0);
  }
}

function drawAccuracyDonut(history){
  const chart=chartContext($("accuracyDonutChart"));
  if(!chart)return;
  const {ctx,width,height}=chart;
  const total=history.reduce((sum,h)=>sum+(Number(h.total)||0),0);
  const correct=history.reduce((sum,h)=>sum+(Number(h.correct)||0),0);
  const wrong=Math.max(0,total-correct);
  if(!total){drawEmptyChart(ctx,width,height);return}

  ctx.clearRect(0,0,width,height);
  const cx=width/2,cy=height/2,radius=Math.min(width,height)*.31,thickness=Math.max(16,radius*.24);
  const green=cssColor("--green","#39d98a");
  const red=cssColor("--red","#ff5d66");
  const start=-Math.PI/2;
  const correctAngle=(correct/total)*Math.PI*2;

  ctx.lineWidth=thickness;ctx.lineCap="round";
  ctx.beginPath();ctx.arc(cx,cy,radius,start,start+correctAngle);ctx.strokeStyle=green;ctx.stroke();
  ctx.beginPath();ctx.arc(cx,cy,radius,start+correctAngle+.035,start+Math.PI*2);ctx.strokeStyle=red;ctx.stroke();

  ctx.fillStyle=cssColor("--text","#f4f7fb");
  ctx.font='700 24px Inter, "Segoe UI", Arial';
  ctx.textAlign="center";ctx.fillText(Math.round(correct/total*100)+"%",cx,cy+3);
  ctx.fillStyle=cssColor("--muted","#8e9eb4");
  ctx.font='11px Inter, "Segoe UI", Arial';ctx.fillText("aproveitamento",cx,cy+23);

  const legend=$("accuracyLegend");
  if(legend)legend.innerHTML=`<span><i class="legend-dot success-dot"></i>${correct} acertos</span><span><i class="legend-dot error-dot"></i>${wrong} erros</span>`;
}

function drawQuestionsBars(history){
  const chart=chartContext($("questionsBarChart"));
  if(!chart)return;
  const {ctx,width,height}=chart;
  const ordered=history.slice().sort((a,b)=>String(a.finishedAt||"").localeCompare(String(b.finishedAt||""))).slice(-8);
  if(!ordered.length){drawEmptyChart(ctx,width,height);return}
  ctx.clearRect(0,0,width,height);
  const values=ordered.map(h=>Number(h.total)||0);
  const max=Math.max(...values,1);
  const pad={left:18,right:12,top:15,bottom:28};
  const plotH=height-pad.top-pad.bottom;
  const gap=10;
  const barW=(width-pad.left-pad.right-gap*(values.length-1))/values.length;
  const blue=cssColor("--blue","#2f7df4");
  const muted=cssColor("--muted","#8e9eb4");

  values.forEach((value,index)=>{
    const h=(value/max)*plotH;
    const x=pad.left+index*(barW+gap);
    const y=pad.top+plotH-h;
    const grad=ctx.createLinearGradient(0,y,0,y+h);
    grad.addColorStop(0,"rgba(96,165,250,1)");
    grad.addColorStop(1,blue);
    roundedRect(ctx,x,y,barW,h,5);
    ctx.fillStyle=grad;ctx.fill();
    ctx.fillStyle=muted;ctx.font='9px Inter, "Segoe UI", Arial';ctx.textAlign="center";
    ctx.fillText(String(index+1),x+barW/2,height-10);
  });
}

function renderCategoryPerformance(history){
  const host=$("categoryPerformance");
  if(!host)return;
  const map=new Map();
  history.forEach(record=>{
    (record.reviewData||[]).forEach(item=>{
      const category=String(item?.q?.categoria||"Sem categoria");
      const entry=map.get(category)||{total:0,correct:0};
      entry.total++;if(item.ok)entry.correct++;
      map.set(category,entry);
    });
  });
  const rows=[...map.entries()]
    .map(([name,data])=>({name,...data,pct:data.total?Math.round(data.correct/data.total*100):0}))
    .sort((a,b)=>b.total-a.total)
    .slice(0,8);

  if(!rows.length){
    host.innerHTML='<div class="empty-state">Finalize simulados para gerar o desempenho por categoria.</div>';
    return;
  }

  host.innerHTML=rows.map(row=>`
    <div class="category-performance-row">
      <div class="category-performance-label"><strong>${esc(row.name)}</strong><span>${row.correct}/${row.total} · ${row.pct}%</span></div>
      <div class="category-performance-track"><i style="width:${row.pct}%"></i></div>
    </div>`).join("");
}

async function renderAnalyticsDashboard(historyInput){
  if(!$("analyticsDashboard"))return;
  const history=historyInput||await getAll("history");
  drawLearningCurve(history);
  drawAccuracyDonut(history);
  drawQuestionsBars(history);
  renderCategoryPerformance(history);

  const total=history.reduce((sum,h)=>sum+(Number(h.total)||0),0);
  const seconds=history.reduce((sum,h)=>sum+(Number(h.time)||0),0);
  const average=total?Math.round(seconds/total):0;
  const avgEl=$("averageQuestionTime");
  if(avgEl)avgEl.textContent=average>=60?`${Math.floor(average/60)}m ${average%60}s`:`${average}s`;

  const mini=$("studySummaryMini");
  if(mini){
    const best=history.length?Math.max(...history.map(h=>Number(h.score)||0)):0;
    const last=history.slice().sort((a,b)=>String(b.finishedAt||"").localeCompare(String(a.finishedAt||"")))[0];
    mini.innerHTML=`
      <div><span>Melhor resultado</span><strong>${best}%</strong></div>
      <div><span>Último resultado</span><strong>${last?last.score+"%":"—"}</strong></div>
      <div><span>Simulados concluídos</span><strong>${history.length}</strong></div>`;
  }
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

    const answered=Object.values(pr.answers||{}).filter(storedAnswerHasValue).length;
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
    el.innerHTML=`<div><h3>${esc(bank.name)}</h3><p>${bank.questions.length} questões · importado em ${new Date(bank.createdAt).toLocaleDateString("pt-BR")}</p></div><div class="bank-actions"><button class="btn primary compact-play-btn" data-open aria-label="Abrir banco" title="Abrir banco"><span aria-hidden="true">▶</span></button><div class="action-menu"><button class="action-menu-trigger" data-menu type="button" aria-label="Mais opções" title="Mais opções" aria-expanded="false"><span></span><span></span><span></span></button><div class="action-menu-popover hidden"><button type="button" data-menu-open><span>▶</span>Abrir</button><button type="button" data-manage><span>✎</span>Gerenciar</button><button type="button" class="danger-item" data-delete><span>⌫</span>Excluir banco</button></div></div></div>`;
    el.querySelector("[data-open]").onclick=()=>showSetup(bank.id);
    el.querySelector("[data-menu-open]").onclick=()=>showSetup(bank.id);
    el.querySelector("[data-manage]").onclick=()=>openBankManager(bank.id);
    const menuTrigger=el.querySelector("[data-menu]");
    menuTrigger.onclick=event=>{event.stopPropagation();toggleActionMenu(menuTrigger)};
    el.querySelector("[data-delete]").onclick=async()=>{
      if(!confirm(`Excluir definitivamente "${bank.name}"?\n\nSerão removidos o banco, o progresso, os históricos e as imagens associados, neste dispositivo e na nuvem.`))return;
      const button=el.querySelector("[data-delete]");
      button.disabled=true;
      button.textContent="Excluindo...";
      try{
        if(getCloudUser())await deleteCloudBank(bank);
        await del("banks",bank.id);
        await del("progress",bank.id);
        const localHistory=await getAll("history");
        for(const item of localHistory.filter(history=>history.bankId===bank.id))await del("history",item.id);
        markCloudDirty("banco excluído definitivamente");
        await refreshHome();
        toast("Banco excluído deste dispositivo e da nuvem.");
      }catch(error){
        console.error("Falha ao excluir banco",error);
        alert("Não foi possível excluir o banco da nuvem. Nenhum dado local foi removido. Tente novamente conectado à internet.\n\n"+(error.message||error));
        button.disabled=false;
        button.textContent="Excluir";
      }
    };
    list.appendChild(el);
  }
}

function closeAllActionMenus(except=null){
  document.querySelectorAll(".action-menu-popover").forEach(menu=>{
    if(menu===except)return;
    menu.classList.add("hidden");
    (menu._actionMenuTrigger||menu.closest(".action-menu")?.querySelector(".action-menu-trigger"))?.setAttribute("aria-expanded","false");
  });
}

function toggleActionMenu(trigger){
  let menu=trigger._actionMenuPopover||trigger.closest(".action-menu").querySelector(".action-menu-popover");
  const opening=menu.classList.contains("hidden");
  closeAllActionMenus(menu);
  menu.removeAttribute("style");
  if(opening&&trigger.closest(".bank-manager-question")){
    const rect=trigger.getBoundingClientRect(),openAbove=window.innerHeight-rect.bottom<175;
    trigger._actionMenuPopover=menu;menu._actionMenuTrigger=trigger;menu.classList.add("action-menu-portal");document.body.appendChild(menu);
    menu.style.position="fixed";
    menu.style.right=`${Math.max(8,window.innerWidth-rect.right)}px`;
    if(openAbove)menu.style.bottom=`${Math.max(8,window.innerHeight-rect.top+6)}px`;
    else menu.style.top=`${rect.bottom+6}px`;
  }
  menu.classList.toggle("hidden",!opening);
  trigger.setAttribute("aria-expanded",String(opening));
}

async function openBankManager(bankId){
  const bank=await get("banks",bankId);
  if(!bank)return alert("Este banco não foi encontrado.");
  managedBankId=bank.id;
  $("bankManagerTitle").textContent=`Questões de ${bank.name}`;
  $("bankManagerName").value=bank.name||"";
  $("bankManagerSearch").value="";
  $("bankManagerModal").classList.remove("hidden");
  $("bankManagerModal").setAttribute("aria-hidden","false");
  renderBankManagerQuestions();
  window.setTimeout(()=>$("bankManagerSearch").focus(),80);
}

function closeBankManager(){
  managedBankId="";
  $("bankManagerModal").classList.add("hidden");
  $("bankManagerModal").setAttribute("aria-hidden","true");
}

function questionKindLabel(question){
  return question.tipo==="dragdrop"?"Drag-and-drop":question.tipo==="multiple"?"Múltipla escolha":"Escolha única";
}

async function renderBankManagerQuestions(){
  if(!managedBankId)return;
  document.querySelectorAll("body>.action-menu-portal").forEach(menu=>menu.remove());
  const bank=await get("banks",managedBankId);
  if(!bank){closeBankManager();return}
  const query=$("bankManagerSearch").value.trim().toLocaleLowerCase("pt-BR");
  const all=Array.isArray(bank.questions)?bank.questions:[];
  const visible=all.filter(question=>!query||[question.id,question.categoria,question.pergunta,questionKindLabel(question)]
    .some(value=>String(value||"").toLocaleLowerCase("pt-BR").includes(query)));
  $("bankManagerCount").textContent=query?`${visible.length} de ${all.length} questões`:`${all.length} ${all.length===1?"questão":"questões"}`;
  const list=$("bankManagerQuestionList");
  list.innerHTML="";
  if(!visible.length){list.innerHTML='<div class="empty-state">Nenhuma questão encontrada.</div>';return}
  visible.forEach((question,index)=>{
    const row=document.createElement("article");
    row.className="bank-manager-question";
    const originalPosition=all.indexOf(question)+1;
    row.innerHTML=`<div class="bank-manager-question-index">${originalPosition}</div><div class="bank-manager-question-copy"><div class="bank-manager-question-tags"><span>ID ${esc(question.id||"—")}</span><span>${esc(question.categoria||"Sem categoria")}</span><span>${esc(questionKindLabel(question))}</span></div><strong>${esc(question.pergunta||"Questão sem enunciado")}</strong></div><div class="action-menu question-action-menu"><button class="action-menu-trigger" type="button" aria-label="Opções da questão ${esc(question.id||originalPosition)}" aria-expanded="false"><span></span><span></span><span></span></button><div class="action-menu-popover hidden"><button type="button" data-edit><span>✎</span>Editar questão</button><button type="button" data-preview><span>◉</span>Visualizar completa</button><button type="button" class="danger-item" data-delete-question><span>⌫</span>Excluir questão</button></div></div>`;
    const trigger=row.querySelector(".action-menu-trigger");
    trigger.onclick=event=>{event.stopPropagation();toggleActionMenu(trigger)};
    row.querySelector("[data-edit]").onclick=()=>editManagedQuestion(bank.id,String(question.id));
    row.querySelector("[data-preview]").onclick=()=>previewManagedQuestion(bank.id,String(question.id));
    row.querySelector("[data-delete-question]").onclick=()=>deleteManagedQuestion(String(question.id),row);
    list.appendChild(row);
  });
}

async function saveManagedBankName(){
  const bank=await get("banks",managedBankId),name=$("bankManagerName").value.trim();
  if(!bank)return;
  if(!name)return alert("Informe um nome para o banco.");
  bank.name=name;bank.updatedAt=new Date().toISOString();
  await put("banks",bank);
  markCloudDirty("nome do banco alterado");
  if(getCloudUser())try{await ensureCloudBank(bank)}catch(error){console.error("Sincronização do nome pendente",error)}
  $("bankManagerTitle").textContent=`Questões de ${name}`;
  await refreshHome();
  managedBankId=bank.id;
  toast("Nome do banco atualizado.");
}

function questionImageReferences(question){
  const refs=[question.imagem_pergunta,...LETTERS.map(letter=>question[`img_${letter}`])];
  if(question.dragdrop)refs.push(question.dragdrop.image,question.dragdrop.promptImage);
  return refs.map(value=>String(value||"").trim()).filter(Boolean);
}

function imageReferenceMatches(storedName,reference){
  const stored=imagePathVariants(storedName),wanted=imagePathVariants(reference);
  return [...stored].some(value=>wanted.has(value));
}

async function deleteManagedQuestion(questionId,row){
  const bank=await get("banks",managedBankId);
  if(!bank)return;
  const question=(bank.questions||[]).find(item=>String(item.id)===questionId);
  if(!question)return renderBankManagerQuestions();
  const preview=String(question.pergunta||"").replace(/\s+/g," ").trim().slice(0,120);
  if(!confirm(`Excluir somente a questão ${question.id}?\n\n${preview}${String(question.pergunta||"").length>120?"…":""}\n\nAs outras questões e o histórico de simulados serão preservados.`))return;
  const button=row.querySelector("[data-delete-question]");
  button.disabled=true;button.textContent="Excluindo...";
  const removedReferences=questionImageReferences(question);
  bank.questions=(bank.questions||[]).filter(item=>String(item.id)!==questionId);
  const remainingReferences=bank.questions.flatMap(questionImageReferences);
  bank.images=Object.fromEntries(Object.entries(bank.images||{}).filter(([storedName])=>{
    const belongedToRemoved=removedReferences.some(reference=>imageReferenceMatches(storedName,reference));
    const stillUsed=remainingReferences.some(reference=>imageReferenceMatches(storedName,reference));
    return !belongedToRemoved||stillUsed;
  }));
  bank.updatedAt=new Date().toISOString();
  await put("banks",bank);
  await del("questionData",`${bank.id}::${question.id}`);

  const progress=await get("progress",bank.id);
  if(progress){
    const validIds=new Set(bank.questions.map(item=>String(item.id)));
    progress.order=(progress.order||[]).filter(id=>validIds.has(String(id)));
    progress.answers=Object.fromEntries(Object.entries(progress.answers||{}).filter(([id])=>validIds.has(String(id))));
    progress.favorites=(progress.favorites||[]).filter(id=>validIds.has(String(id)));
    progress.marked=(progress.marked||[]).filter(id=>validIds.has(String(id)));
    progress.notes=Object.fromEntries(Object.entries(progress.notes||{}).filter(([id])=>validIds.has(String(id))));
    progress.currentIndex=Math.min(Number(progress.currentIndex)||0,Math.max(0,progress.order.length-1));
    progress.settings={...(progress.settings||{}),__bankSignature:questionsSignature(bank.questions)};
    progress.settings.__answerAudit=Array.isArray(progress.settings.__answerAudit)
      ?progress.settings.__answerAudit.filter(item=>String(item.questionId)!==questionId):[];
    progress.savedAt=new Date().toISOString();
    await put("progress",progress);
  }

  markCloudDirty("questão excluída do banco");
  if(getCloudUser())try{
    await ensureCloudBank(bank);
    if(progress)await pushProgress(bank,progress);
  }catch(error){console.error("Sincronização da exclusão pendente",error)}
  banks=banks.map(item=>item.id===bank.id?bank:item);
  renderBanks();
  populateCommonQuestionBankSelect();
  populateDragDropBankSelect();
  managedBankId=bank.id;
  $("bankManagerTitle").textContent=`Questões de ${bank.name}`;
  await renderBankManagerQuestions();
  toast(`Questão ${question.id} excluída. As demais foram preservadas.`);
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

function populateCommonQuestionBankSelect(){
  const select=$("commonQuestionBankSelect");
  if(!select)return;
  const current=select.value;
  select.innerHTML=banks.map(bank=>`<option value="${esc(bank.id)}">${esc(bank.name)} (${bank.questions?.length||0})</option>`).join("")
    +'<option value="__new__">＋ Criar um banco novo</option>';
  if(banks.some(bank=>bank.id===current))select.value=current;
  else if(!banks.length)select.value="__new__";
  updateCommonQuestionBankMode();
}

function updateCommonQuestionBankMode(){
  const creating=$("commonQuestionBankSelect")?.value==="__new__";
  $("commonQuestionNewBankField")?.classList.toggle("hidden",!creating);
}

function openCommonQuestionBuilder(){
  editingQuestion=null;
  populateCommonQuestionBankSelect();
  $("commonQuestionBankSelect").disabled=false;
  $("commonQuestionBuilderTitle").textContent="Nova questão comum";
  $("saveCommonQuestionBtn").textContent="Salvar questão";
  $("commonQuestionNewBankName").value="";
  resetCommonQuestionFields();
  $("commonQuestionBuilderModal").classList.remove("hidden");
  $("commonQuestionBuilderModal").setAttribute("aria-hidden","false");
}

function resetCommonQuestionFields(){
  commonQuestionBuilder={questionImageData:"",questionImageName:"",alternatives:{}};
  $("commonQuestionType").value="single";
  $("commonQuestionId").value="";
  $("commonQuestionCategory").value="";
  $("commonQuestionText").value="";
  $("commonQuestionFeedback").value="";
  $("commonQuestionImageFile").value="";
  $("commonQuestionImageStatus").textContent="Ex.: exhibit, topologia, comando ou diagrama apresentado na questão.";
  for(const letter of LETTERS){
    const upper=letter.toUpperCase();
    $("commonAltText"+upper).value="";
    $("commonAltImage"+upper).value="";
    $("commonAltImageStatus"+upper).textContent="";
  }
  document.querySelectorAll('input[name="commonCorrect"]').forEach(input=>input.checked=false);
  updateCommonQuestionType();
}

function closeCommonQuestionBuilder(){
  $("commonQuestionBuilderModal").classList.add("hidden");
  $("commonQuestionBuilderModal").setAttribute("aria-hidden","true");
  if(editingQuestion?.type==="common"){
    const bankId=editingQuestion.bankId;editingQuestion=null;
    $("commonQuestionBankSelect").disabled=false;
    openBankManager(bankId);
  }
}

function updateCommonQuestionType(){
  const multiple=$("commonQuestionType").value==="multiple";
  const inputs=[...document.querySelectorAll('input[name="commonCorrect"]')];
  const selected=inputs.filter(input=>input.checked).map(input=>input.value);
  inputs.forEach(input=>{input.type=multiple?"checkbox":"radio";input.checked=false});
  if(multiple)inputs.forEach(input=>input.checked=selected.includes(input.value));
  else if(selected.length){const first=inputs.find(input=>input.value===selected[0]);if(first)first.checked=true}
  $("commonCorrectHint").textContent=multiple?"Marque duas ou mais respostas corretas.":"Marque uma resposta correta.";
}

async function loadCommonQuestionImage(){
  const file=$("commonQuestionImageFile").files[0];
  if(!file){commonQuestionBuilder.questionImageData="";commonQuestionBuilder.questionImageName="";return}
  commonQuestionBuilder.questionImageData=await fileToDataURL(file);
  commonQuestionBuilder.questionImageName=`manual-enunciado-${Date.now()}-${normPath(file.name).split("/").pop()}`;
  $("commonQuestionImageStatus").textContent=`Nova imagem selecionada: ${file.name}`;
}

function clearCommonQuestionImage(){
  $("commonQuestionImageFile").value="";
  commonQuestionBuilder.questionImageData="";
  commonQuestionBuilder.questionImageName="";
  $("commonQuestionImageStatus").textContent="Sem imagem no enunciado. A alteração será aplicada ao atualizar a questão.";
  toast("Imagem do enunciado removida.");
}

async function loadCommonAlternativeImage(letter){
  const upper=letter.toUpperCase(),file=$("commonAltImage"+upper).files[0];
  if(!file){delete commonQuestionBuilder.alternatives[letter];$("commonAltImageStatus"+upper).textContent="";return}
  commonQuestionBuilder.alternatives[letter]={
    imageData:await fileToDataURL(file),
    imageName:`manual-alternativa-${upper}-${Date.now()}-${normPath(file.name).split("/").pop()}`
  };
  $("commonAltImageStatus"+upper).textContent=`Imagem selecionada: ${file.name}`;
}

function clearCommonAlternativeImage(letter){
  const upper=letter.toUpperCase();
  $("commonAltImage"+upper).value="";
  $("commonAltImageStatus"+upper).textContent="";
  delete commonQuestionBuilder.alternatives[letter];
  toast(`Imagem da alternativa ${upper} removida.`);
}

async function saveCommonQuestion(){
  const bankId=$("commonQuestionBankSelect").value;
  let bank=bankId==="__new__"?null:await get("banks",bankId);
  if(bankId==="__new__"){
    const bankName=$("commonQuestionNewBankName").value.trim();
    if(!bankName)return alert("Informe o nome do novo banco.");
    bank=makeBank(bankName,[],{});
  }
  if(!bank)return alert("Selecione um banco válido.");

  const id=$("commonQuestionId").value.trim();
  const questionText=$("commonQuestionText").value.trim();
  const type=$("commonQuestionType").value;
  if(!id)return alert("Informe um ID para a questão.");
  const editing=editingQuestion?.type==="common"&&editingQuestion.bankId===bank.id;
  if((bank.questions||[]).some(question=>String(question.id)===id&&(!editing||String(question.id)!==editingQuestion.originalId)))return alert(`Já existe uma questão com o ID ${id}.`);
  if(!questionText)return alert("Digite o enunciado da questão.");

  const usedLetters=LETTERS.filter(letter=>{
    const upper=letter.toUpperCase();
    return Boolean($("commonAltText"+upper).value.trim()||commonQuestionBuilder.alternatives[letter]?.imageData);
  });
  if(usedLetters.length<2)return alert("Preencha pelo menos duas alternativas com texto ou imagem.");
  const correct=[...document.querySelectorAll('input[name="commonCorrect"]:checked')].map(input=>input.value);
  if(correct.some(letter=>!usedLetters.includes(letter.toLowerCase())))return alert("Uma resposta marcada como correta não possui texto nem imagem.");
  if(type==="single"&&correct.length!==1)return alert("Na escolha única, marque exatamente uma resposta correta.");
  if(type==="multiple"&&correct.length<2)return alert("Na múltipla escolha, marque pelo menos duas respostas corretas.");

  const questionImageKey=commonQuestionBuilder.questionImageData?normPath(commonQuestionBuilder.questionImageName):"";
  const question={
    id,categoria:$("commonQuestionCategory").value.trim(),tipo:type,pergunta:questionText,
    imagem_pergunta:questionImageKey,correta:correct.join(","),feedback:$("commonQuestionFeedback").value.trim()
  };
  const newImages={};
  if(questionImageKey)newImages[questionImageKey]=commonQuestionBuilder.questionImageData;
  for(const letter of LETTERS){
    const upper=letter.toUpperCase(),image=commonQuestionBuilder.alternatives[letter];
    question[`alt_${letter}`]=$("commonAltText"+upper).value.trim();
    question[`img_${letter}`]=image?.imageData?normPath(image.imageName):"";
    if(question[`img_${letter}`])newImages[question[`img_${letter}`]]=image.imageData;
  }

  const oldQuestion=editing?(bank.questions||[]).find(item=>String(item.id)===editingQuestion.originalId):null;
  bank.questions=editing?(bank.questions||[]).map(item=>String(item.id)===editingQuestion.originalId?question:item):[...(bank.questions||[]),question];
  bank.images={...(bank.images||{}),...newImages};
  if(oldQuestion)pruneUnusedQuestionImages(bank,oldQuestion);
  bank.updatedAt=new Date().toISOString();
  await put("banks",bank);
  const cleanedProgress=oldQuestion?await cleanProgressAfterQuestionChange(bank,[oldQuestion.id,question.id]):null;
  markCloudDirty(editing?"questão comum atualizada":"questão comum adicionada");
  if(getCloudUser()){
    try{await ensureCloudBank(bank);if(cleanedProgress)await pushProgress(bank,cleanedProgress)}catch(error){console.error("Sincronização da questão comum pendente",error)}
  }
  await refreshHome();
  if(editing){
    const returnBankId=bank.id;editingQuestion=null;
    $("commonQuestionBuilderModal").classList.add("hidden");
    $("commonQuestionBuilderModal").setAttribute("aria-hidden","true");
    $("commonQuestionBankSelect").disabled=false;
    await openBankManager(returnBankId);
    toast(`Questão ${id} atualizada com sucesso.`);
    return;
  }
  $("commonQuestionBankSelect").value=bank.id;
  updateCommonQuestionBankMode();
  resetCommonQuestionFields();
  toast(`Questão ${id} adicionada. O editor continua aberto para a próxima questão.`);
}

function openQuestionPreview(kind){
  const question=kind==="dragdrop"?buildDragDropPreviewQuestion():buildCommonPreviewQuestion();
  showQuestionPreview(question);
}

function showQuestionPreview(question){
  $("previewCategoryBadge").textContent=question.categoria||"Sem categoria";
  $("previewTypeBadge").textContent=question.tipo==="dragdrop"?"Arrastar e soltar":question.tipo==="multiple"?"Múltiplas respostas":"Resposta única";
  $("previewQuestionText").textContent=question.pergunta||"Digite o enunciado para visualizá-lo aqui.";
  const questionImage=$("previewQuestionImage"),answerArea=$("previewAnswerArea");
  questionImage.innerHTML="";answerArea.innerHTML="";
  if(question.imagem_pergunta)appendPreviewImage(questionImage,question.imagem_pergunta,"Imagem do enunciado");
  if(question.tipo==="dragdrop")renderDragDropPreview(answerArea,question);
  else renderCommonQuestionPreview(answerArea,question);
  const correct=question.tipo==="dragdrop"
    ?question.dragdrop.zones.map((zone,index)=>`${index+1}: ${question.dragdrop.items.find(item=>item.id===zone.correctItemId)?.text||"não definida"}`).join(" · ")
    :normAnswers(question.correta).join(", ")||"Não definida";
  $("previewCorrectAnswer").textContent=`Gabarito: ${correct}`;
  $("previewFeedbackText").textContent=question.feedback||"Nenhum feedback foi informado.";
  $("questionPreviewModal").classList.remove("hidden");
  $("questionPreviewModal").setAttribute("aria-hidden","false");
}

function bankImageData(bank,name){
  if(!name)return"";
  const wanted=imagePathVariants(name),matches=new Map();
  for(const [storedName,data] of Object.entries(bank.images||{})){
    const stored=imagePathVariants(storedName);
    if([...stored].some(value=>wanted.has(value)))matches.set(data,storedName);
  }
  return matches.size===1?matches.keys().next().value:"";
}

function materializeQuestionForPreview(bank,question){
  const copy=structuredClone(question);
  copy.imagem_pergunta=bankImageData(bank,question.imagem_pergunta);
  for(const letter of LETTERS)copy[`img_${letter}`]=bankImageData(bank,question[`img_${letter}`]);
  if(copy.dragdrop){
    copy.dragdrop.image=bankImageData(bank,question.dragdrop.image);
    copy.dragdrop.promptImage=bankImageData(bank,question.dragdrop.promptImage);
  }
  return copy;
}

async function previewManagedQuestion(bankId,questionId){
  closeAllActionMenus();
  const bank=await get("banks",bankId),question=bank?.questions?.find(item=>String(item.id)===questionId);
  if(!bank||!question)return alert("A questão não foi encontrada.");
  showQuestionPreview(materializeQuestionForPreview(bank,question));
}

async function editManagedQuestion(bankId,questionId){
  closeAllActionMenus();
  const bank=await get("banks",bankId),question=bank?.questions?.find(item=>String(item.id)===questionId);
  if(!bank||!question)return alert("A questão não foi encontrada.");
  closeBankManager();
  editingQuestion={bankId,originalId:String(question.id),type:question.tipo==="dragdrop"?"dragdrop":"common"};
  if(question.tipo==="dragdrop")openDragDropQuestionEditor(bank,question);
  else openCommonQuestionEditor(bank,question);
}

function openCommonQuestionEditor(bank,question){
  populateCommonQuestionBankSelect();resetCommonQuestionFields();
  $("commonQuestionBankSelect").value=bank.id;$("commonQuestionBankSelect").disabled=true;
  $("commonQuestionBuilderTitle").textContent=`Editar questão ${question.id}`;
  $("saveCommonQuestionBtn").textContent="Atualizar questão";
  $("commonQuestionType").value=question.tipo==="multiple"?"multiple":"single";
  $("commonQuestionId").value=question.id||"";$("commonQuestionCategory").value=question.categoria||"";
  $("commonQuestionText").value=question.pergunta||"";$("commonQuestionFeedback").value=question.feedback||"";
  commonQuestionBuilder.questionImageName=question.imagem_pergunta||"";
  commonQuestionBuilder.questionImageData=bankImageData(bank,question.imagem_pergunta);
  $("commonQuestionImageStatus").textContent=commonQuestionBuilder.questionImageData
    ?"Imagem atual carregada — clique no X para removê-la.":"Esta questão não possui imagem no enunciado.";
  for(const letter of LETTERS){
    const upper=letter.toUpperCase(),imageName=question[`img_${letter}`]||"",imageData=bankImageData(bank,imageName);
    $("commonAltText"+upper).value=question[`alt_${letter}`]||"";
    if(imageData){commonQuestionBuilder.alternatives[letter]={imageName,imageData};$("commonAltImageStatus"+upper).textContent="Imagem atual mantida"}
  }
  updateCommonQuestionType();
  const correct=new Set(normAnswers(question.correta));
  document.querySelectorAll('input[name="commonCorrect"]').forEach(input=>input.checked=correct.has(input.value));
  $("commonQuestionBuilderModal").classList.remove("hidden");
  $("commonQuestionBuilderModal").setAttribute("aria-hidden","false");
}

function openDragDropQuestionEditor(bank,question){
  populateDragDropBankSelect();resetDragDropQuestionFields();
  $("dragDropBankSelect").value=bank.id;$("dragDropBankSelect").disabled=true;
  $("dragDropBuilderTitle").textContent=`Editar questão ${question.id}`;
  $("saveDragDropQuestionBtn").textContent="Atualizar questão";
  $("dragDropQuestionId").value=question.id||"";$("dragDropCategory").value=question.categoria||"";
  $("dragDropQuestionText").value=question.pergunta||"";$("dragDropFeedback").value=question.feedback||"";
  const definition=question.dragdrop||{};
  dragDropBuilder.imageName=definition.image||"";dragDropBuilder.imageData=bankImageData(bank,definition.image);
  dragDropBuilder.promptImageName=question.imagem_pergunta||definition.promptImage||"";
  dragDropBuilder.promptImageData=bankImageData(bank,dragDropBuilder.promptImageName);
  $("dragDropPromptImageStatus").textContent=dragDropBuilder.promptImageData
    ?"Imagem atual carregada — clique no X para removê-la.":"Esta questão não possui imagem ilustrativa no enunciado.";
  $("dragDropActivityImageStatus").textContent=dragDropBuilder.imageData
    ?"Imagem atual carregada — clique no X para removê-la ou escolha outra.":"A imagem atual não foi encontrada. Selecione outra antes de atualizar.";
  dragDropBuilder.zones=(definition.zones||[]).map(zone=>({...zone}));
  $("dragDropItemsText").value=(definition.items||[]).map(item=>item.text).join("\n");
  if(dragDropBuilder.imageData){
    const image=$("dragDropBuilderImage");
    image.onload=()=>{$("dragDropBuilderEmpty").classList.add("hidden");$("dragDropBuilderStage").classList.remove("hidden");renderDragDropBuilderZones()};
    image.src=dragDropBuilder.imageData;
  }
  renderDragDropBuilderZones();
  $("dragDropBuilderModal").classList.remove("hidden");
  $("dragDropBuilderModal").setAttribute("aria-hidden","false");
}

function pruneUnusedQuestionImages(bank,oldQuestion){
  const removedReferences=questionImageReferences(oldQuestion),remainingReferences=(bank.questions||[]).flatMap(questionImageReferences);
  bank.images=Object.fromEntries(Object.entries(bank.images||{}).filter(([storedName])=>{
    const belongedToOld=removedReferences.some(reference=>imageReferenceMatches(storedName,reference));
    const stillUsed=remainingReferences.some(reference=>imageReferenceMatches(storedName,reference));
    return !belongedToOld||stillUsed;
  }));
}

async function cleanProgressAfterQuestionChange(bank,affectedIds){
  const progress=await get("progress",bank.id);if(!progress)return null;
  const affected=new Set(affectedIds.map(String));
  progress.order=(bank.questions||[]).map(question=>question.id);
  progress.answers=Object.fromEntries(Object.entries(progress.answers||{}).filter(([id])=>!affected.has(String(id))));
  progress.favorites=(progress.favorites||[]).filter(id=>!affected.has(String(id)));
  progress.marked=(progress.marked||[]).filter(id=>!affected.has(String(id)));
  progress.notes=Object.fromEntries(Object.entries(progress.notes||{}).filter(([id])=>!affected.has(String(id))));
  progress.settings={...(progress.settings||{}),__bankSignature:questionsSignature(bank.questions)};
  progress.settings.limit=progress.order.length;
  progress.currentIndex=Math.min(Number(progress.currentIndex)||0,Math.max(0,progress.order.length-1));
  progress.settings.__answerAudit=Array.isArray(progress.settings.__answerAudit)?progress.settings.__answerAudit.filter(item=>!affected.has(String(item.questionId))):[];
  progress.savedAt=new Date().toISOString();await put("progress",progress);
  for(const id of affected)await del("questionData",`${bank.id}::${id}`);
  return progress;
}

function closeQuestionPreview(){
  $("questionPreviewModal").classList.add("hidden");
  $("questionPreviewModal").setAttribute("aria-hidden","true");
}

function buildCommonPreviewQuestion(){
  const question={
    id:$("commonQuestionId").value.trim(),categoria:$("commonQuestionCategory").value.trim(),
    tipo:$("commonQuestionType").value,pergunta:$("commonQuestionText").value.trim(),
    imagem_pergunta:commonQuestionBuilder.questionImageData,
    correta:[...document.querySelectorAll('input[name="commonCorrect"]:checked')].map(input=>input.value).join(","),
    feedback:$("commonQuestionFeedback").value.trim()
  };
  for(const letter of LETTERS){
    const upper=letter.toUpperCase();
    question[`alt_${letter}`]=$("commonAltText"+upper).value.trim();
    question[`img_${letter}`]=commonQuestionBuilder.alternatives[letter]?.imageData||"";
  }
  return question;
}

function buildDragDropPreviewQuestion(){
  return {
    id:$("dragDropQuestionId").value.trim(),categoria:$("dragDropCategory").value.trim(),tipo:"dragdrop",
    pergunta:$("dragDropQuestionText").value.trim(),imagem_pergunta:dragDropBuilder.promptImageData,
    feedback:$("dragDropFeedback").value.trim(),
    dragdrop:{image:dragDropBuilder.imageData,items:dragDropBuilderItems(),zones:dragDropBuilder.zones.map(zone=>({...zone}))}
  };
}

function appendPreviewImage(container,src,alt){
  const wrap=document.createElement("div");wrap.className="preview-image-wrap";
  const image=document.createElement("img");image.src=src;image.alt=alt;
  wrap.appendChild(image);container.appendChild(wrap);
}

function renderCommonQuestionPreview(container,question){
  for(const letter of LETTERS){
    const text=question[`alt_${letter}`],image=question[`img_${letter}`];
    if(!text&&!image)continue;
    const upper=letter.toUpperCase(),label=document.createElement("label");label.className="option preview-option";
    const input=document.createElement("input");input.type=question.tipo==="multiple"?"checkbox":"radio";input.name="previewAnswer";
    input.onchange=()=>container.querySelectorAll(".preview-option").forEach(option=>option.classList.toggle("selected",option.querySelector("input").checked));
    const content=document.createElement("div");content.className="option-content";
    const line=document.createElement("div"),badge=document.createElement("span");badge.className="option-letter";badge.textContent=`${upper})`;
    line.appendChild(badge);line.append(document.createTextNode(text||""));content.appendChild(line);
    if(image)appendPreviewImage(content,image,`Imagem da alternativa ${upper}`);
    label.append(input,content);container.appendChild(label);
  }
  if(!container.children.length){
    const empty=document.createElement("div");empty.className="notice";empty.textContent="Preencha as alternativas para vê-las aqui.";container.appendChild(empty);
  }
}

function renderDragDropPreview(container,question){
  const definition=question.dragdrop,placed={},state={selected:""};
  const render=()=>{
    container.innerHTML="";
    const instruction=document.createElement("div");instruction.className="dragdrop-instruction";
    instruction.textContent="Arraste um cartão ou selecione-o e depois clique na área de destino.";container.appendChild(instruction);
    if(definition.image){
      const stage=document.createElement("div");stage.className="dragdrop-runtime-stage";
      const image=document.createElement("img");image.src=definition.image;image.alt="Atividade drag-and-drop";
      const layer=document.createElement("div");layer.className="dragdrop-runtime-zone-layer";
      definition.zones.forEach(zone=>{
        const target=document.createElement("div");target.className="dragdrop-runtime-zone";
        Object.assign(target.style,{left:`${zone.x}%`,top:`${zone.y}%`,width:`${zone.w}%`,height:`${zone.h}%`});
        const item=definition.items.find(candidate=>candidate.id===placed[zone.id]);
        target.textContent=item?.text||"";target.classList.toggle("filled",Boolean(item));
        target.ondragover=event=>event.preventDefault();
        target.ondrop=event=>{event.preventDefault();const id=event.dataTransfer.getData("text/plain");if(id){placed[zone.id]=id;render()}};
        target.onclick=()=>{if(state.selected){placed[zone.id]=state.selected;state.selected="";render()}};
        if(item){const clear=document.createElement("button");clear.type="button";clear.textContent="×";clear.onclick=event=>{event.stopPropagation();delete placed[zone.id];render()};target.appendChild(clear)}
        layer.appendChild(target);
      });
      stage.append(image,layer);container.appendChild(stage);
    }else{
      const warning=document.createElement("div");warning.className="notice";warning.textContent="Carregue a imagem da atividade para completar a pré-visualização.";container.appendChild(warning);
    }
    const pool=document.createElement("div");pool.className="dragdrop-pool";
    const used=new Set(Object.values(placed));
    definition.items.forEach(item=>{
      const token=document.createElement("button");token.type="button";token.className="dragdrop-token";token.textContent=item.text;
      token.draggable=true;token.classList.toggle("selected",state.selected===item.id);token.classList.toggle("used",used.has(item.id));
      token.ondragstart=event=>event.dataTransfer.setData("text/plain",item.id);
      token.onclick=()=>{state.selected=state.selected===item.id?"":item.id;render()};pool.appendChild(token);
    });
    container.appendChild(pool);
  };
  render();
}

function populateDragDropBankSelect(){
  const select=$("dragDropBankSelect");
  if(!select)return;
  const current=select.value;
  select.innerHTML=banks.map(bank=>`<option value="${esc(bank.id)}">${esc(bank.name)} (${bank.questions?.length||0})</option>`).join("")
    +'<option value="__new__">＋ Criar um banco novo</option>';
  if(banks.some(bank=>bank.id===current))select.value=current;
  else if(!banks.length)select.value="__new__";
  updateDragDropBankMode();
}

function openDragDropBuilder(){
  editingQuestion=null;
  populateDragDropBankSelect();
  $("dragDropBankSelect").disabled=false;
  $("dragDropBuilderTitle").textContent="Nova questão drag-and-drop";
  $("saveDragDropQuestionBtn").textContent="Salvar questão";
  $("dragDropNewBankName").value="";
  resetDragDropQuestionFields();
  $("dragDropBuilderModal").classList.remove("hidden");
  $("dragDropBuilderModal").setAttribute("aria-hidden","false");
}

function resetDragDropQuestionFields(){
  dragDropBuilder={imageData:"",imageName:"",promptImageData:"",promptImageName:"",zones:[]};
  $("dragDropQuestionId").value="";
  $("dragDropCategory").value="";
  $("dragDropQuestionText").value="";
  $("dragDropItemsText").value="";
  $("dragDropFeedback").value="";
  $("dragDropPromptFile").value="";
  $("dragDropBackgroundFile").value="";
  $("dragDropPromptImageStatus").textContent="Ex.: topologia, diagrama ou exhibit exibido antes da atividade.";
  $("dragDropActivityImageStatus").textContent="Use a imagem que contém os espaços onde os cartões serão colocados.";
  $("dragDropBuilderImage").removeAttribute("src");
  $("dragDropBuilderStage").classList.add("hidden");
  $("dragDropBuilderEmpty").classList.remove("hidden");
  renderDragDropBuilderZones();
}

function updateDragDropBankMode(){
  const creating=$("dragDropBankSelect")?.value==="__new__";
  $("dragDropNewBankField")?.classList.toggle("hidden",!creating);
}

function closeDragDropBuilder(){
  $("dragDropBuilderModal").classList.add("hidden");
  $("dragDropBuilderModal").setAttribute("aria-hidden","true");
  if(editingQuestion?.type==="dragdrop"){
    const bankId=editingQuestion.bankId;editingQuestion=null;
    $("dragDropBankSelect").disabled=false;
    openBankManager(bankId);
  }
}

async function loadDragDropBuilderImage(){
  const file=$("dragDropBackgroundFile").files[0];
  if(!file)return;
  dragDropBuilder.zones=[];
  dragDropBuilder.imageData=await fileToDataURL(file);
  dragDropBuilder.imageName=`manual-dragdrop-${Date.now()}-${normPath(file.name).split("/").pop()}`;
  $("dragDropActivityImageStatus").textContent=`Nova imagem selecionada: ${file.name}`;
  const image=$("dragDropBuilderImage");
  image.onload=()=>{
    $("dragDropBuilderEmpty").classList.add("hidden");
    $("dragDropBuilderStage").classList.remove("hidden");
    renderDragDropBuilderZones();
  };
  image.src=dragDropBuilder.imageData;
}

function clearDragDropActivityImage(){
  $("dragDropBackgroundFile").value="";
  dragDropBuilder.imageData="";
  dragDropBuilder.imageName="";
  dragDropBuilder.zones=[];
  $("dragDropBuilderImage").removeAttribute("src");
  $("dragDropBuilderStage").classList.add("hidden");
  $("dragDropBuilderEmpty").classList.remove("hidden");
  $("dragDropActivityImageStatus").textContent="Imagem removida. Selecione outra imagem para poder atualizar a questão.";
  renderDragDropBuilderZones();
  toast("Imagem da atividade e áreas de resposta removidas.");
}

async function loadDragDropPromptImage(){
  const file=$("dragDropPromptFile").files[0];
  if(!file){
    dragDropBuilder.promptImageData="";
    dragDropBuilder.promptImageName="";
    return;
  }
  dragDropBuilder.promptImageData=await fileToDataURL(file);
  dragDropBuilder.promptImageName=`manual-dragdrop-enunciado-${Date.now()}-${normPath(file.name).split("/").pop()}`;
  $("dragDropPromptImageStatus").textContent=`Nova imagem selecionada: ${file.name}`;
}

function clearDragDropPromptImage(){
  $("dragDropPromptFile").value="";
  dragDropBuilder.promptImageData="";
  dragDropBuilder.promptImageName="";
  $("dragDropPromptImageStatus").textContent="Sem imagem ilustrativa. A alteração será aplicada ao atualizar a questão.";
  toast("Imagem ilustrativa do enunciado removida.");
}

function dragDropBuilderItems(){
  return $("dragDropItemsText").value.split(/\r?\n/)
    .map(text=>text.trim()).filter(Boolean)
    .map((text,index)=>({id:`item-${index+1}`,text}));
}

function addDragDropBuilderZone(){
  if(!dragDropBuilder.imageData){alert("Carregue primeiro a imagem da atividade drag-and-drop.");return}
  const index=dragDropBuilder.zones.length;
  dragDropBuilder.zones.push({
    id:`zone-${crypto.randomUUID()}`,
    x:Math.min(72,12+(index%4)*7),y:Math.min(82,18+index*11),w:18,h:7,correctItemId:""
  });
  renderDragDropBuilderZones();
}

function renderDragDropBuilderZones(){
  const layer=$("dragDropZoneLayer"),summary=$("dragDropZoneSummary");
  if(!layer||!summary)return;
  layer.innerHTML="";summary.innerHTML="";
  const items=dragDropBuilderItems();

  dragDropBuilder.zones.forEach(zone=>{
    if(!items.some(item=>item.id===zone.correctItemId))zone.correctItemId="";
    const el=document.createElement("div");
    el.className="builder-zone";
    el.dataset.zoneId=zone.id;
    Object.assign(el.style,{left:`${zone.x}%`,top:`${zone.y}%`,width:`${zone.w}%`,height:`${zone.h}%`});
    layer.appendChild(el);
    enableBuilderZoneMove(el,zone);
    const observer=new ResizeObserver(()=>syncBuilderZoneGeometry(el,zone));
    observer.observe(el);
  });
  renderDragDropBuilderSummary();
}

function renderDragDropBuilderSummary(){
  const summary=$("dragDropZoneSummary"),items=dragDropBuilderItems();
  summary.innerHTML="";
  dragDropBuilder.zones.forEach((zone,index)=>{
    const row=document.createElement("div");row.className="builder-zone-row";
    const label=document.createElement("strong");label.textContent=`Área de resposta ${index+1}`;
    const select=document.createElement("select");
    select.innerHTML='<option value="">Selecione o cartão correto...</option>'+items.map(item=>`<option value="${esc(item.id)}">${esc(item.text)}</option>`).join("");
    select.value=zone.correctItemId;
    select.onchange=()=>{zone.correctItemId=select.value};
    const remove=document.createElement("button");remove.type="button";remove.textContent="Remover";
    remove.onclick=()=>{dragDropBuilder.zones=dragDropBuilder.zones.filter(item=>item.id!==zone.id);renderDragDropBuilderZones()};
    row.append(label,select,remove);summary.appendChild(row);
  });
}

function syncBuilderZoneGeometry(el,zone){
  const layer=$("dragDropZoneLayer"),bounds=layer.getBoundingClientRect(),rect=el.getBoundingClientRect();
  if(!bounds.width||!bounds.height)return;
  zone.x=Math.max(0,Math.min(100,(rect.left-bounds.left)/bounds.width*100));
  zone.y=Math.max(0,Math.min(100,(rect.top-bounds.top)/bounds.height*100));
  zone.w=Math.max(3,Math.min(100-zone.x,rect.width/bounds.width*100));
  zone.h=Math.max(3,Math.min(100-zone.y,rect.height/bounds.height*100));
}

function enableBuilderZoneMove(el,zone){
  el.onpointerdown=event=>{
    if(event.target.closest("select")||event.offsetX>el.clientWidth-18&&event.offsetY>el.clientHeight-18)return;
    event.preventDefault();el.setPointerCapture(event.pointerId);
    const layer=$("dragDropZoneLayer"),bounds=layer.getBoundingClientRect();
    const start={x:event.clientX,y:event.clientY,left:zone.x,top:zone.y};
    el.onpointermove=move=>{
      const x=start.left+(move.clientX-start.x)/bounds.width*100;
      const y=start.top+(move.clientY-start.y)/bounds.height*100;
      zone.x=Math.max(0,Math.min(100-zone.w,x));zone.y=Math.max(0,Math.min(100-zone.h,y));
      el.style.left=`${zone.x}%`;el.style.top=`${zone.y}%`;
    };
    el.onpointerup=()=>{el.onpointermove=null;syncBuilderZoneGeometry(el,zone)};
  };
}

async function saveDragDropQuestion(){
  const bankId=$("dragDropBankSelect").value;
  let bank=bankId==="__new__"?null:await get("banks",bankId);
  const id=$("dragDropQuestionId").value.trim();
  const questionText=$("dragDropQuestionText").value.trim();
  const items=dragDropBuilderItems();
  if(bankId==="__new__"){
    const bankName=$("dragDropNewBankName").value.trim();
    if(!bankName)return alert("Informe o nome do novo banco.");
    bank=makeBank(bankName,[],{});
  }
  if(!bank)return alert("Selecione um banco válido.");
  if(!id)return alert("Informe um ID para a questão.");
  const editing=editingQuestion?.type==="dragdrop"&&editingQuestion.bankId===bank.id;
  if(bank.questions.some(question=>String(question.id)===id&&(!editing||String(question.id)!==editingQuestion.originalId)))return alert(`Já existe uma questão com o ID ${id}.`);
  if(!questionText)return alert("Digite o enunciado da questão.");
  if(!dragDropBuilder.imageData)return alert("Carregue a imagem da atividade drag-and-drop.");
  if(items.length<2)return alert("Cadastre pelo menos dois cartões.");
  if(!dragDropBuilder.zones.length)return alert("Adicione pelo menos uma caixa de destino.");
  if(dragDropBuilder.zones.some(zone=>!zone.correctItemId))return alert("Defina a resposta correta de todas as caixas.");

  const imageKey=normPath(dragDropBuilder.imageName);
  const promptImageKey=dragDropBuilder.promptImageData?normPath(dragDropBuilder.promptImageName):"";
  const question={
    id,categoria:$("dragDropCategory").value.trim(),tipo:"dragdrop",pergunta:questionText,
    imagem_pergunta:promptImageKey,correta:"",feedback:$("dragDropFeedback").value.trim(),
    dragdrop:{version:2,image:imageKey,promptImage:promptImageKey,items,zones:dragDropBuilder.zones.map(zone=>({...zone}))}
  };
  const oldQuestion=editing?(bank.questions||[]).find(item=>String(item.id)===editingQuestion.originalId):null;
  bank.questions=editing?(bank.questions||[]).map(item=>String(item.id)===editingQuestion.originalId?question:item):[...(bank.questions||[]),question];
  bank.images={...(bank.images||{}),[imageKey]:dragDropBuilder.imageData};
  if(promptImageKey)bank.images[promptImageKey]=dragDropBuilder.promptImageData;
  if(oldQuestion)pruneUnusedQuestionImages(bank,oldQuestion);
  bank.updatedAt=new Date().toISOString();
  await put("banks",bank);
  const cleanedProgress=oldQuestion?await cleanProgressAfterQuestionChange(bank,[oldQuestion.id,question.id]):null;
  markCloudDirty(editing?"questão drag-and-drop atualizada":"questão drag-and-drop adicionada");
  if(getCloudUser()){
    try{await ensureCloudBank(bank);if(cleanedProgress)await pushProgress(bank,cleanedProgress)}catch(error){console.error("Sincronização da questão drag-and-drop pendente",error)}
  }
  await refreshHome();
  if(editing){
    const returnBankId=bank.id;editingQuestion=null;
    $("dragDropBuilderModal").classList.add("hidden");
    $("dragDropBuilderModal").setAttribute("aria-hidden","true");
    $("dragDropBankSelect").disabled=false;
    await openBankManager(returnBankId);
    toast(`Questão ${id} atualizada com sucesso.`);
    return;
  }
  $("dragDropBankSelect").value=bank.id;
  updateDragDropBankMode();
  resetDragDropQuestionFields();
  toast(`Questão ${id} adicionada. O editor continua aberto para a próxima questão.`);
}

async function importBank(){
  try{
    showLoading(true,"Importando banco...");
    let bank;
    if($("zipFile").files[0])bank=await importZip($("zipFile").files[0]);
    else bank=await importCsvAndImages();

    // Reimportar o mesmo banco serve para restaurar/adicionar imagens sem
    // criar uma cópia e sem romper o vínculo com o progresso existente.
    const currentBanks=await getAll("banks");
    const existing=currentBanks.find(item=>sameBankContent(item,bank));
    if(existing){
      bank={...bank,id:existing.id,createdAt:existing.createdAt,
        images:{...(existing.images||{}),...(bank.images||{})}};
    }
    await put("banks",bank);
    markCloudDirty(existing?"imagens ou banco atualizado":"banco importado");
    if(getCloudUser()){
      try{await ensureCloudBank(bank)}catch(error){console.error("Falha ao registrar banco na nuvem",error)}
    }
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

function sameBankContent(a,b){
  const aq=Array.isArray(a?.questions)?a.questions:[];
  const bq=Array.isArray(b?.questions)?b.questions:[];
  if(!aq.length||aq.length!==bq.length)return false;
  return aq.every((q,index)=>String(q.id||"")===String(bq[index]?.id||"")
    &&String(q.pergunta||"").trim()===String(bq[index]?.pergunta||"").trim());
}

async function importCsvAndImages(){
  const csv=$("csvFile").files[0];
  if(!csv)throw new Error("Selecione um CSV ou ZIP.");

  const qs=await parseCsv(csv);
  const images={};
  const basenameOwners=new Map();

  for(const f of $("imageFolder").files){
    if(!/\.(png|jpe?g|gif|webp|svg)$/i.test(f.name))continue;
    const sourcePath=normPath(f.webkitRelativePath||f.name);
    registerImportedImage(images,sourcePath,await fileToDataURL(f),basenameOwners);
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
  const basenameOwners=new Map();

  for(const e of entries){
    if(e.dir||e===csvEntry)continue;
    if(/\.(png|jpe?g|gif|webp|svg)$/i.test(e.name)){
      const blob=await e.async("blob");
      const data=await blobToDataURL(blob);
      registerImportedImage(images,e.name,data,basenameOwners);
    }
  }

  return makeBank($("bankName").value||file.name.replace(/\.zip$/i,""),qs,images);
}

function makeBank(name,qs,images){
  return{id:crypto.randomUUID(),name,createdAt:new Date().toISOString(),questions:qs,images};
}

// Mantém sempre o caminho completo. O alias pelo nome simples só é criado
// quando esse basename é único; nomes repetidos em subpastas deixam de
// sobrescrever uns aos outros silenciosamente.
function registerImportedImage(images,sourceName,data,basenameOwners){
  const fullName=normPath(sourceName);
  const baseName=fullName.split("/").pop();
  if(!fullName||!baseName)return;

  images[fullName]=data;
  const previous=basenameOwners.get(baseName);
  if(previous===undefined){
    basenameOwners.set(baseName,fullName);
    images[baseName]=data;
  }else if(previous!==fullName){
    basenameOwners.set(baseName,null);
    delete images[baseName];
    console.warn(`Nome de imagem duplicado: ${baseName}. Use o caminho completo no CSV.`);
  }
}

function parseCsv(file){
  return new Promise((res,rej)=>Papa.parse(file,{
    header:true,
    skipEmptyLines:"greedy",
    transformHeader:h=>h.replace(/^\uFEFF/,"").trim().toLowerCase(),
    complete:r=>{try{res(normalizeQuestions(r.data))}catch(error){rej(error)}},
    error:()=>rej(new Error("Erro no CSV"))
  }));
}

function parseCsvText(text){
  return new Promise((res,rej)=>Papa.parse(text,{
    header:true,
    skipEmptyLines:"greedy",
    transformHeader:h=>h.replace(/^\uFEFF/,"").trim().toLowerCase(),
    complete:r=>{try{res(normalizeQuestions(r.data))}catch(error){rej(error)}},
    error:()=>rej(new Error("Erro no CSV"))
  }));
}

function normalizeQuestions(rows){
  const questions=rows.map((q,i)=>{
    const x={};
    for(const[k,v]of Object.entries(q))x[k.trim().toLowerCase()]=typeof v==="string"?v.trim():v;
    x.id=String(x.id||i+1);
    x.tipo=/drag.?drop|arrastar/i.test(x.tipo||"")?"dragdrop":/multiple|multipla|múltipla|multi/i.test(x.tipo||"")?"multiple":"single";
    x.correta=x.tipo==="dragdrop"?x.correta:normAnswers(x.correta);
    return x;
  }).filter(q=>q.pergunta);

  const seen=new Set();
  for(const q of questions){
    if(seen.has(q.id))throw new Error(`O CSV contém ID duplicado: ${q.id}. Cada questão precisa de um ID único.`);
    seen.add(q.id);
    if(q.tipo==="single"&&q.correta.length>1)throw new Error(`A questão ID ${q.id} é single, mas possui mais de uma resposta correta.`);
    if(q.tipo==="multiple"&&q.correta.length<2)throw new Error(`A questão ID ${q.id} é multiple, mas possui menos de duas respostas corretas.`);
  }
  return questions;
}

async function showSetup(id){
  exitQuizMode();
  selectedBank=await get("banks",id);
  if(!selectedBank)return;

  // Em um computador novo, busca o progresso remoto antes de montar a tela.
  if(getCloudUser()){
    try{
      setCloudStatus("Buscando progresso","syncing");
      const local=await get("progress",id);
      const remote=await pullProgress(selectedBank);
      if(remote && shouldUseRemoteProgress(local,remote)){
        await put("progress",remote);
      }else if(local){
        await pushProgress(selectedBank,local);
      }
      setCloudStatus("Nuvem ativa","online");
    }catch(error){
      console.error("Não foi possível buscar o progresso remoto",error);
      setCloudStatus("Sync pendente","offline");
    }
  }

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
  answerAudit=[];
  settings.__bankSignature=questionsSignature(questions);
  settings.__answerAudit=answerAudit;
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
  const expectedSignature=questionsSignature(questions);
  const savedSignature=p.settings?.__bankSignature;
  if(savedSignature&&savedSignature!==expectedSignature){
    alert("Este progresso pertence a outra versão do banco de questões e não será aplicado. Inicie um novo simulado ou restaure a versão original do banco.");
    return;
  }
  const validation=validateSavedAnswers(questions,p.answers||{});
  if(validation.conflicts.length){
    alert(`O progresso contém ${validation.conflicts.length} resposta(s) incompatível(is), incluindo questão single com múltiplas letras. A retomada foi bloqueada para evitar deslocamento ou perda de respostas. Exporte um backup antes de apagar o progresso.`);
    return;
  }
  answers=validation.answers;
  favorites=new Set(p.favorites||[]);
  marked=new Set(p.marked||[]);
  notes=p.notes||{};
  await loadQuestionMetadata();
  currentIndex=p.currentIndex||0;
  timerSeconds=p.timerSeconds||0;
  settings={...(p.settings||{}),__bankSignature:expectedSignature};
  answerAudit=Array.isArray(settings.__answerAudit)?settings.__answerAudit:[];
  settings.__answerAudit=answerAudit;

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
  $("answeredCount").textContent=questions.filter(question=>isQuestionAnswered(question,answers[question.id])).length;
  $("progressBar").style.width=`${(currentIndex+1)/questions.length*100}%`;
  $("questionText").textContent=q.pergunta||"";
  $("categoryBadge").textContent=q.categoria||"";
  $("categoryBadge").classList.toggle("hidden",!q.categoria);
  $("typeBadge").textContent=q.tipo==="dragdrop"?"Arrastar e soltar":q.tipo==="multiple"?"Múltiplas respostas":"Resposta única";
  $("multipleNotice").classList.toggle("hidden",q.tipo!=="multiple");

  updateQuestionActions(q);
  updateLiveCounts();
  renderNavigator();

  const dragDropActivityImage=q.tipo==="dragdrop"?dragDropDefinition(q).image:"";
  if(q.tipo==="dragdrop"&&(!q.imagem_pergunta||q.imagem_pergunta===dragDropActivityImage))$("questionImageWrap").classList.add("hidden");
  else renderImage("questionImageWrap","questionImage",q.imagem_pergunta);
  renderOptions(q);

  $("prevBtn").disabled=currentIndex===0;
  $("nextBtn").textContent=currentIndex===questions.length-1?"Finalizar":"Próxima →";

  saveProgress();
}

function renderOptions(q){
  const c=$("optionsContainer");
  c.innerHTML="";

  if(q.tipo==="dragdrop"){
    renderDragDropQuestion(q,c);
    return;
  }

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

function dragDropDefinition(q){
  const definition=q?.dragdrop&&typeof q.dragdrop==="object"?q.dragdrop:{};
  return {
    image:definition.image||q?.imagem_pergunta||"",
    items:Array.isArray(definition.items)?definition.items.filter(item=>item&&item.id):[],
    zones:Array.isArray(definition.zones)?definition.zones.filter(zone=>zone&&zone.id):[]
  };
}

function normalizeDragDropAnswer(q,value){
  const definition=dragDropDefinition(q),validZones=new Set(definition.zones.map(zone=>zone.id));
  const validItems=new Set(definition.items.map(item=>item.id));
  const source=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  const normalized={};
  for(const [zoneId,itemId] of Object.entries(source)){
    if(validZones.has(zoneId)&&validItems.has(itemId))normalized[zoneId]=itemId;
  }
  return normalized;
}

function expectedDragDropAnswer(q){
  return Object.fromEntries(dragDropDefinition(q).zones
    .filter(zone=>zone.correctItemId)
    .map(zone=>[zone.id,zone.correctItemId]));
}

function dragDropAnswersEqual(q,user){
  const expected=expectedDragDropAnswer(q),actual=normalizeDragDropAnswer(q,user);
  const zones=dragDropDefinition(q).zones.map(zone=>zone.id);
  return zones.length>0&&zones.every(zoneId=>actual[zoneId]===expected[zoneId]);
}

function isQuestionAnswered(q,value){
  if(q?.tipo==="dragdrop")return Object.keys(normalizeDragDropAnswer(q,value)).length>0;
  return Array.isArray(value)&&value.length>0;
}

function storedAnswerHasValue(value){
  return Array.isArray(value)?value.length>0:Boolean(value&&typeof value==="object"&&Object.keys(value).length);
}

function isQuestionComplete(q,value){
  if(q?.tipo==="dragdrop"){
    const answer=normalizeDragDropAnswer(q,value);
    return dragDropDefinition(q).zones.length>0&&dragDropDefinition(q).zones.every(zone=>answer[zone.id]);
  }
  return isQuestionAnswered(q,value);
}

function renderDragDropQuestion(q,container){
  const definition=dragDropDefinition(q),answer=normalizeDragDropAnswer(q,answers[q.id]);
  const root=document.createElement("div");root.className="dragdrop-question";
  const instruction=document.createElement("div");instruction.className="dragdrop-instruction";
  instruction.textContent="Arraste os cartões para as caixas. No celular, toque em um cartão e depois na caixa desejada. Nem todos os cartões precisam ser utilizados.";
  root.appendChild(instruction);

  const imageUrl=resolveImage(definition.image);
  if(imageUrl){
    const stage=document.createElement("div");stage.className="dragdrop-runtime-stage";
    const image=document.createElement("img");image.src=imageUrl;image.alt="Diagrama da questão drag-and-drop";
    image.onclick=event=>{if(event.target===image)openModal(imageUrl)};
    const layer=document.createElement("div");layer.className="dragdrop-runtime-zone-layer";
    definition.zones.forEach(zone=>{
      const target=document.createElement("div");target.className="dragdrop-runtime-zone";
      target.dataset.zoneId=zone.id;
      Object.assign(target.style,{left:`${zone.x}%`,top:`${zone.y}%`,width:`${zone.w}%`,height:`${zone.h}%`});
      const item=definition.items.find(candidate=>candidate.id===answer[zone.id]);
      target.textContent=item?.text||"";
      target.classList.toggle("filled",Boolean(item));
      target.ondragover=event=>{event.preventDefault();target.classList.add("active")};
      target.ondragleave=()=>target.classList.remove("active");
      target.ondrop=event=>{event.preventDefault();assignDragDropItem(q,zone.id,event.dataTransfer.getData("text/plain"))};
      target.onclick=()=>{if(activeDragDropTokenId)assignDragDropItem(q,zone.id,activeDragDropTokenId)};
      if(item){
        const clear=document.createElement("button");clear.type="button";clear.textContent="×";clear.title="Remover cartão";
        clear.onclick=event=>{event.stopPropagation();clearDragDropZone(q,zone.id)};
        target.appendChild(clear);
      }
      layer.appendChild(target);
    });
    stage.append(image,layer);root.appendChild(stage);
  }else{
    const warning=document.createElement("div");warning.className="notice";warning.textContent="A imagem da atividade drag-and-drop não está disponível neste dispositivo.";root.appendChild(warning);
  }

  const pool=document.createElement("div");pool.className="dragdrop-pool";
  const used=new Set(Object.values(answer));
  definition.items.forEach(item=>{
    const token=document.createElement("button");token.type="button";token.className="dragdrop-token";
    token.textContent=item.text;token.draggable=true;token.classList.toggle("used",used.has(item.id));
    token.classList.toggle("selected",activeDragDropTokenId===item.id);
    token.ondragstart=event=>event.dataTransfer.setData("text/plain",item.id);
    token.onclick=()=>{activeDragDropTokenId=activeDragDropTokenId===item.id?"":item.id;renderQuestion()};
    pool.appendChild(token);
  });
  root.appendChild(pool);container.appendChild(root);
}

function assignDragDropItem(q,zoneId,itemId){
  const definition=dragDropDefinition(q);
  if(!definition.items.some(item=>item.id===itemId))return;
  const answer=normalizeDragDropAnswer(q,answers[q.id]);
  for(const [existingZone,existingItem] of Object.entries(answer))if(existingItem===itemId)delete answer[existingZone];
  answer[zoneId]=itemId;answers[q.id]=answer;activeDragDropTokenId="";
  answerAudit.push({at:new Date().toISOString(),questionId:String(q.id),questionSignature:questionSignature(q),selected:{...answer}});
  if(answerAudit.length>5000)answerAudit=answerAudit.slice(-5000);
  settings.__answerAudit=answerAudit;renderQuestion();
}

function clearDragDropZone(q,zoneId){
  const answer=normalizeDragDropAnswer(q,answers[q.id]);delete answer[zoneId];
  if(Object.keys(answer).length)answers[q.id]=answer;else delete answers[q.id];
  renderQuestion();
}

function selectAnswer(q,a){
  let arr=[...(answers[q.id]||[])];

  if(q.tipo==="multiple")arr=arr.includes(a)?arr.filter(x=>x!==a):[...arr,a];
  else arr=[a];

  answers[q.id]=arr.sort();
  answerAudit.push({
    at:new Date().toISOString(),
    questionId:String(q.id),
    questionSignature:questionSignature(q),
    selected:[...answers[q.id]]
  });
  if(answerAudit.length>5000)answerAudit=answerAudit.slice(-5000);
  settings.__answerAudit=answerAudit;
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
  const images=selectedBank?.images||{};
  const variants=imagePathVariants(name);
  for(const key of variants)if(images[key])return images[key];

  // Compatibilidade com ZIPs/pastas que acrescentaram diretórios ao nome.
  // O fallback só é aceito quando o basename identifica uma única imagem.
  // Antes, a primeira correspondência era usada mesmo em caso de ambiguidade.
  const wantedBase=[...variants].map(v=>v.split("/").pop()).find(Boolean);
  const matches=new Map();
  for(const [storedName,url] of Object.entries(images)){
    const storedVariants=imagePathVariants(storedName);
    if([...storedVariants].some(key=>variants.has(key)||key.split("/").pop()===wantedBase)){
      matches.set(url,storedName);
    }
  }
  if(matches.size===1)return matches.keys().next().value;
  if(matches.size>1)console.warn(`Imagem ambígua: ${name}. Use o caminho completo no CSV.`,[...matches.values()]);
  return"";
}

function imagePathVariants(value){
  let raw=String(value||"").trim().replace(/^['"\[]+|['"\]]+$/g,"");
  try{raw=decodeURIComponent(raw)}catch{}
  raw=raw.split(/[?#]/)[0];
  const normalized=normPath(raw).normalize("NFC");
  const variants=new Set([normalized,normalized.split("/").pop()]);
  variants.add(normalized.replace(/^images?\//,""));
  variants.add(normalized.replace(/^.*?\/(images?\/)/,"$1"));
  return new Set([...variants].filter(Boolean));
}

function renderNavigator(){
  const g=$("navigatorGrid");
  g.innerHTML="";

  questions.forEach((q,i)=>{
    const b=document.createElement("button");
    b.className="nav-number";
    if(isQuestionAnswered(q,answers[q.id]))b.classList.add("answered");
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
  const answered=questions.filter(q=>isQuestionAnswered(q,answers[q.id])).length;
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

  settings.__bankSignature=questionsSignature(questions);
  settings.__answerAudit=answerAudit;
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
  markCloudDirty("progresso alterado");
  queueCloudProgress(progressRecord);
}

async function saveExit(){
  exitQuizMode();
  await saveProgress();
  stopTimer();
  try{
    await flushCloudProgress();
    if(pendingCloudProgress)throw new Error("A sincronização ainda está pendente.");
    toast("Progresso salvo neste dispositivo e na nuvem.");
  }catch(error){
    console.error(error);
    toast("Salvo neste dispositivo. A sincronização com a nuvem está pendente.");
  }
  $("quizScreen").classList.add("hidden");
  await showSetup(selectedBank.id);
}

async function deleteProgress(){
  markCloudDirty("progresso excluído");
  await del("progress",selectedBank.id);
  try{await deleteCloudProgress(selectedBank)}catch(e){console.error(e)}
  await showSetup(selectedBank.id);
}

async function finish(){
  const validation=validateSavedAnswers(questions,answers);
  if(validation.conflicts.length){
    const first=validation.conflicts[0];
    alert(`Não é possível finalizar: a questão ${first.position} possui uma resposta incompatível (${first.reason}). Revise essa questão ou exporte um backup para diagnóstico.`);
    goTo(first.position-1);
    return;
  }
  answers=validation.answers;
  const unanswered=questions.filter(q=>!isQuestionComplete(q,answers[q.id])).length;
  if(marked.size&&!confirm(`Há ${marked.size} questão(ões) marcada(s) para revisão. Deseja finalizar mesmo assim?`))return;
  if(settings.warn&&unanswered&&!confirm(`Há ${unanswered} não respondidas. Finalizar?`))return;

  stopTimer();
  exitQuizMode();
  let correct=0;
  reviewData=[];

  for(const q of questions){
    const dragdrop=q.tipo==="dragdrop";
    const u=dragdrop?normalizeDragDropAnswer(q,answers[q.id]):normAnswers(answers[q.id]||[]);
    const r=dragdrop?expectedDragDropAnswer(q):normAnswers(q.correta);
    const ok=dragdrop?dragDropAnswersEqual(q,u):eq(u,r);

    if(ok)correct++;

    reviewData.push({
      q,u,r,ok,
      unanswered:dragdrop?!isQuestionComplete(q,u):!u.length,
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
    reviewData,
    answerAudit:[...answerAudit],
    bankSignature:questionsSignature(questions)
  };

  await put("history",historyRecord);
  markCloudDirty("simulado finalizado");
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
    ua.textContent=x.q.tipo==="dragdrop"?"Sua montagem:":`Sua resposta: ${x.u.join(", ")||"Não respondida"}`;

    const ca=document.createElement("div");
    ca.className="review-answer correct";
    ca.textContent=x.q.tipo==="dragdrop"?"Comparação das caixas:":"Resposta correta:";

    e.append(cat,h,qt);

    const definition=x.q.tipo==="dragdrop"?dragDropDefinition(x.q):null;
    const qImg=resolveImage(x.q.imagem_pergunta);
    const activityImg=definition?resolveImage(definition.image):"";
    if(qImg&&qImg!==activityImg)e.appendChild(makeLabeledImage("Imagem ilustrativa do enunciado",qImg));
    if(activityImg)e.appendChild(makeLabeledImage("Atividade drag-and-drop",activityImg));

    e.append(ua,ca);

    if(x.q.tipo==="dragdrop"){
      e.appendChild(makeDragDropReview(x.q,x.u,x.r));
    }else if(x.r.length){
      const correctOptions=document.createElement("div");
      correctOptions.className="review-correct-options";

      for(const letter of x.r){
        const key=letter.toLowerCase();
        const option=document.createElement("div");
        option.className="review-correct-option";

        const optionText=document.createElement("div");
        optionText.className="review-correct-option-text";

        const optionLetter=document.createElement("span");
        optionLetter.className="option-letter";
        optionLetter.textContent=`${letter})`;
        optionText.appendChild(optionLetter);

        const text=document.createElement("span");
        text.textContent=x.q[`alt_${key}`]||"Alternativa apresentada somente como imagem";
        optionText.appendChild(text);
        option.appendChild(optionText);

        const img=resolveImage(x.q[`img_${key}`]);
        if(img)option.appendChild(makeImageBlock(img,`Imagem da alternativa correta ${letter}`));

        correctOptions.appendChild(option);
      }

      e.appendChild(correctOptions);
    }else{
      ca.textContent="Resposta correta: Não informada";
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

function makeDragDropReview(q,userAnswer,correctAnswer){
  const definition=dragDropDefinition(q),items=new Map(definition.items.map(item=>[item.id,item.text]));
  const grid=document.createElement("div");grid.className="dragdrop-review-grid";
  const makeColumn=(title,map,className)=>{
    const column=document.createElement("div");column.className=`dragdrop-review-map ${className}`;
    const heading=document.createElement("strong");heading.textContent=title;
    const list=document.createElement("ol");
    definition.zones.forEach((zone,index)=>{
      const row=document.createElement("li");
      const itemId=map?.[zone.id];row.textContent=`Caixa ${index+1}: ${items.get(itemId)||"Não preenchida"}`;list.appendChild(row);
    });
    column.append(heading,list);return column;
  };
  grid.append(makeColumn("Sua resposta",userAnswer,"user-wrong"),makeColumn("Resposta correta",correctAnswer,"correct-map"));
  return grid;
}

function formatAnswerForDisplay(q,value){
  if(q?.tipo!=="dragdrop")return Array.isArray(value)?value.join(", "):"";
  const definition=dragDropDefinition(q),items=new Map(definition.items.map(item=>[item.id,item.text]));
  const answer=value&&typeof value==="object"&&!Array.isArray(value)?value:{};
  return definition.zones.map((zone,index)=>`Caixa ${index+1}: ${items.get(answer[zone.id])||"vazia"}`).join(" · ");
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
  if(Array.isArray(v))return v.map(String).map(x=>x.trim().toUpperCase()).filter(x=>/^[A-E]$/.test(x)).sort();
  return String(v||"").replace(/["']/g,"").toUpperCase().split(/[,\s;|/]+/).filter(x=>/^[A-E]$/.test(x)).sort();
}

function questionSignature(q){
  const correct=q.tipo==="dragdrop"?JSON.stringify(expectedDragDropAnswer(q)):normAnswers(q.correta).join(",");
  const source=[q.id,q.tipo,q.pergunta,q.alt_a,q.alt_b,q.alt_c,q.alt_d,q.alt_e,correct,
    q.tipo==="dragdrop"?JSON.stringify(q.dragdrop||{}):""]
    .map(value=>String(value??"").trim()).join("\u001f");
  return hashText(source);
}

function questionsSignature(list){
  return `questions-${list.length}-${hashText(list.map(questionSignature).join("\u001e"))}`;
}

function hashText(value){
  let hash=0x811c9dc5;
  const text=String(value||"");
  for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),0x01000193);
  return (hash>>>0).toString(16).padStart(8,"0");
}

function validateSavedAnswers(list,saved){
  const normalized={};
  const conflicts=[];
  const seen=new Set();

  list.forEach((q,index)=>{
    const id=String(q.id);
    if(seen.has(id)){
      conflicts.push({position:index+1,id,reason:"ID duplicado no banco"});
      return;
    }
    seen.add(id);
    if(q.tipo==="dragdrop"){
      const value=normalizeDragDropAnswer(q,saved?.[id]);
      if(Object.keys(value).length)normalized[id]=value;
      return;
    }
    const values=normAnswers(saved?.[id]||[]);
    if(q.tipo==="single"&&values.length>1){
      conflicts.push({position:index+1,id,reason:`questão single com ${values.length} alternativas (${values.join(", ")})`});
    }
    if(values.length)normalized[id]=q.tipo==="single"?values.slice(0,1):[...new Set(values)];
  });

  return {answers:normalized,conflicts};
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


// Tenta concluir a gravação quando a página perde visibilidade.
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden")flushCloudProgress();
});
window.addEventListener("pagehide",()=>{flushCloudProgress()});
