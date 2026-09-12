import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync, lstatSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Page } from "../folio/model.ts";
import { accessPolicy } from "./storage-node.ts";
import { requestDenied } from "./request-guard.ts";
import { TeamError, activity, allPages, fail, grantsFor, permissions, requirePage, safeUser, teamDatabase, teamMarkerExists, type UserRow } from "./team-db.ts";
import { changePassword, createUser, currentUser, limited, listMembers, login, logout, requireAdmin, updateUser, withUser } from "./team-auth.ts";
import { applyWorkspaceChanges, notify, restoreVersion, updateAccess, workspaceSnapshot } from "./team-pages.ts";

export function teamIsEnabled(): boolean {
  if(process.env.FOLIO_TEAM_AUTH==="1") return true;
  try{return teamMarkerExists();} catch{return true;} // A broken migrated database must never reopen the legacy endpoint.
}
const json=(body:unknown,status=200,headers:Record<string,string>={})=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",...headers}});
function transport(request:Request) {
  const origin=process.env.FOLIO_PUBLIC_ORIGIN;
  if(process.env.FOLIO_TEAM_DEV==="1" && process.env.NODE_ENV!=="production") {
    let expected:URL;
    try{expected=new URL(origin || "");}catch{fail(503,"Configure an exact local development origin.");}
    const actual=new URL(request.url),local=["localhost","127.0.0.1","[::1]"];
    if(expected.protocol!=="http:" || expected.origin!==origin || !local.includes(expected.hostname) || !local.includes(actual.hostname) || request.headers.get("host")!==expected.host) fail(403,"Invalid local workspace origin.");
    if((request.method!=="GET" && request.headers.get("origin")!==origin) || (request.headers.get("origin") && request.headers.get("origin")!==origin) || request.headers.get("sec-fetch-site")==="cross-site") fail(403,"A same-origin request is required.");
    return;
  }
  let reason:string|null;
  try{reason=requestDenied(request,accessPolicy());}catch{fail(503,"Hosted team access is not configured.");}
  if(reason) fail(403,reason);
}
async function bytes(request:Request,limit:number):Promise<Uint8Array> {
  const contentLength=request.headers.get("content-length");
  if(contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength)>limit)) { await request.body?.cancel().catch(()=>{});fail(413,"The request is too large."); }
  const reader=request.body?.getReader();if(!reader) fail(400,"A request body is required.");
  const chunks:Uint8Array[]=[];let size=0;
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit){await reader.cancel().catch(()=>{});fail(413,"The request is too large.");}chunks.push(next.value);}
  const output=new Uint8Array(size);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}return output;
}
async function body(request:Request,limit=128*1024) {
  if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))fail(415,"Expected JSON.");
  try{const value=JSON.parse(new TextDecoder().decode(await bytes(request,limit)));if(!value || typeof value!=="object" || Array.isArray(value))fail(400,"Expected a JSON object.");return value;}
  catch(error){if(error instanceof TeamError)throw error;fail(400,"Invalid JSON.");}
}
function fileRoot():string {
  const root=process.env.FOLIO_UPLOAD_PATH || path.join(path.dirname(process.env.FOLIO_DB_PATH || "/var/lib/folio/workspace.sqlite"),"uploads");
  if(!path.isAbsolute(root))fail(503,"Uploads need an absolute storage path.");
  mkdirSync(root,{recursive:true,mode:0o700});
  if(lstatSync(root).isSymbolicLink())fail(503,"Upload storage must not be a symbolic link.");
  return root;
}
function filePath(id:string):string {if(!/^[a-f0-9-]{36}$/.test(id))fail(404,"File not found.");return path.join(fileRoot(),id);}
function removeFile(id:string){try{unlinkSync(filePath(id));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")console.error("Could not remove a private file",id);}}
type FileRow={id:string;page_id:string;user_id:string;name:string;size:number;created_at:number;author_name?:string};
const filePublic=(row:FileRow)=>({id:row.id,pageId:row.page_id,userId:row.user_id,authorName:row.author_name,name:row.name,size:row.size,createdAt:row.created_at});
function files(db:DatabaseSync,user:UserRow,pageId:string){requirePage(db,user,pageId);return {files:(db.prepare("SELECT f.*,u.name AS author_name FROM team_files f JOIN team_users u ON u.id=f.user_id WHERE f.page_id=? ORDER BY f.created_at DESC").all(pageId) as FileRow[]).map(filePublic)};}

type CommentRow={id:string;page_id:string;user_id:string;author_name:string;body:string;parent_id:string|null;mentions:string;resolved:number;created_at:number};
const commentPublic=(row:CommentRow)=>({id:row.id,pageId:row.page_id,userId:row.user_id,authorName:row.author_name,body:row.body,parentId:row.parent_id,mentions:JSON.parse(row.mentions) as string[],resolved:Boolean(row.resolved),createdAt:row.created_at});
function comments(db:DatabaseSync,user:UserRow,pageId:string){requirePage(db,user,pageId);return {comments:(db.prepare("SELECT c.*,u.name AS author_name FROM team_comments c JOIN team_users u ON u.id=c.user_id WHERE c.page_id=? ORDER BY c.created_at,c.rowid").all(pageId) as CommentRow[]).map(commentPublic)};}
function addComment(db:DatabaseSync,user:UserRow,pageId:string,input:{body?:unknown;parentId?:unknown;mentions?:unknown}) {
  requirePage(db,user,pageId,"edit");limited(db,"comment",user.id,40);
  if(typeof input.body!=="string" || !input.body.trim() || input.body.length>10000 || (input.parentId!==undefined && input.parentId!==null && typeof input.parentId!=="string"))fail(400,"Enter a comment of up to 10,000 characters.");
  const parent=input.parentId?db.prepare("SELECT id,user_id FROM team_comments WHERE id=? AND page_id=?").get(String(input.parentId),pageId) as {id:string;user_id:string}|undefined:undefined;
  if(input.parentId && !parent)fail(400,"The comment thread no longer exists.");
  if(input.mentions!==undefined && (!Array.isArray(input.mentions) || input.mentions.length>20 || input.mentions.some((id)=>typeof id!=="string")))fail(400,"Invalid mentions.");
  const recipients=[...new Set((input.mentions || []) as string[])];
  for(const id of recipients){const target=db.prepare("SELECT * FROM team_users WHERE id=? AND disabled=0").get(id) as UserRow|undefined;if(!target)fail(400,"A mentioned account is unavailable.");requirePage(db,target,pageId);}
  db.prepare("INSERT INTO team_comments (id,page_id,user_id,body,parent_id,mentions,created_at) VALUES (?,?,?,?,?,?,?)").run(randomUUID(),pageId,user.id,input.body.trim(),parent?.id||null,JSON.stringify(recipients),Date.now());
  for(const id of recipients)notify(db,user,id,pageId,"mention","Mentioned you in a comment");
  if(parent)notify(db,user,parent.user_id,pageId,"reply","Replied to your comment");
  const owner=requirePage(db,user,pageId).owner_id;notify(db,user,owner,pageId,"comment","Added a comment to your page");
  activity(db,user.id,pageId,"comment.created");return comments(db,user,pageId);
}
function history(db:DatabaseSync,user:UserRow,pageId:string){requirePage(db,user,pageId);return {history:(db.prepare("SELECT h.id,h.revision,h.user_id,h.created_at,h.data,u.name AS author_name FROM team_history h JOIN team_users u ON u.id=h.user_id WHERE h.page_id=? ORDER BY h.created_at DESC,h.rowid DESC LIMIT 100").all(pageId) as {id:string;revision:number;user_id:string;created_at:number;data:string;author_name:string}[]).map((row)=>({id:row.id,revision:row.revision,userId:row.user_id,authorName:row.author_name,createdAt:row.created_at,title:(JSON.parse(row.data) as Page).title}))};}
function notifications(db:DatabaseSync,user:UserRow){const pages=allPages(db);return {notifications:(db.prepare("SELECT n.*,u.name AS actor_name FROM team_notifications n JOIN team_users u ON u.id=n.actor_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 200").all(user.id) as {id:string;page_id:string;actor_id:string;actor_name:string;kind:string;message:string;read_at:number|null;created_at:number}[]).filter((row)=>{const page=pages.get(row.page_id);return page && permissions(db,user,page,pages).read;}).map((row)=>({id:row.id,pageId:row.page_id,actorId:row.actor_id,actorName:row.actor_name,kind:row.kind,message:row.message,readAt:row.read_at,createdAt:row.created_at}))};}
function activityList(db:DatabaseSync,user:UserRow){const pages=allPages(db);return {activity:(db.prepare("SELECT a.*,u.name AS actor_name FROM team_activity a JOIN team_users u ON u.id=a.actor_id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 500").all() as {id:string;page_id:string|null;actor_id:string;actor_name:string;action:string;detail:string;created_at:number}[]).filter((row)=>row.page_id?Boolean(pages.get(row.page_id)&&permissions(db,user,pages.get(row.page_id)!,pages).read):["owner","admin"].includes(user.role)).slice(0,100).map((row)=>({id:row.id,pageId:row.page_id,actorId:row.actor_id,actorName:row.actor_name,action:row.action,detail:row.detail,createdAt:row.created_at}))};}

export async function handleTeamRequest(request:Request):Promise<Response> {
  try{
    const url=new URL(request.url),parts=url.pathname.replace(/^\/api\/team\/?/,"").split("/").filter(Boolean).map(decodeURIComponent),route=parts.join("/"),method=request.method;
    if(!teamIsEnabled())return route==="session"?json({enabled:false}):json({error:"Team accounts are not enabled."},404);
    transport(request);
    const db=await teamDatabase();
    if(route==="login"&&method==="POST"){const result=await login(db,request,await body(request));return json(result.body,200,{"Set-Cookie":result.cookie});}
    if(route==="logout"&&method==="POST"){const result=logout(db,request);await request.body?.cancel().catch(()=>{});return json(result.body,200,{"Set-Cookie":result.cookie});}
    if(route==="session"&&method==="GET"){
      let user:UserRow;
      try{user=currentUser(db,request,true);}catch(error){if(error instanceof TeamError && error.status===401)return json({enabled:true,user:null,members:[]});throw error;}
      return json({enabled:true,user:safeUser(user),members:user.must_change?[]:listMembers(db)});
    }
    if(route==="password"&&method==="POST"){const result=await changePassword(db,request,await body(request));return json(result.body,200,{"Set-Cookie":result.cookie});}
    const user=currentUser(db,request);
    if(route==="workspace"&&method==="GET")return json(workspaceSnapshot(db,user));
    if(route==="workspace"&&method==="POST"){
      const input=await body(request,10*1024*1024);
      const result=withUser(db,request,(actor)=>{limited(db,"workspace",actor.id,180);return applyWorkspaceChanges(db,actor,input);});
      result.removedFileIds.forEach(removeFile);return json(result.snapshot);
    }
    if(route==="preferences"&&method==="POST"){
      const input=await body(request);return json(withUser(db,request,(actor)=>{
        if(typeof input.pageId!=="string" || typeof input.favorite!=="boolean")fail(400,"Invalid page preference.");
        requirePage(db,actor,input.pageId);
        if(input.favorite)db.prepare("INSERT OR IGNORE INTO team_favorites (page_id,user_id) VALUES (?,?)").run(input.pageId,actor.id);
        else db.prepare("DELETE FROM team_favorites WHERE page_id=? AND user_id=?").run(input.pageId,actor.id);
        return workspaceSnapshot(db,actor);
      }));
    }
    if(route==="users"&&method==="GET"){requireAdmin(user);return json({users:(db.prepare("SELECT * FROM team_users ORDER BY created_at").all() as UserRow[]).map(safeUser)});}
    if(route==="users"&&method==="POST")return json(await createUser(db,request,await body(request)),201);
    if(parts[0]==="users"&&parts.length===2&&method==="PATCH")return json(await updateUser(db,request,parts[1],await body(request)));
    if(parts[0]==="pages"&&parts.length===3){
      const pageId=parts[1],action=parts[2];
      if(action==="comments"&&method==="GET")return json(comments(db,user,pageId));
      if(action==="comments"&&method==="POST"){const input=await body(request);return json(withUser(db,request,(actor)=>addComment(db,actor,pageId,input)),201);}
      if(action==="history"&&method==="GET")return json(history(db,user,pageId));
      if(action==="restore"&&method==="POST"){const input=await body(request);return json(withUser(db,request,(actor)=>restoreVersion(db,actor,pageId,input)));}
      if(action==="access"&&method==="GET"){const row=requirePage(db,user,pageId);return json({access:{ownerId:row.owner_id,visibility:row.visibility,grants:grantsFor(db,pageId),inherited:Boolean((JSON.parse(row.data) as Page).parentId),accessRevision:row.access_revision}});}
      if(action==="access"&&method==="PATCH"){const input=await body(request);return json(withUser(db,request,(actor)=>updateAccess(db,actor,pageId,input)));}
      if(action==="files"&&method==="GET")return json(files(db,user,pageId));
      if(action==="files"&&method==="POST"){
        requirePage(db,user,pageId,"edit");limited(db,"upload",user.id,20);
        let name:string;try{name=decodeURIComponent(request.headers.get("x-folio-filename")||"").normalize("NFC");}catch{fail(400,"Invalid filename.");}
        if(!name || name.length>180 || /[\x00-\x1f\x7f/\\]/.test(name) || name==="." || name==="..")fail(400,"Choose a filename of up to 180 characters without path separators.");
        const data=await bytes(request,10*1024*1024);if(!data.length)fail(400,"The file is empty.");
        const id=randomUUID(),file=filePath(id);
        try{
          writeFileSync(file,data,{flag:"wx",mode:0o600});
          return json(withUser(db,request,(actor)=>{
            requirePage(db,actor,pageId,"edit");
            const used=(db.prepare("SELECT COALESCE(sum(size),0) AS used FROM team_files").get() as {used:number}).used;
            const count=(db.prepare("SELECT count(*) AS count FROM team_files WHERE page_id=?").get(pageId) as {count:number}).count;
            if(used+data.length>512*1024*1024 || count>=100)fail(413,"The workspace file quota (512 MB or 100 files per page) is full.");
            db.prepare("INSERT INTO team_files (id,page_id,user_id,name,size,created_at) VALUES (?,?,?,?,?,?)").run(id,pageId,actor.id,name,data.length,Date.now());
            activity(db,actor.id,pageId,"file.uploaded",name);return files(db,actor,pageId);
          }),201);
        }catch(error){removeFile(id);throw error;}
      }
      if(action==="presence"&&(method==="POST"||method==="GET")){
        if(method==="POST"){await request.body?.cancel().catch(()=>{});withUser(db,request,(actor)=>{requirePage(db,actor,pageId);db.prepare("INSERT INTO team_presence (page_id,user_id,seen_at) VALUES (?,?,?) ON CONFLICT(page_id,user_id) DO UPDATE SET seen_at=excluded.seen_at").run(pageId,actor.id,Date.now());});}
        const active=currentUser(db,request),pages=allPages(db),page=requirePage(db,active,pageId,"read",pages);
        const present=db.prepare("SELECT u.*,p.seen_at AS seenAt FROM team_presence p JOIN team_users u ON u.id=p.user_id WHERE p.page_id=? AND p.seen_at>? AND u.disabled=0").all(pageId,Date.now()-45_000) as (UserRow&{seenAt:number})[];
        return json({presence:present.filter((person)=>!person.must_change&&permissions(db,person,page,pages).read).map((person)=>({id:person.id,name:person.name,username:person.username,seenAt:person.seenAt}))});
      }
    }
    if(parts[0]==="comments"&&parts.length===2&&method==="PATCH"){
      const input=await body(request);return json(withUser(db,request,(actor)=>{
        const comment=db.prepare("SELECT * FROM team_comments WHERE id=?").get(parts[1]) as CommentRow|undefined;if(!comment)fail(404,"Comment not found.");
        requirePage(db,actor,comment.page_id,"edit");if(typeof input.resolved!=="boolean")fail(400,"Invalid comment state.");
        db.prepare("UPDATE team_comments SET resolved=? WHERE id=? OR parent_id=?").run(Number(input.resolved),comment.id,comment.id);
        activity(db,actor.id,comment.page_id,input.resolved?"comment.resolved":"comment.reopened");return comments(db,actor,comment.page_id);
      }));
    }
    if(parts[0]==="files"&&parts.length===2&&(method==="GET"||method==="DELETE")){
      const record=db.prepare("SELECT * FROM team_files WHERE id=?").get(parts[1]) as FileRow|undefined;if(!record)fail(404,"File not found.");
      requirePage(db,user,record.page_id,method==="GET"?"read":"edit");
      if(method==="GET"){
        const file=filePath(record.id);let data:Buffer;try{if(lstatSync(file).isSymbolicLink())fail(404,"File unavailable.");data=readFileSync(file);}catch(error){if(error instanceof TeamError)throw error;fail(404,"File unavailable.");}
        return new Response(new Uint8Array(data),{headers:{"Content-Type":"application/octet-stream","Content-Disposition":`attachment; filename*=UTF-8''${encodeURIComponent(record.name).replace(/'/g,"%27")}`,"Content-Length":String(data.length),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"}});
      }
      withUser(db,request,(actor)=>{requirePage(db,actor,record.page_id,"edit");db.prepare("DELETE FROM team_files WHERE id=?").run(record.id);activity(db,actor.id,record.page_id,"file.deleted",record.name);});removeFile(record.id);return json({ok:true});
    }
    if(route==="notifications"&&method==="GET")return json(notifications(db,user));
    if(route==="notifications"&&method==="PATCH"){
      const input=await body(request);return json(withUser(db,request,(actor)=>{
        if(input.id!==undefined && typeof input.id!=="string")fail(400,"Invalid notification.");
        if(input.id)db.prepare("UPDATE team_notifications SET read_at=? WHERE id=? AND user_id=?").run(Date.now(),input.id,actor.id);
        else db.prepare("UPDATE team_notifications SET read_at=? WHERE user_id=? AND read_at IS NULL").run(Date.now(),actor.id);
        return notifications(db,actor);
      }));
    }
    if(route==="activity"&&method==="GET")return json(activityList(db,user));
    if(!request.bodyUsed)await request.body?.cancel().catch(()=>{});
    return json({error:"Endpoint not found."},404);
  }catch(error){
    if(!request.bodyUsed)await request.body?.cancel().catch(()=>{});
    if(error instanceof TeamError)return json({error:error.message,...(error.code?{code:error.code}:{})},error.status,error.status===429?{"Retry-After":"60"}:{});
    console.error("Team request failed",error instanceof Error?error.message:"Unknown error");
    return json({error:"The team workspace is temporarily unavailable."},503);
  }
}
