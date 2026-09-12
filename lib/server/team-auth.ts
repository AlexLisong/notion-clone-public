import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { digest, hashPassword, randomToken, validPassword, verifyPassword } from "./team-crypto.ts";
import { activity, fail, safeUser, transaction, type UserRow, type Role } from "./team-db.ts";

export const SESSION_COOKIE="folio_session";
const SESSION_AGE=7*24*60*60*1000;
let passwordsInFlight=0;
async function boundedPassword<T>(run:()=>Promise<T>):Promise<T> {
  if (passwordsInFlight>=4) fail(429,"Please wait before trying again.");
  passwordsInFlight++;
  try{return await run();} finally{passwordsInFlight--;}
}
export function sessionHash(request:Request):string|undefined {
  const cookies=request.headers.get("cookie") || "";
  const token=cookies.split(";").map((item)=>item.trim()).find((item)=>item.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? digest(token) : undefined;
}
export function currentUser(db:DatabaseSync,request:Request,allowPasswordChange=false):UserRow {
  const token=sessionHash(request);
  const user=token ? db.prepare("SELECT u.* FROM team_users u JOIN team_sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0").get(token,Date.now()) as UserRow|undefined : undefined;
  if(!user) fail(401,"Sign in to continue.","unauthenticated");
  const expectedUser=request.headers.get("x-folio-user");
  if(request.method!=="GET" && !expectedUser)fail(403,"The request must identify the signed-in account.","actor_required");
  if((!allowPasswordChange || request.method!=="GET") && expectedUser && expectedUser!==user.id)fail(409,"Your signed-in account changed. Reload before continuing.","account_changed");
  if(user.must_change && !allowPasswordChange) fail(403,"Change your temporary password before opening the workspace.","password_change_required");
  return user;
}
export function withUser<T>(db:DatabaseSync,request:Request,run:(user:UserRow)=>T,allowPasswordChange=false):T {
  return transaction(db,()=>run(currentUser(db,request,allowPasswordChange)));
}
export function cookie(token:string,clear=false):string {
  const secure=process.env.FOLIO_TEAM_DEV!=="1" || process.env.NODE_ENV==="production" || !/^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(process.env.FOLIO_PUBLIC_ORIGIN||"");
  return `${SESSION_COOKIE}=${clear?"":token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear?0:SESSION_AGE/1000}${secure?"; Secure":""}`;
}
function rate(db:DatabaseSync,key:string,limit:number,windowMs:number) {
  const now=Date.now();
  db.prepare("DELETE FROM team_rate WHERE reset_at<?").run(now);
  db.prepare("INSERT INTO team_rate (key,count,reset_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1").run(key,now+windowMs);
  const row=db.prepare("SELECT count FROM team_rate WHERE key=?").get(key) as {count:number};
  if(row.count>limit) fail(429,"Too many attempts. Please wait and try again.");
}
export function limited(db:DatabaseSync,scope:string,userId:string,limit=60) { rate(db,digest(`${scope}:${userId}`),limit,60_000); }
export function listMembers(db:DatabaseSync) {
  return (db.prepare("SELECT * FROM team_users WHERE disabled=0 ORDER BY name COLLATE NOCASE").all() as UserRow[]).map(safeUser);
}
export async function login(db:DatabaseSync,request:Request,body:{username?:unknown;password?:unknown}) {
  const candidate=typeof body.username==="string" ? body.username.trim().toLowerCase() : "";
  const username=/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(candidate)?candidate:"";
  const ip=request.headers.get("x-forwarded-for") || new URL(request.url).hostname;
  // Limits are committed even when the password is invalid; keys never contain usernames/IPs.
  rate(db,digest(`login-global`),300,60_000);
  rate(db,digest(`login-ip:${ip}`),30,15*60_000);
  rate(db,digest(`login-name:${username}`),10,15*60_000);
  if(typeof body.password!=="string" || body.password.length>128) fail(401,"Invalid username or password.");
  const row=db.prepare("SELECT * FROM team_users WHERE username=?").get(username) as UserRow|undefined;
  // A fixed valid-format hash gives missing users the same expensive verification path.
  const dummy=`scrypt:${"00".repeat(16)}:${"00".repeat(64)}`;
  const verified=await boundedPassword(()=>verifyPassword(body.password as string,row?.password_hash || dummy));
  if(!row || !verified || row.disabled) fail(401,"Invalid username or password.");
  return transaction(db,()=>{
    const current=db.prepare("SELECT * FROM team_users WHERE id=?").get(row.id) as UserRow|undefined;
    if(!current || current.disabled || current.password_hash!==row.password_hash) fail(401,"Invalid username or password.");
    const token=randomToken(),now=Date.now();
    db.prepare("DELETE FROM team_sessions WHERE expires_at<?").run(now);
    db.prepare("INSERT INTO team_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(digest(token),current.id,now+SESSION_AGE);
    db.prepare("DELETE FROM team_sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM team_sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 10)").run(current.id,current.id);
    activity(db,current.id,null,"account.login");
    return {body:{enabled:true,user:safeUser(current),members:current.must_change?[]:listMembers(db)},cookie:cookie(token)};
  });
}
export function logout(db:DatabaseSync,request:Request) {
  const hash=sessionHash(request);
  if(hash) db.prepare("DELETE FROM team_sessions WHERE token_hash=?").run(hash);
  return {body:{ok:true},cookie:cookie("",true)};
}
export async function changePassword(db:DatabaseSync,request:Request,body:{currentPassword?:unknown;newPassword?:unknown}) {
  const initial=currentUser(db,request,true);
  limited(db,"password",initial.id,5);
  if(typeof body.currentPassword!=="string" || body.currentPassword.length>128 || !validPassword(body.newPassword)) fail(400,"Enter your current password and a new password of 12–128 characters.");
  if(body.currentPassword===body.newPassword) fail(400,"Choose a different password.");
  const verified=await boundedPassword(()=>verifyPassword(body.currentPassword as string,initial.password_hash));
  if(!verified) fail(400,"Your current password is incorrect.");
  const hashed=await boundedPassword(()=>hashPassword(body.newPassword as string));
  return withUser(db,request,(user)=>{
    if(user.password_hash!==initial.password_hash) fail(409,"Your password changed. Sign in again.");
    db.prepare("UPDATE team_users SET password_hash=?,must_change=0 WHERE id=?").run(hashed,user.id);
    db.prepare("DELETE FROM team_sessions WHERE user_id=?").run(user.id);
    const token=randomToken();
    db.prepare("INSERT INTO team_sessions (token_hash,user_id,expires_at) VALUES (?,?,?)").run(digest(token),user.id,Date.now()+SESSION_AGE);
    activity(db,user.id,null,"account.password_changed");
    return {body:{ok:true,user:safeUser({...user,must_change:0})},cookie:cookie(token)};
  },true);
}
export function requireAdmin(user:UserRow) {
  if(!["owner","admin"].includes(user.role)) fail(403,"Administrator access is required.");
}
function allowedRole(actor:UserRow,value:unknown):Role {
  if(!["admin","member","viewer"].includes(String(value)) || (actor.role!=="owner" && value==="admin")) fail(403,"You cannot assign that role.");
  return value as Role;
}
export async function createUser(db:DatabaseSync,request:Request,body:{username?:unknown;name?:unknown;role?:unknown;password?:unknown}) {
  const initial=currentUser(db,request);requireAdmin(initial);limited(db,"users",initial.id,15);
  const username=typeof body.username==="string"?body.username.trim().toLowerCase():"";
  const name=typeof body.name==="string"?body.name.trim():"";
  if(!/^[a-z0-9][a-z0-9_.-]{2,39}$/.test(username) || !name || name.length>100 || !validPassword(body.password)) fail(400,"Use a 3–40 character username, a display name, and a password of 12–128 characters.");
  const role=allowedRole(initial,body.role??"member"),hashed=await boundedPassword(()=>hashPassword(body.password as string));
  return withUser(db,request,(actor)=>{
    requireAdmin(actor);allowedRole(actor,role);
    if(db.prepare("SELECT id FROM team_users WHERE username=?").get(username)) fail(409,"That username is already in use.");
    if((db.prepare("SELECT count(*) AS count FROM team_users").get() as {count:number}).count>=200) fail(400,"This workspace supports up to 200 accounts.");
    const id=randomUUID();
    db.prepare("INSERT INTO team_users (id,username,name,role,password_hash,must_change,created_at) VALUES (?,?,?,?,?,1,?)").run(id,username,name,role,hashed,Date.now());
    activity(db,actor.id,null,"account.created",username);
    return {user:safeUser(db.prepare("SELECT * FROM team_users WHERE id=?").get(id) as UserRow)};
  });
}
export async function updateUser(db:DatabaseSync,request:Request,id:string,body:{name?:unknown;role?:unknown;disabled?:unknown;password?:unknown}) {
  const initial=currentUser(db,request);requireAdmin(initial);limited(db,"users",initial.id,15);
  let hashed:string|undefined;
  if(body.password!==undefined) {
    if(!validPassword(body.password)) fail(400,"Passwords must contain 12–128 characters.");
    hashed=await boundedPassword(()=>hashPassword(body.password as string));
  }
  return withUser(db,request,(actor)=>{
    requireAdmin(actor);
    const target=db.prepare("SELECT * FROM team_users WHERE id=?").get(id) as UserRow|undefined;
    if(!target) fail(404,"Account not found.");
    if(target.role==="owner" && actor.id!==target.id) fail(403,"Only the owner can update the owner account.");
    if(actor.role!=="owner" && ["owner","admin"].includes(target.role)) fail(403,"Only the owner can manage administrators.");
    if(target.role==="owner" && (body.disabled===true || (body.role!==undefined && body.role!=="owner"))) fail(400,"The owner account must remain active and retain its role.");
    if(actor.id===target.id && (body.disabled===true || hashed)) fail(400,"Use your password settings; you cannot reset or disable your current account.");
    const name=body.name===undefined?target.name:typeof body.name==="string"?body.name.trim():"";
    if(!name || name.length>100) fail(400,"Enter a display name of up to 100 characters.");
    const role=body.role===undefined?target.role:target.role==="owner"&&body.role==="owner"?"owner":allowedRole(actor,body.role);
    if(body.disabled!==undefined && typeof body.disabled!=="boolean") fail(400,"Invalid account status.");
    const disabled=body.disabled===undefined?target.disabled:Number(body.disabled);
    db.prepare("UPDATE team_users SET name=?,role=?,disabled=?,password_hash=?,must_change=? WHERE id=?").run(name,role,disabled,hashed||target.password_hash,hashed?1:target.must_change,id);
    if(hashed || disabled || role!==target.role) db.prepare("DELETE FROM team_sessions WHERE user_id=?").run(id);
    activity(db,actor.id,null,hashed?"account.password_reset":disabled?"account.disabled":"account.updated",target.username);
    return {user:safeUser(db.prepare("SELECT * FROM team_users WHERE id=?").get(id) as UserRow)};
  });
}
