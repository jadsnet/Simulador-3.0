import {put,get,getAll,del} from "./db.js";
import {initializeAuth,signIn,signUp,signOut,getCloudUser,pushProgress,pullProgress,deleteCloudProgress,pushHistory,ensureCloudBank,pullCloudState} from "./cloud.js";
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
    <article class="panel">
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
        <p><strong>Resposta correta:</strong> ${esc((item.r||[]).join(", "))}</p>
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
    const text=[q.pergunta,q.feedback,q.categoria,q.alt_a,q.alt_b,q.alt_c,q.alt_d,q.alt_e,(item.r||[]).join(" ")].join(" ").toLowerCase();
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
        <p>${item.ok?"✓ Respondida corretamente":"✕ Respondida incorretamente"} · correta: ${esc((item.r||[]).join(", "))}</p>
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

async function syncAllNow(options={}){
  if(!getCloudUser())return;
  setCloudStatus("Sincronizando","syncing");
  try{
    banks=await getAll("banks");
    for(const bank of banks){
      await ensureCloudBank(bank);
      const local=await get("progress",bank.id);
      const remote=await pullProgress(bank);
      if(remote && shouldUseRemoteProgress(local,remote)){
        await put("progress",remote);
      }else if(local){
        await pushProgress(bank,local);
      }
    }

    // Envia também os resultados antigos que ainda existiam apenas neste PC.
    const localHistory=await getAll("history");
    for(const item of localHistory){
      const bank=banks.find(b=>b.id===item.bankId);
      if(bank)await pushHistory(bank,item);
    }

    // O login restaura a biblioteca, os simulados em andamento e o histórico,
    // mesmo quando o IndexedDB está vazio (outro PC ou janela anônima).
    const cloudState=await pullCloudState();
    const bankIdMap=new Map();
    for(const remoteBank of cloudState.banks){
      const existing=banks.find(local=>local.id===remoteBank.id
        ||(String(local.name||"").trim().toLowerCase()===String(remoteBank.name||"").trim().toLowerCase()
          &&(local.questions?.length||0)===(remoteBank.questions?.length||0)));
      const localId=existing?.id||remoteBank.id;
      bankIdMap.set(remoteBank.id,localId);
      await put("banks",{...remoteBank,id:localId,createdAt:existing?.createdAt||remoteBank.createdAt});
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
    setCloudStatus("Sincronizado","online");
    if(!options.silent)toast("Sincronização concluída.");
  }catch(e){
    setCloudStatus("Erro de sync","error");
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
  const answered=Object.values(pr.answers||{}).filter(v=>Array.isArray(v)&&v.length).length;
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


// Tenta concluir a gravação quando a página perde visibilidade.
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="hidden")flushCloudProgress();
});
window.addEventListener("pagehide",()=>{flushCloudProgress()});
