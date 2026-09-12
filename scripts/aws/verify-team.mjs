import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";

const directory=mkdtempSync(path.join(tmpdir(),"folio-team-http-"));
const port=process.env.FOLIO_TEAM_TEST_PORT||"5339";
const target=`http://127.0.0.1:${port}`;
const origin="https://folio-team.test",proxyKey=randomBytes(32).toString("hex");
const initialPassword=randomBytes(24).toString("base64url"),ownerPassword=randomBytes(24).toString("base64url");
const server=spawn(process.execPath,[".next/standalone/server.js"],{
  env:{...process.env,NODE_ENV:"production",HOSTNAME:"127.0.0.1",PORT:port,FOLIO_DB_PATH:path.join(directory,"workspace.sqlite"),FOLIO_UPLOAD_PATH:path.join(directory,"uploads"),FOLIO_TEAM_AUTH:"1",FOLIO_TEAM_DEV:"0",FOLIO_PUBLIC_ORIGIN:origin,FOLIO_PROXY_KEY:proxyKey,FOLIO_OWNER_USERNAME:"http-owner",FOLIO_OWNER_PASSWORD:initialPassword},
  stdio:["ignore","pipe","pipe"],
});
let output="";
for(const stream of [server.stdout,server.stderr])stream.on("data",(chunk)=>{output=(output+chunk).slice(-12000);});
function request(route,method="GET",input,actor,extra={}){
  return new Promise((resolve,reject)=>{
    const headers={Host:new URL(origin).host,"X-Forwarded-Proto":"https","X-Folio-Proxy-Key":proxyKey,...(method!=="GET"?{Origin:origin}:{}),...(actor?.cookie?{Cookie:actor.cookie}:{}),...(actor?.id?{"X-Folio-User":actor.id}:{}),...extra};
    const body=input===undefined?undefined:JSON.stringify(input);
    if(body!==undefined){headers["Content-Type"]="application/json";headers["Content-Length"]=Buffer.byteLength(body);}
    const req=httpRequest(new URL(route,target),{method,headers,agent:false},(response)=>{
      const chunks=[];response.on("data",(chunk)=>chunks.push(chunk));response.on("error",reject);
      response.on("end",()=>{
        try{
          const raw=Buffer.concat(chunks).toString("utf8");
          const data=response.headers["content-type"]?.includes("json")?JSON.parse(raw):null;
          const setCookie=response.headers["set-cookie"]?.[0];
          if(actor&&setCookie)actor.cookie=setCookie.split(";")[0];
          if(actor&&data?.user?.id&&["/api/team/login","/api/team/password","/api/team/session"].includes(route))actor.id=data.user.id;
          resolve({status:response.statusCode,data,headers:response.headers});
        }catch(error){reject(error);}
      });
    });
    req.setTimeout(10000,()=>req.destroy(new Error("Team HTTP request timed out")));
    req.on("error",reject);req.end(body);
  });
}
const api=(route,...args)=>request(`/api/team/${route}`,...args);
const check=(response,status)=>assert.equal(response.status,status,response.data?.error);
try{
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){
    if(server.exitCode!==null)throw new Error(`Team server exited before readiness: ${output}`);
    try{const response=await api("session");if(response.status===200&&response.data.enabled){ready=true;break;}}catch{}
    await new Promise((resolve)=>setTimeout(resolve,250));
  }
  assert.ok(ready,`Team server did not become ready: ${output}`);
  const anonymous=await api("session");check(anonymous,200);assert.equal(anonymous.data.user,null);
  check(await api("workspace"),401);
  check(await request("/api/workspace"),403);
  check(await api("session","GET",undefined,undefined,{"X-Folio-Proxy-Key":""}),403);
  check(await api("login","POST",{username:"http-owner",password:initialPassword},undefined,{Origin:"https://untrusted.example"}),403);
  const owner={cookie:""};
  const signedIn=await api("login","POST",{username:"http-owner",password:initialPassword},owner);check(signedIn,200);assert.equal(signedIn.data.user.mustChangePassword,true);
  const cookie=signedIn.headers["set-cookie"][0];assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);
  const forced=await api("workspace","GET",undefined,owner);check(forced,403);assert.equal(forced.data.code,"password_change_required");
  check(await api("password","POST",{currentPassword:initialPassword,newPassword:ownerPassword},owner),200);
  const initial=await api("workspace","GET",undefined,owner);check(initial,200);assert.ok(initial.data.workspace.pages.length>=2);
  assert.ok(Object.values(initial.data.access).every((access)=>access.visibility==="private"));
  const viewerInitial=randomBytes(24).toString("base64url"),viewerPassword=randomBytes(24).toString("base64url");
  const created=await api("users","POST",{username:"http-viewer",name:"HTTP viewer",role:"viewer",password:viewerInitial},owner);check(created,201);
  const viewer={cookie:""};check(await api("login","POST",{username:"http-viewer",password:viewerInitial},viewer),200);
  check(await api("password","POST",{currentPassword:viewerInitial,newPassword:viewerPassword},viewer),200);
  const privateView=await api("workspace","GET",undefined,viewer);check(privateView,200);assert.equal(privateView.data.workspace.pages.length,0);
  const roots=initial.data.workspace.pages.filter((page)=>!page.parentId),page=roots[0],other=roots[1];assert.ok(other);
  check(await api(`pages/${page.id}/access`,"PATCH",{visibility:"private",grants:[{userId:created.data.user.id,role:"editor"}],baseRevision:initial.data.access[page.id].accessRevision},owner),200);
  const shared=await api("workspace","GET",undefined,viewer);check(shared,200);assert.ok(shared.data.workspace.pages.some((item)=>item.id===page.id));
  check(await api("workspace","POST",{changes:[{page:{...page,title:"Forbidden viewer edit"},baseRevision:shared.data.pageRevisions[page.id]}]},viewer),403);
  const crossed=await api("workspace","POST",{theme:"dark"},{...viewer,cookie:owner.cookie});check(crossed,409);assert.equal(crossed.data.code,"account_changed");
  check(await api("workspace","POST",{theme:"dark"},owner,{"X-Folio-User":""}),403);
  const parallel=await Promise.all([
    api("workspace","POST",{changes:[{page:{...page,title:"Concurrent first page"},baseRevision:initial.data.pageRevisions[page.id]}]},owner),
    api("workspace","POST",{changes:[{page:{...other,title:"Concurrent second page"},baseRevision:initial.data.pageRevisions[other.id]}]},owner),
  ]);parallel.forEach((result)=>check(result,200));
  check(await api("workspace","POST",{changes:[{page:{...page,title:"Stale overwrite"},baseRevision:initial.data.pageRevisions[page.id]}]},owner),409);
  const saved=await api("workspace","GET",undefined,owner);check(saved,200);
  assert.equal(saved.data.workspace.pages.find((item)=>item.id===page.id).title,"Concurrent first page");
  assert.equal(saved.data.workspace.pages.find((item)=>item.id===other.id).title,"Concurrent second page");
  const access=saved.data.access[page.id];
  check(await api(`pages/${page.id}/access`,"PATCH",{visibility:"private",grants:[],baseRevision:access.accessRevision},owner),200);
  check(await api(`pages/${page.id}/history`,"GET",undefined,viewer),404);
  check(await api("workspace","POST",{theme:"light"},owner,{Origin:"https://untrusted.example"}),403);
  check(await api("workspace","GET",undefined,owner),200);
  check(await api("logout","POST",{},owner),200);
  check(await api("workspace","GET",undefined,owner),401);
  console.log("AWS compiled team HTTP checks passed: private migration, native sessions, roles, sharing, concurrent saves, revocation and origin boundaries");
}finally{
  if(server.exitCode===null&&server.signalCode===null){
    const stopped=once(server,"exit");server.kill("SIGTERM");
    const timer=setTimeout(()=>server.kill("SIGKILL"),10000);timer.unref();
    await stopped;clearTimeout(timer);
  }
  rmSync(directory,{recursive:true,force:true});
}
