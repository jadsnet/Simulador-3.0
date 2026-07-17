
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://qktvxmihtraxdoekobsg.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_T9CUAKZCQPQlw33c0dPC_A_jzBmtW9p";
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let currentUser = null;
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

export async function ensureCloudBank(bank){
  const user=await requireUser();
  const payload={
    user_id:user.id,
    local_bank_id:String(bank.id),
    name:bank.name||"Banco de questões",
    file_name:bank.fileName||null,
    question_count:Array.isArray(bank.questions)?bank.questions.length:0,
    updated_at:new Date().toISOString()
  };
  const {data,error}=await supabase.from("question_banks")
    .upsert(payload,{onConflict:"user_id,local_bank_id"})
    .select("id").single();
  if(error) throw error;
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
    settings:progress.settings||{},
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
  const {data:bankRow,error:bankError}=await supabase.from("question_banks")
    .select("id").eq("user_id",user.id).eq("local_bank_id",String(bank.id)).maybeSingle();
  if(bankError) throw bankError;
  if(!bankRow) return null;
  const {data,error}=await supabase.from("quiz_progress").select("*")
    .eq("user_id",user.id).eq("bank_id",bankRow.id).maybeSingle();
  if(error) throw error;
  if(!data) return null;
  return {
    bankId:bank.id, currentIndex:data.current_index,
    order:data.question_order||[], answers:data.answers||{},
    timerSeconds:data.timer_seconds||0, settings:data.settings||{},
    favorites:data.favorites||[], marked:data.marked||[],
    notes:data.notes||{}, savedAt:data.client_updated_at||data.updated_at
  };
}

export async function deleteCloudProgress(bank){
  const user=await requireUser();
  const {data}=await supabase.from("question_banks").select("id")
    .eq("user_id",user.id).eq("local_bank_id",String(bank.id)).maybeSingle();
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
    answers:{reviewData:h.reviewData||[]}, settings:{},
    finished_at:h.finishedAt||new Date().toISOString()
  };
  const {error}=await supabase.from("quiz_history").upsert(payload);
  if(error) throw error;
}
