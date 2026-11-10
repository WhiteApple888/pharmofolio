import { createResponse, responseText } from './openai-client.js';
import { SEED_PROFILES } from './seed-data.js';

const SESSION_COOKIE = 'pharmpath_session';
const SESSION_TTL_SECONDS = 12 * 60 * 60;
// Cloudflare Workers limits Web Crypto PBKDF2 to 100,000 iterations.
const PASSWORD_PBKDF2_ITERATIONS = 100000;
const GRADE_TARGETS = {P12:80,P13:50,P14:85,P15:70,P16:80,P17:40,P18:50};

function responseJson(body,status=200,extraHeaders={}) {
  return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extraHeaders}});
}
function error(message,status=400){return responseJson({error:message},status)}
function now(){return Math.floor(Date.now()/1000)}
function id(prefix){return `${prefix}_${crypto.randomUUID()}`}
function textJson(value,fallback={}){try{return JSON.parse(value)}catch{return fallback}}
function cleanFilename(value){return String(value||'file').split(/[\\/]/).pop().replace(/[\r\n"]/g,'_').slice(0,180)||'file'}
function cookieValue(request,name){
  const pair=(request.headers.get('cookie')||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(`${name}=`));
  return pair?decodeURIComponent(pair.slice(name.length+1)):null;
}
function bytesToBase64(bytes){let value='';for(const byte of bytes)value+=String.fromCharCode(byte);return btoa(value)}
function base64ToBytes(value){return Uint8Array.from(atob(value),character=>character.charCodeAt(0))}
async function sha256(value){const bytes=typeof value==='string'?new TextEncoder().encode(value):value;return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('')}
async function passwordHash(password,saltBytes){
  const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:saltBytes,iterations:PASSWORD_PBKDF2_ITERATIONS},material,256));
}
async function first(db,sql,...values){return db.prepare(sql).bind(...values).first()}
async function all(db,sql,...values){return (await db.prepare(sql).bind(...values).all()).results||[]}
async function run(db,sql,...values){return db.prepare(sql).bind(...values).run()}

async function seedDirectory(db){
  // This is idempotent for existing hosted databases; the bundled migration creates
  // the same table for new deployments.
  await run(db,'CREATE TABLE IF NOT EXISTS development_plan_responses (reportee_user_id TEXT PRIMARY KEY NOT NULL, reviewer_user_id TEXT NOT NULL, action_items_json TEXT NOT NULL DEFAULT \'[]\', discussion_notes TEXT NOT NULL DEFAULT \'\', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)');
  await run(db,"CREATE TABLE IF NOT EXISTS assessment_officer_submissions (assessment_id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','submitted')), submitted_at INTEGER, FOREIGN KEY (assessment_id) REFERENCES assessment_records(id))");
  await run(db,"CREATE TABLE IF NOT EXISTS assessment_ratings (item_id TEXT PRIMARY KEY NOT NULL, owner_rating REAL, officer_rating REAL, FOREIGN KEY (item_id) REFERENCES assessment_items(id))");
  const profileCount=Number((await first(db,'SELECT COUNT(*) AS count FROM profiles'))?.count||0);
  if(profileCount<SEED_PROFILES.length){
    const statements=[];
    for(const profile of SEED_PROFILES){
      statements.push(db.prepare('INSERT OR IGNORE INTO profiles (person_id,name,grade,track,section,reporting_officer,years_in_job_grade,years_in_grade,source_row) VALUES (?,?,?,?,?,?,?,?,?)').bind(profile.personId,profile.name,profile.grade,profile.track,profile.section,profile.reportingOfficer,Number.isFinite(profile.yearsInJobGrade)?profile.yearsInJobGrade:null,Number.isFinite(profile.yearsInJobGrade)?profile.yearsInJobGrade:null,profile.sourceRow));
    }
    await db.batch(statements);
  }
  // A deployed directory may predate the new source column. Backfill only blank
  // values so the CSV becomes available without overwriting subsequent edits.
  await db.batch(SEED_PROFILES.map(profile => db.prepare('UPDATE profiles SET years_in_job_grade=? WHERE person_id=? AND years_in_job_grade IS NULL').bind(Number.isFinite(profile.yearsInJobGrade)?profile.yearsInJobGrade:null,profile.personId)));
  // Refresh seeded login verifiers even when the directory already exists.
  // This keeps the documented credentials valid after a verifier migration.
  const userStatements=[];
  for(const profile of SEED_PROFILES){
    // Refresh seeded verifiers so deployments can safely migrate from a
    // previously unsupported PBKDF2 iteration count.
    userStatements.push(db.prepare('INSERT INTO users (id,person_id,username,password_hash,password_salt,role,team_view,division_view,active) VALUES (?,?,?,?,?,?,?,?,1) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,password_salt=excluded.password_salt').bind(`user-${profile.username}`,profile.personId,profile.username,profile.passwordHash,profile.passwordSalt,profile.role,profile.teamView?1:0,profile.divisionView?1:0));
  }
  for(const profile of SEED_PROFILES.filter(row=>row.supervisorPersonId)){
    userStatements.push(db.prepare('INSERT OR REPLACE INTO reporting_lines (reportee_person_id,supervisor_person_id) VALUES (?,?)').bind(profile.personId,profile.supervisorPersonId));
  }
  await db.batch(userStatements);
}

async function actorFor(request,db){
  const token=cookieValue(request,SESSION_COOKIE);
  if(!token)return null;
  const tokenHash=await sha256(token);
  const actor=await first(db,`SELECT u.id AS id,u.person_id AS person_id,u.username AS username,u.role AS role,u.team_view AS team_view,u.division_view AS division_view,p.name AS name,p.grade AS grade,p.track AS track,p.section AS section,p.reporting_officer AS reporting_officer,COALESCE(p.years_in_job_grade,p.years_in_grade) AS years_in_job_grade,(SELECT COUNT(*) FROM reporting_lines r WHERE r.supervisor_person_id=u.person_id) AS reportee_count FROM sessions s JOIN users u ON u.id=s.user_id JOIN profiles p ON p.person_id=u.person_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`,tokenHash,now());
  if(!actor){await run(db,'DELETE FROM sessions WHERE token_hash=?',tokenHash);return null}
  await run(db,'UPDATE sessions SET last_seen_at=? WHERE token_hash=?',now(),tokenHash);
  actor.teamAccess=Boolean(actor.team_view&&Number(actor.reportee_count)>0);
  actor.divisionAccess=Boolean(actor.division_view);
  actor.tokenHash=tokenHash;
  return actor;
}
function userPayload(actor){return {id:actor.id,username:actor.username,name:actor.name,role:actor.role,profile:{grade:actor.grade,track:actor.track,section:actor.section,reporting_officer:actor.reporting_officer,years_in_job_grade:actor.years_in_job_grade},capabilities:{team_dashboard:actor.teamAccess||actor.divisionAccess,reportee_assessment:actor.teamAccess||actor.divisionAccess,division_dashboard:actor.divisionAccess}}}
function profilePayload(row){return {person_id:row.person_id,user_id:row.user_id,name:row.name,grade:row.grade,track:row.track,section:row.section,reporting_officer:row.reporting_officer,years_in_job_grade:row.years_in_job_grade,target_percentage:GRADE_TARGETS[row.grade]??80}}
async function directReportRows(db,actor){return all(db,`SELECT p.person_id,u.id AS user_id,p.name,p.grade,p.track,p.section,p.reporting_officer,COALESCE(p.years_in_job_grade,p.years_in_grade) AS years_in_job_grade FROM reporting_lines r JOIN profiles p ON p.person_id=r.reportee_person_id LEFT JOIN users u ON u.person_id=p.person_id WHERE r.supervisor_person_id=? ORDER BY p.name`,actor.person_id)}
async function divisionRows(db){return all(db,`SELECT p.person_id,u.id AS user_id,p.name,p.grade,p.track,p.section,p.reporting_officer,COALESCE(p.years_in_job_grade,p.years_in_grade) AS years_in_job_grade FROM profiles p LEFT JOIN users u ON u.person_id=p.person_id ORDER BY p.name`)}
async function ownsReportee(db,actor,reporteeUserId){return Boolean(await first(db,'SELECT 1 AS allowed FROM reporting_lines r JOIN users u ON u.person_id=r.reportee_person_id WHERE r.supervisor_person_id=? AND u.id=? LIMIT 1',actor.person_id,reporteeUserId))}

function ratingScore(mapping){return ({'No Evidence':0,'Not enough evidence':0,Foundation:.25,Intermediate:.5,Advanced:.75,Expert:1})[mapping.rating || mapping.current_level] ?? 0}
function activeStandard(id){return /^[1-6]\./.test(String(id||''))}
function filterAnalysis(result){return {...result,mappings:(result.mappings||[]).filter(item=>activeStandard(item.standard_id)),gaps:(result.gaps||[]).filter(item=>activeStandard(item.standard_id))}}
async function latestAssessment(db,userId,submittedOnly=false){return first(db,`SELECT * FROM assessment_records WHERE user_id=?${submittedOnly?" AND status='submitted'":''} ORDER BY created_at DESC,id DESC LIMIT 1`,userId)}
async function assessmentPayload(db,record,includeOwnerDraft=false,includeOfficerDraft=false){
  if(!record)return null;
  const aiResult=textJson(record.ai_result_json,{mappings:[]});
  const rows=await all(db,'SELECT * FROM assessment_items WHERE assessment_id=? ORDER BY item_key',record.id);
  const ratings=await all(db,'SELECT ar.* FROM assessment_ratings ar JOIN assessment_items ai ON ai.id=ar.item_id WHERE ai.assessment_id=?',record.id);
  const ratingsByItem=new Map(ratings.map(row=>[row.item_id,row]));
  const review=await first(db,'SELECT status,submitted_at FROM assessment_officer_submissions WHERE assessment_id=?',record.id);
  const officerStatus=review?.status || (rows.some(row=>row.officer_saved_at) ? 'submitted' : 'draft');
  const officerVisible=record.status==='submitted' && officerStatus==='submitted';
  const byKey=new Map(rows.map(row=>[row.item_key,row]));
  const items=(aiResult.mappings||[]).map((mapping,index)=>{
    const itemKey=`${mapping.standard_id||'unknown'}:${index}`;
    const row=byKey.get(itemKey);if(!row)return null;
    if(!activeStandard(mapping.standard_id))return null;
    const rating=ratingsByItem.get(row.id)||{};
    const aiScore=ratingScore(mapping);const aiJustification=String(mapping.rationale||'');
    const owner={confidence_score:rating.owner_rating ?? null,justification:row.owner_justification,saved_at:rating.owner_rating!=null&&row.owner_saved_at?new Date(row.owner_saved_at*1000).toISOString():null,submitted:record.status==='submitted'};
    const showOfficer=officerVisible||includeOfficerDraft;
    const officer={confidence_score:showOfficer?(rating.officer_rating ?? null):null,justification:showOfficer?row.officer_justification:null,saved_at:showOfficer&&rating.officer_rating!=null&&row.officer_saved_at?new Date(row.officer_saved_at*1000).toISOString():null};
    let effective={confidence_score:aiScore,justification:aiJustification,source:'ai_generated'};
    if(rating.owner_rating!=null&&(record.status==='submitted'||includeOwnerDraft))effective={confidence_score:rating.owner_rating ?? null,justification:row.owner_justification||'',source:record.status==='submitted'?'reportee_submitted':'pharmacist_draft'};
    if(officerVisible&&rating.officer_rating!=null)effective={confidence_score:rating.officer_rating,justification:row.officer_justification||'',source:'reporting_officer_final'};
    return {id:row.id,item_key:itemKey,standard_id:mapping.standard_id,ai:{confidence_score:aiScore,justification:aiJustification,mapping},reportee:owner,reporting_officer:officer,effective};
  }).filter(Boolean);
  return {id:record.id,workflow_id:record.workflow_id,status:record.status,officer_status:officerStatus,submitted_at:record.submitted_at?new Date(record.submitted_at*1000).toISOString():null,ai_result:filterAnalysis(aiResult),items};
}
function assessmentSummary(payload,grade){
  if(!payload)return null;
  const byStandard=new Map();
  for(const item of payload.items)byStandard.set(item.standard_id,Math.max(Number(item.effective.confidence_score),byStandard.get(item.standard_id)||0));
  const domainScores=[];
  for(let domain=1;domain<=6;domain+=1){const ids=[...byStandard.keys()].filter(key=>String(key).startsWith(`${domain}.`));domainScores.push(ids.length?Math.round(ids.reduce((sum,key)=>sum+byStandard.get(key),0)/ids.length*100):0)}
  const threshold=({P12:.25,P13:.5,P14:.5,P15:.75,P16:.75,P17:1,P18:1})[grade] ?? .5;
  return {id:payload.id,status:payload.status,domain_scores:domainScores,percentage_met:byStandard.size?Math.round([...byStandard.values()].filter(score=>score>=threshold).length/23*100):null,effective_sources:[...new Set(payload.items.map(item=>item.effective.source))]};
}
async function dashboardPayload(db,rows,source){
  const profiles=[];
  for(const row of rows){const profile=profilePayload(row);const record=row.user_id?await latestAssessment(db,row.user_id):null;profile.analysis=null;profile.assessment=assessmentSummary(await assessmentPayload(db,record),row.grade);profiles.push(profile)}
  return {source,profiles};
}
function uploadPayload(row){return {id:row.id,context:row.context,filename:row.filename,mime_type:row.mime_type,size_bytes:row.size_bytes,uploaded_at:new Date(row.created_at*1000).toISOString(),can_delete:true}}
function savedPayload(row){return {id:row.id,context:row.context,content_type:row.content_type,title:row.title,body:row.body,is_ai_generated:true,metadata:textJson(row.metadata_json,{}),created_at:new Date(row.created_at*1000).toISOString()}}
function conversationPayload(row){return {id:row.id,title:row.title,created_at:new Date(row.created_at*1000).toISOString(),updated_at:new Date(row.updated_at*1000).toISOString()}}
function messagePayload(row){return {id:row.id,role:row.author_role,type:row.message_type,content:row.content,is_ai_generated:Boolean(row.generated),metadata:textJson(row.metadata_json,{}),created_at:new Date(row.created_at*1000).toISOString()}}
function cleanActionItems(value){
  if(!Array.isArray(value)||value.length>30)return null;
  const items=[];
  for(const raw of value){const action_item=String(raw?.action_item||'').trim(),target_date=String(raw?.target_date||'').trim(),support_needed=String(raw?.support_needed||'').trim();if(!action_item||action_item.length>1000||target_date.length>120||support_needed.length>1000)return null;items.push({action_item,target_date,support_needed})}
  return items;
}
async function developmentResponsePayload(db,reporteeUserId){const row=await first(db,'SELECT * FROM development_plan_responses WHERE reportee_user_id=?',reporteeUserId);if(!row)return {action_items:[],discussion_notes:'',updated_at:null};return {action_items:textJson(row.action_items_json,[]),discussion_notes:row.discussion_notes||'',updated_at:new Date(row.updated_at*1000).toISOString()}}
async function reporteeCoachingDevelopmentPayload(db,reporteeUserId){
  const [record,coaching,savedPlans,conversationRows,response]=await Promise.all([
    latestAssessment(db,reporteeUserId),
    all(db,"SELECT * FROM saved_content WHERE user_id=? AND context='coaching' ORDER BY created_at DESC",reporteeUserId),
    all(db,"SELECT * FROM saved_content WHERE user_id=? AND context='development_plan' ORDER BY created_at DESC",reporteeUserId),
    all(db,'SELECT * FROM conversations WHERE user_id=? ORDER BY updated_at DESC',reporteeUserId),
    developmentResponsePayload(db,reporteeUserId),
  ]);
  const chat_history=[];
  for(const conversation of conversationRows){
    const messages=await all(db,'SELECT * FROM coaching_messages WHERE conversation_id=? ORDER BY created_at,id',conversation.id);
    chat_history.push({...conversationPayload(conversation),messages:messages.map(messagePayload)});
  }
  const analysis=filterAnalysis(textJson(record?.ai_result_json,{gaps:[],coaching:[]}));
  return {coaching_takeaways:coaching.map(savedPayload),development_objectives:{gaps:analysis.gaps||[],focus_areas:analysis.coaching||[]},saved_development_plans:savedPlans.map(savedPayload),chat_history,response};
}
async function requestBody(request){try{return await request.json()}catch{throw Object.assign(new Error('The request body must be valid JSON.'),{status:422})}}
function validScore(value){return [0,.25,.5,.75,1].includes(value)}
async function openAiText(env,prompt){
  const data = await createResponse(env, {input: prompt});
  return responseText(data);
}
async function coachingContext(db,actor){const record=await latestAssessment(db,actor.id);const assessment=await assessmentPayload(db,record,true);return {name:actor.name,grade:actor.grade,track:actor.track,section:actor.section,assessment:assessment?{status:assessment.status,items:assessment.items.map(item=>({standard_id:item.standard_id,ai_generated:item.ai,pharmacist_value:item.reportee,effective:item.effective}))}:{status:'not_started'}}}

export async function handleHostedRequest(request,env,url,{mapEvidence,embeddedAsset}){
  const db=env.DB;if(!db)return error('The Sites database binding is not configured for this deployment.',503);
  await seedDirectory(db);
  const method=request.method.toUpperCase();const path=url.pathname;
  if(path==='/health'&&method==='GET')return responseJson({ok:true,backend:'sites-d1',database:true,object_storage:Boolean(env.FILES)});
  if(path==='/api/auth/login'&&method==='POST'){
    const body=await requestBody(request);const username=String(body.username||'').trim().toLowerCase();const user=await first(db,`SELECT u.*,p.name,p.grade,p.track,p.section,p.reporting_officer,COALESCE(p.years_in_job_grade,p.years_in_grade) AS years_in_job_grade,(SELECT COUNT(*) FROM reporting_lines r WHERE r.supervisor_person_id=u.person_id) AS reportee_count FROM users u JOIN profiles p ON p.person_id=u.person_id WHERE u.username=? AND u.active=1`,username);
    const salt=user?base64ToBytes(user.password_salt):new Uint8Array(16);const candidate=bytesToBase64(await passwordHash(String(body.password||''),salt));
    if(!user||candidate!==user.password_hash)return error('The username or password is incorrect.',401);
    const token=bytesToBase64(crypto.getRandomValues(new Uint8Array(32))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');const tokenHash=await sha256(token);const timestamp=now();
    await run(db,'INSERT INTO sessions (token_hash,user_id,expires_at,last_seen_at) VALUES (?,?,?,?)',tokenHash,user.id,timestamp+SESSION_TTL_SECONDS,timestamp);
    user.teamAccess=Boolean(user.team_view&&Number(user.reportee_count)>0);user.divisionAccess=Boolean(user.division_view);
    return responseJson({user:userPayload(user)},200,{'Set-Cookie':`${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`});
  }
  const actor=await actorFor(request,db);
  if(path==='/api/auth/logout'&&method==='POST'){
    if(actor)await run(db,'DELETE FROM sessions WHERE token_hash=?',actor.tokenHash);
    return responseJson({ok:true},200,{'Set-Cookie':`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`});
  }
  if(!actor)return error('Sign in is required.',401);
  if(!['GET','HEAD'].includes(method)&&request.headers.get('x-requested-with')!=='PharmPath')return error('The request could not be verified.',403);
  if(path==='/api/auth/me'&&method==='GET')return responseJson({user:userPayload(actor)});
  let match;
  if(path==='/api/profiles'&&method==='GET'){const rows=await all(db,'SELECT p.*,u.id AS user_id FROM profiles p JOIN users u ON u.person_id=p.person_id WHERE u.id=?',actor.id);return responseJson({profiles:rows.map(profilePayload)})}
  if(path==='/api/team-dashboard'&&method==='GET'){if(!actor.teamAccess)return error('You do not have access to the Team Dashboard.',403);return responseJson(await dashboardPayload(db,await directReportRows(db,actor),'Authorised direct-report profiles and persisted assessments'))}
  if(path==='/api/division-dashboard'&&method==='GET'){if(!actor.divisionAccess)return error('You do not have access to the Division Dashboard.',403);return responseJson(await dashboardPayload(db,await divisionRows(db),'Entire division from the relational pharmacist directory'))}
  if(path==='/api/reportees'&&method==='GET'){if(!actor.teamAccess&&!actor.divisionAccess)return error('You do not have access to Individual views.',403);const rows=actor.divisionAccess?await divisionRows(db):await directReportRows(db,actor);return responseJson({reportees:rows.map(profilePayload)})}
  if(path==='/api/development-plan-response'&&method==='GET')return responseJson({response:await developmentResponsePayload(db,actor.id)});
  match=path.match(/^\/api\/reportees\/([^/]+)\/evidence\/([^/]+)\/download$/);
  if(match&&method==='GET'){const reporteeId=decodeURIComponent(match[1]),uploadId=decodeURIComponent(match[2]);const isDirect=actor.teamAccess&&await ownsReportee(db,actor,reporteeId);if(!actor.divisionAccess&&!isDirect)return error('You may view only your authorised staff profiles.',403);const row=await first(db,"SELECT * FROM uploads WHERE id=? AND user_id=? AND context='evidence'",uploadId,reporteeId);if(!row)return error('Saved evidence not found.',404);const object=await env.FILES.get(row.object_key);if(!object)return error('Saved evidence is unavailable.',404);return new Response(object.body,{headers:{'Content-Type':row.mime_type,'Content-Disposition':`attachment; filename="${cleanFilename(row.filename)}"`,'Cache-Control':'private, no-store'}})}
  match=path.match(/^\/api\/reportees\/([^/]+)\/evidence$/);
  if(match&&method==='GET'){const reporteeId=decodeURIComponent(match[1]);const isDirect=actor.teamAccess&&await ownsReportee(db,actor,reporteeId);if(!actor.divisionAccess&&!isDirect)return error('You may view only your authorised staff profiles.',403);const items=await all(db,"SELECT id,filename,mime_type,size_bytes,created_at FROM uploads WHERE user_id=? AND context='evidence' ORDER BY created_at DESC",reporteeId);return responseJson({reportee_user_id:reporteeId,items:items.map(row=>({id:row.id,filename:row.filename,mime_type:row.mime_type,size_bytes:row.size_bytes,uploaded_at:new Date(row.created_at*1000).toISOString()}))})}
  match=path.match(/^\/api\/reportees\/([^/]+)\/coaching-development$/);
  if(match&&method==='GET'){
    const reporteeId=decodeURIComponent(match[1]);
    const isDirect=actor.teamAccess&&await ownsReportee(db,actor,reporteeId);
    if(!actor.divisionAccess&&!isDirect)return error('You may view only your authorised staff profiles.',403);
    return responseJson({...await reporteeCoachingDevelopmentPayload(db,reporteeId),can_edit:isDirect});
  }
  match=path.match(/^\/api\/reportees\/([^/]+)\/development-plan-response$/);
  if(match&&method==='GET'){
    const reporteeId=decodeURIComponent(match[1]);const isDirect=actor.teamAccess&&await ownsReportee(db,actor,reporteeId);if(!actor.divisionAccess&&!isDirect)return error('You may view only your authorised staff profiles.',403);return responseJson({response:{...await developmentResponsePayload(db,reporteeId),can_edit:isDirect}});
  }
  if(match&&method==='PUT'){
    const reporteeId=decodeURIComponent(match[1]);if(!actor.teamAccess||!await ownsReportee(db,actor,reporteeId))return error('Only a direct reportee\'s Reporting Officer can update this response.',403);const body=await requestBody(request);const actionItems=cleanActionItems(body.action_items);const notes=String(body.discussion_notes||'').trim();if(!actionItems||notes.length>5000)return error('Enter up to 30 action items with an action, and discussion notes of up to 5,000 characters.',422);const timestamp=now();await run(db,'INSERT INTO development_plan_responses (reportee_user_id,reviewer_user_id,action_items_json,discussion_notes,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(reportee_user_id) DO UPDATE SET reviewer_user_id=excluded.reviewer_user_id,action_items_json=excluded.action_items_json,discussion_notes=excluded.discussion_notes,updated_at=excluded.updated_at',reporteeId,actor.id,JSON.stringify(actionItems),notes,timestamp,timestamp);return responseJson({response:await developmentResponsePayload(db,reporteeId)});
  }
  if(path==='/api/workspace/reset'&&method==='POST'){
    // Delete children first; the batch is atomic and scoped to the signed-in user.
    const statements=[
      ['DELETE FROM assessment_officer_submissions WHERE assessment_id IN (SELECT id FROM assessment_records WHERE user_id=?)',actor.id],
      ['DELETE FROM assessment_ratings WHERE item_id IN (SELECT id FROM assessment_items WHERE assessment_id IN (SELECT id FROM assessment_records WHERE user_id=?))',actor.id],
      ['DELETE FROM assessment_items WHERE assessment_id IN (SELECT id FROM assessment_records WHERE user_id=?)',actor.id],
      ['DELETE FROM assessment_records WHERE user_id=?',actor.id],
      ['DELETE FROM coaching_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE user_id=?)',actor.id],
      ['DELETE FROM conversations WHERE user_id=?',actor.id],
      ["DELETE FROM saved_content WHERE user_id=? AND context IN ('assessment','coaching','development_plan')",actor.id],
      ['DELETE FROM development_plan_responses WHERE reportee_user_id=?',actor.id],
    ];
    await db.batch(statements.map(([sql,value])=>db.prepare(sql).bind(value)));
    return responseJson({reset:true});
  }
  if(path==='/api/assessment'&&method==='GET')return responseJson({assessment:await assessmentPayload(db,await latestAssessment(db,actor.id),true)});
  match=path.match(/^\/api\/assessment\/items\/([^/]+)$/);
  if(match&&method==='PUT'){
    const body=await requestBody(request);const score=body.rating_score === null || body.rating_score === undefined ? NaN : Number(body.rating_score);const justification=String(body.justification||'').trim();if(!validScore(score)||!justification||justification.length>5000)return error('Choose a valid rating and enter a final response of up to 5,000 characters.',422);
    const owned=await first(db,"SELECT ar.id AS assessment_id FROM assessment_items ai JOIN assessment_records ar ON ar.id=ai.assessment_id WHERE ai.id=? AND ar.user_id=? AND ar.status='draft'",decodeURIComponent(match[1]),actor.id);if(!owned)return error('Assessment item is not available to the current user.',403);
    const previous=await first(db,'SELECT ar.owner_rating,ai.owner_justification FROM assessment_items ai LEFT JOIN assessment_ratings ar ON ar.item_id=ai.id WHERE ai.id=?',decodeURIComponent(match[1]));
    const changed=previous?.owner_rating !== score || (previous?.owner_justification || '') !== justification;
    await run(db,"INSERT INTO assessment_ratings (item_id,owner_rating,officer_rating) VALUES (?,?,NULL) ON CONFLICT(item_id) DO UPDATE SET officer_rating=CASE WHEN ? THEN NULL ELSE officer_rating END,owner_rating=excluded.owner_rating",decodeURIComponent(match[1]),score,changed?1:0);
    await run(db,"UPDATE assessment_items SET owner_justification=?,owner_saved_at=?,officer_justification=CASE WHEN ? THEN NULL ELSE officer_justification END,officer_saved_at=CASE WHEN ? THEN NULL ELSE officer_saved_at END WHERE id=?",justification,now(),changed?1:0,changed?1:0,decodeURIComponent(match[1]));await run(db,'UPDATE assessment_records SET updated_at=? WHERE id=?',now(),owned.assessment_id);
    return responseJson({assessment:await assessmentPayload(db,await first(db,'SELECT * FROM assessment_records WHERE id=?',owned.assessment_id),true)});
  }
  if(path==='/api/assessment/submit'&&method==='POST'){
    const record=await latestAssessment(db,actor.id);if(!record)return error('Run an evidence analysis before submitting an assessment.',409);
    const assessment=await assessmentPayload(db,record,true);if(!assessment.items.length || assessment.items.some(item=>item.reportee.confidence_score === null || item.reportee.confidence_score === undefined || !item.reportee.justification?.trim()))return error('Save a rating and final response for every assessment item before submitting.',422);
    const timestamp=now();await run(db,"UPDATE assessment_records SET status='submitted',submitted_at=?,updated_at=? WHERE id=? AND user_id=?",timestamp,timestamp,record.id,actor.id);return responseJson({assessment:await assessmentPayload(db,await first(db,'SELECT * FROM assessment_records WHERE id=?',record.id),true)});
  }
  if(path==='/api/assessment/reverse-submission'&&method==='POST'){
    const record=await latestAssessment(db,actor.id);if(!record||record.status!=='submitted')return error('There is no submitted assessment to reverse.',409);
    await run(db,"UPDATE assessment_records SET status='draft',submitted_at=NULL,updated_at=? WHERE id=? AND user_id=? AND status='submitted'",now(),record.id,actor.id);
    await run(db,"INSERT INTO assessment_officer_submissions (assessment_id,status,submitted_at) VALUES (?,'draft',NULL) ON CONFLICT(assessment_id) DO UPDATE SET status='draft',submitted_at=NULL",record.id);
    return responseJson({assessment:await assessmentPayload(db,await first(db,'SELECT * FROM assessment_records WHERE id=?',record.id),true)});
  }
  match=path.match(/^\/api\/reportee-assessments\/([^/]+)\/(submit-review|reverse-submission)$/);
  if(match&&method==='POST'){
    const reporteeId=decodeURIComponent(match[1]);if(!actor.teamAccess||!await ownsReportee(db,actor,reporteeId))return error('Only the direct Reporting Officer can change this review.',403);
    const record=await latestAssessment(db,reporteeId);if(!record||record.status!=='submitted')return error('A submitted reportee assessment is required.',409);
    const current=await assessmentPayload(db,record,false,true);
    if(match[2]==='submit-review'){
      if(current.officer_status==='submitted')return error('The review is already submitted.',409);
      if(!current.items.some(item=>item.reporting_officer.saved_at))return error('Save at least one assessment item before submitting your review.',422);
      await run(db,"INSERT INTO assessment_officer_submissions (assessment_id,status,submitted_at) VALUES (?,'submitted',?) ON CONFLICT(assessment_id) DO UPDATE SET status='submitted',submitted_at=excluded.submitted_at",record.id,now());
    }else{
      if(current.officer_status!=='submitted')return error('There is no submitted review to reverse.',409);
      await run(db,"INSERT INTO assessment_officer_submissions (assessment_id,status,submitted_at) VALUES (?,'draft',NULL) ON CONFLICT(assessment_id) DO UPDATE SET status='draft',submitted_at=NULL",record.id);
    }
    return responseJson({assessment:await assessmentPayload(db,record,false,true)});
  }
  match=path.match(/^\/api\/reportee-assessments\/([^/]+)$/);
  if(match&&method==='GET'){
    const reporteeId=decodeURIComponent(match[1]);if(!actor.divisionAccess&&(!actor.teamAccess||!await ownsReportee(db,actor,reporteeId)))return error('You may view only your authorised staff profiles.',403);const latest=await latestAssessment(db,reporteeId);const record=latest?.status==='submitted'?latest:null;return responseJson({assessment:await assessmentPayload(db,record,false,Boolean(actor.teamAccess&&await ownsReportee(db,actor,reporteeId))),status:record?'submitted':'not_submitted'});
  }
  match=path.match(/^\/api\/reportee-assessments\/([^/]+)\/items\/([^/]+)$/);
  if(match&&method==='PUT'){
    const reporteeId=decodeURIComponent(match[1]),itemId=decodeURIComponent(match[2]);if(!actor.teamAccess||!await ownsReportee(db,actor,reporteeId))return error('You may review only your direct reportees.',403);const body=await requestBody(request);const score=body.rating_score === null || body.rating_score === undefined ? NaN : Number(body.rating_score),justification=String(body.justification||'').trim();if(!validScore(score)||!justification||justification.length>5000)return error('Choose a valid rating and enter a final assessment of up to 5,000 characters.',422);
    const owned=await first(db,"SELECT ar.id AS assessment_id FROM assessment_items ai JOIN assessment_records ar ON ar.id=ai.assessment_id WHERE ai.id=? AND ar.user_id=? AND ar.status='submitted'",itemId,reporteeId);if(!owned)return error('A submitted reportee assessment is required before review.',403);
    const current=await assessmentPayload(db,await first(db,'SELECT * FROM assessment_records WHERE id=?',owned.assessment_id),false,true);if(current.officer_status==='submitted')return error('Reverse your submitted review before editing.',409);
    await run(db,"INSERT OR IGNORE INTO assessment_officer_submissions (assessment_id,status) VALUES (?,'draft')",owned.assessment_id);
    await run(db,"INSERT INTO assessment_ratings (item_id,officer_rating) VALUES (?,?) ON CONFLICT(item_id) DO UPDATE SET officer_rating=excluded.officer_rating",itemId,score);await run(db,'UPDATE assessment_items SET reviewer_user_id=?,officer_justification=?,officer_saved_at=? WHERE id=?',actor.id,justification,now(),itemId);await run(db,'UPDATE assessment_records SET updated_at=? WHERE id=?',now(),owned.assessment_id);return responseJson({assessment:await assessmentPayload(db,await first(db,'SELECT * FROM assessment_records WHERE id=?',owned.assessment_id),false,true)});
  }
  if(path==='/api/map'&&method==='POST'){
    const body=await requestBody(request);body.profile={name:actor.name,grade:actor.grade,track:actor.track};const mapped=await mapEvidence(body,env);const workflowId=id('workflow'),recordId=id('assessment'),timestamp=now();await run(db,'INSERT INTO assessment_records (id,user_id,workflow_id,ai_result_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',recordId,actor.id,workflowId,JSON.stringify(mapped.result),'draft',timestamp,timestamp);
    const statements=(mapped.result.mappings||[]).map((mapping,index)=>db.prepare('INSERT INTO assessment_items (id,assessment_id,item_key,standard_id) VALUES (?,?,?,?)').bind(id('item'),recordId,`${mapping.standard_id||'unknown'}:${index}`,mapping.standard_id||'unknown'));if(statements.length)await db.batch(statements);return responseJson({workflow_id:workflowId,model:mapped.model,result:mapped.result});
  }
  if(path==='/api/uploads'&&method==='POST'||path==='/api/uploads/text'&&method==='POST'){
    if(!env.FILES)return error('Object storage is not configured for this deployment.',503);const body=await requestBody(request);let filename,mimeType,bytes,context;
    if(path.endsWith('/text')){filename=cleanFilename(body.filename||'Pasted evidence.txt');mimeType='text/plain; charset=utf-8';bytes=new TextEncoder().encode(String(body.text||''));context='evidence'}else{filename=cleanFilename(body.name);context=String(body.context||'evidence');const parts=String(body.dataUrl||'').split(',',2);if(parts.length!==2)return error('The upload payload is invalid.',422);mimeType=(parts[0].match(/^data:([^;]+)/)||[])[1]||'application/octet-stream';try{bytes=base64ToBytes(parts[1])}catch{return error('The upload payload is invalid.',422)}}
    if(!bytes.length)return error('The selected file is empty.',422);if(bytes.length>25*1024*1024)return error('Files must be no larger than 25 MB.',413);const uploadId=id('upload'),key=`${actor.id}/${uploadId}/${filename}`;await env.FILES.put(key,bytes,{httpMetadata:{contentType:mimeType}});await run(db,'INSERT INTO uploads (id,user_id,context,filename,mime_type,size_bytes,object_key,created_at) VALUES (?,?,?,?,?,?,?,?)',uploadId,actor.id,context,filename,mimeType,bytes.length,key,now());return responseJson({item:uploadPayload(await first(db,'SELECT * FROM uploads WHERE id=?',uploadId))});
  }
  if(path==='/api/uploads'&&method==='GET'){const context=url.searchParams.get('context')||'evidence';return responseJson({items:(await all(db,'SELECT * FROM uploads WHERE user_id=? AND context=? ORDER BY created_at DESC',actor.id,context)).map(uploadPayload)})}
  match=path.match(/^\/api\/uploads\/([^/]+)\/download$/);
  if(match&&method==='GET'){const row=await first(db,'SELECT * FROM uploads WHERE id=? AND user_id=?',decodeURIComponent(match[1]),actor.id);if(!row)return error('Saved file not found.',404);const object=await env.FILES.get(row.object_key);if(!object)return error('Saved file is unavailable.',404);return new Response(object.body,{headers:{'Content-Type':row.mime_type,'Content-Disposition':`attachment; filename="${cleanFilename(row.filename)}"`,'Cache-Control':'private, no-store'}})}
  match=path.match(/^\/api\/evidence\/([^/]+)$/);
  if(match&&method==='DELETE'){if(!env.FILES||typeof env.FILES.delete!=='function')return error('Object storage is not configured for this deployment.',503);const uploadId=decodeURIComponent(match[1]);const row=await first(db,"SELECT * FROM uploads WHERE id=? AND user_id=? AND context='evidence'",uploadId,actor.id);if(!row)return error('Saved evidence not found.',404);await env.FILES.delete(row.object_key);await run(db,'DELETE FROM uploads WHERE id=? AND user_id=?',uploadId,actor.id);return responseJson({deleted:true,id:uploadId})}
  if(path==='/api/saved-content'&&method==='GET'){const context=url.searchParams.get('context');if(!['assessment','coaching','development_plan'].includes(context))return error('Unsupported save context.',422);return responseJson({items:(await all(db,'SELECT * FROM saved_content WHERE user_id=? AND context=? ORDER BY created_at DESC',actor.id,context)).map(savedPayload)})}
  if(path==='/api/saved-content'&&method==='POST'){const body=await requestBody(request);if(!['assessment','development_plan'].includes(body.context))return error('Unsupported save context.',422);const savedId=id('saved');await run(db,'INSERT INTO saved_content (id,user_id,context,content_type,title,body,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)',savedId,actor.id,body.context,String(body.content_type||''),String(body.title||'Saved item').slice(0,200),String(body.body||''),JSON.stringify(body.metadata||{}),now());return responseJson({item:savedPayload(await first(db,'SELECT * FROM saved_content WHERE id=?',savedId))})}
  match=path.match(/^\/api\/development-plan-snapshots\/([^/]+)$/);
  if(match&&method==='DELETE'){
    const snapshotId=decodeURIComponent(match[1]);
    const item=await first(db,"SELECT id FROM saved_content WHERE id=? AND user_id=? AND context='development_plan'",snapshotId,actor.id);
    if(!item)return error('Saved development plan not found.',404);
    await run(db,"DELETE FROM saved_content WHERE id=? AND user_id=? AND context='development_plan'",snapshotId,actor.id);
    return responseJson({deleted:true});
  }
  match=path.match(/^\/api\/coaching\/summaries\/([^/]+)$/);
  if(match&&method==='PATCH'){
    const summaryId=decodeURIComponent(match[1]);
    const item=await first(db,"SELECT id FROM saved_content WHERE id=? AND user_id=? AND context='coaching' AND content_type='coaching_summary'",summaryId,actor.id);
    if(!item)return error('Saved coaching summary not found.',404);
    const body=await requestBody(request),title=typeof body.title==='string'?body.title.trim():'';
    if(!title||title.length>200)return error('Enter a name of up to 200 characters.',422);
    await run(db,"UPDATE saved_content SET title=? WHERE id=? AND user_id=? AND context='coaching' AND content_type='coaching_summary'",title,summaryId,actor.id);
    return responseJson({item:savedPayload(await first(db,'SELECT * FROM saved_content WHERE id=? AND user_id=?',summaryId,actor.id))});
  }
  if(match&&method==='DELETE'){
    const summaryId=decodeURIComponent(match[1]);
    const item=await first(db,"SELECT id FROM saved_content WHERE id=? AND user_id=? AND context='coaching' AND content_type='coaching_summary'",summaryId,actor.id);
    if(!item)return error('Saved coaching summary not found.',404);
    await run(db,"DELETE FROM saved_content WHERE id=? AND user_id=? AND context='coaching' AND content_type='coaching_summary'",summaryId,actor.id);
    return responseJson({deleted:true});
  }
  if(path==='/api/coaching/conversations'&&method==='GET')return responseJson({conversations:(await all(db,'SELECT * FROM conversations WHERE user_id=? ORDER BY updated_at DESC',actor.id)).map(conversationPayload)});
  if(path==='/api/coaching/conversations'&&method==='POST'){const body=await requestBody(request);const conversationId=id('conversation'),timestamp=now();await run(db,'INSERT INTO conversations (id,user_id,title,created_at,updated_at) VALUES (?,?,?,?,?)',conversationId,actor.id,String(body.title||'New coaching conversation').slice(0,200),timestamp,timestamp);return responseJson({conversation:conversationPayload(await first(db,'SELECT * FROM conversations WHERE id=?',conversationId))})}
  match=path.match(/^\/api\/coaching\/conversations\/([^/]+)$/);
  if(match&&method==='PATCH'){
    const conversationId=decodeURIComponent(match[1]);
    const conversation=await first(db,'SELECT id FROM conversations WHERE id=? AND user_id=?',conversationId,actor.id);
    if(!conversation)return error('Conversation not found.',404);
    const body=await requestBody(request),title=typeof body.title==='string'?body.title.trim():'';
    if(!title||title.length>200)return error('Enter a name of up to 200 characters.',422);
    await run(db,'UPDATE conversations SET title=? WHERE id=? AND user_id=?',title,conversationId,actor.id);
    return responseJson({conversation:conversationPayload(await first(db,'SELECT * FROM conversations WHERE id=? AND user_id=?',conversationId,actor.id))});
  }
  if(match&&method==='DELETE'){
    const conversationId=decodeURIComponent(match[1]);
    const conversation=await first(db,'SELECT id FROM conversations WHERE id=? AND user_id=?',conversationId,actor.id);
    if(!conversation)return error('Conversation not found.',404);
    await db.batch([
      db.prepare('DELETE FROM coaching_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE id=? AND user_id=?)').bind(conversationId,actor.id),
      db.prepare('DELETE FROM conversations WHERE id=? AND user_id=?').bind(conversationId,actor.id),
    ]);
    return responseJson({deleted:true});
  }
  if(match&&method==='GET'){const conversation=await first(db,'SELECT * FROM conversations WHERE id=? AND user_id=?',decodeURIComponent(match[1]),actor.id);if(!conversation)return error('Conversation not found.',404);return responseJson({conversation:conversationPayload(conversation),messages:(await all(db,'SELECT * FROM coaching_messages WHERE conversation_id=? ORDER BY created_at,id',conversation.id)).map(messagePayload)})}
  match=path.match(/^\/api\/coaching\/conversations\/([^/]+)\/messages$/);
  if(match&&method==='POST'){const conversation=await first(db,'SELECT * FROM conversations WHERE id=? AND user_id=?',decodeURIComponent(match[1]),actor.id);if(!conversation)return error('Conversation not found.',404);const body=await requestBody(request),content=String(body.content||'').trim();if(!content||content.length>10000)return error('Enter a coaching message of up to 10,000 characters.',422);const timestamp=now();await run(db,'INSERT INTO coaching_messages (id,conversation_id,author_role,message_type,content,generated,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)',id('message'),conversation.id,'user','chat',content,0,'{}',timestamp);const history=await all(db,"SELECT author_role,content FROM coaching_messages WHERE conversation_id=? AND message_type='chat' ORDER BY created_at,id",conversation.id);const ownContext=await coachingContext(db,actor);const selectedGaps=Array.isArray(body.selected_gaps)?body.selected_gaps.filter(gap=>typeof gap==='string').map(gap=>gap.slice(0,1000)):[];const prompt=`You are a private GROW development coach. Use only this signed-in pharmacist context and conversation. Never claim a formal assessment. Treat the selected gaps as the pharmacist's current focus areas, not as facts already discussed.\nContext: ${JSON.stringify(ownContext).slice(0,14000)}\nSelected focus areas: ${JSON.stringify(selectedGaps)}\nConversation: ${JSON.stringify(history).slice(0,14000)}\nReply with one concise reflective response and a practical next question.`;const reply=await openAiText(env,prompt);const messageId=id('message');await run(db,'INSERT INTO coaching_messages (id,conversation_id,author_role,message_type,content,generated,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)',messageId,conversation.id,'assistant','chat',reply,1,'{}',now());const title=conversation.title==='New coaching conversation'?(content.replace(/\s+/g,' ').slice(0,80)||conversation.title):conversation.title;await run(db,'UPDATE conversations SET title=?,updated_at=? WHERE id=? AND user_id=?',title,now(),conversation.id,actor.id);return responseJson({conversation:conversationPayload(await first(db,'SELECT * FROM conversations WHERE id=?',conversation.id)),message:messagePayload(await first(db,'SELECT * FROM coaching_messages WHERE id=?',messageId))})}
  match=path.match(/^\/api\/coaching\/conversations\/([^/]+)\/summary$/);
  if(match&&method==='POST'){const conversation=await first(db,'SELECT * FROM conversations WHERE id=? AND user_id=?',decodeURIComponent(match[1]),actor.id);if(!conversation)return error('Conversation not found.',404);const history=await all(db,"SELECT author_role,content FROM coaching_messages WHERE conversation_id=? AND message_type='chat' ORDER BY created_at,id",conversation.id);if(!history.length)return error('Start the conversation before requesting a summary.',409);const body=await requestBody(request);const selectedGaps=Array.isArray(body.selected_gaps)?body.selected_gaps.filter(gap=>typeof gap==='string').map(gap=>gap.slice(0,1000)):[];const content=await openAiText(env,`Summarise this private pharmacist coaching conversation concisely, without inventing facts. Include the agreed goal and next steps. Consider these user-selected development gaps as focus areas; do not imply they were discussed if they were not: ${JSON.stringify(selectedGaps)}\n${JSON.stringify(history).slice(0,22000)}`);const messageId=id('message'),metadata={action_items:['Agree one concrete next step and review it with the reporting officer.'],selected_gaps:selectedGaps};await run(db,'INSERT INTO coaching_messages (id,conversation_id,author_role,message_type,content,generated,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)',messageId,conversation.id,'assistant','summary',content,1,JSON.stringify(metadata),now());return responseJson({summary:messagePayload(await first(db,'SELECT * FROM coaching_messages WHERE id=?',messageId))})}
  match=path.match(/^\/api\/coaching\/conversations\/([^/]+)\/summaries\/([^/]+)\/save$/);
  if(match&&method==='POST'){const conversation=await first(db,'SELECT * FROM conversations WHERE id=? AND user_id=?',decodeURIComponent(match[1]),actor.id);if(!conversation)return error('Conversation not found.',404);const message=await first(db,"SELECT * FROM coaching_messages WHERE id=? AND conversation_id=? AND author_role='assistant' AND message_type='summary'",decodeURIComponent(match[2]),conversation.id);if(!message)return error('Generated summary not found.',404);const savedId=id('saved');await run(db,'INSERT INTO saved_content (id,user_id,context,content_type,title,body,metadata_json,created_at) VALUES (?,?,?,?,?,?,?,?)',savedId,actor.id,'coaching','coaching_summary',`Coaching summary · ${conversation.title}`,JSON.stringify({summary:message.content,action_items:textJson(message.metadata_json,{}).action_items||[]}),JSON.stringify({summary_message_id:message.id}),now());return responseJson({item:savedPayload(await first(db,'SELECT * FROM saved_content WHERE id=?',savedId))})}
  if(['/app','/team-dashboard','/division-dashboard','/reportee-assessment'].includes(path)&&method==='GET'){
    if(path==='/team-dashboard'&&!actor.teamAccess&&!actor.divisionAccess)return error('You do not have access to the Team Dashboard.',403);if(path==='/reportee-assessment'&&!actor.teamAccess&&!actor.divisionAccess)return error('You do not have access to Individual views.',403);if(path==='/division-dashboard'&&!actor.divisionAccess)return error('You do not have access to the Division Dashboard.',403);return embeddedAsset('/index.html');
  }
  return error('Not found',404);
}
