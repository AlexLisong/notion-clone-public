import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { handleTeamRequest, teamIsEnabled } from "../lib/server/team-node.ts";
import { closeTeamDatabase, teamDatabase } from "../lib/server/team-db.ts";
import { createSeed } from "../lib/folio/seed.ts";
import { newPage, type Workspace } from "../lib/folio/model.ts";

type User={id:string;username:string;role:string;mustChangePassword:boolean};
type Access={ownerId:string;visibility:string;grants:{userId:string;role:string}[];accessRevision:number};
type Payload={error?:string;code?:string;enabled?:boolean;user?:User|null;members?:User[];workspace?:Workspace;pageRevisions?:Record<string,number>;access?:Record<string,Access>|Access;comments?:{id:string;body:string;resolved:boolean}[];history?:{id:string;title:string}[];files?:{id:string;name:string}[];notifications?:{id:string}[];users?:User[];presence?:{id:string}[]};
type Actor={cookie:string;id:string;username:string};
const proxy="team-test-proxy-key-".repeat(4),origin="https://folio.test";
async function api(route:string,method="GET",input?:unknown,actor?:Actor,extra:Record<string,string>={}) {
  const headers:Record<string,string>={Host:"folio.test","X-Forwarded-Proto":"https","X-Folio-Proxy-Key":proxy,...(method!=="GET"?{Origin:origin}:{}),...(actor?{Cookie:actor.cookie,"X-Folio-User":actor.id}:{}),...extra};
  let body:BodyInit|undefined;
  if(input!==undefined){if(typeof input==="string"&&extra["X-Folio-Filename"]){body=input;}else{headers["Content-Type"]="application/json";body=JSON.stringify(input);}}
  const response=await handleTeamRequest(new Request(`${origin}/api/team/${route}`,{method,headers,body}));
  if(actor&&response.headers.get("set-cookie"))actor.cookie=response.headers.get("set-cookie")!.split(";")[0];
  const data=response.headers.get("content-type")?.includes("json")?await response.clone().json() as Payload:{};
  return {response,status:response.status,data};
}
async function signin(username:string,password:string):Promise<Actor>{
  const result=await api("login","POST",{username,password});assert.equal(result.status,200,result.data.error);
  const actor={cookie:result.response.headers.get("set-cookie")!.split(";")[0],id:result.data.user!.id,username};
  assert.match(result.response.headers.get("set-cookie")!,/HttpOnly/);assert.match(result.response.headers.get("set-cookie")!,/Secure/);
  return actor;
}

test("team account lifecycle, page isolation, optimistic edits and current ACLs",async(t)=>{
  const directory=mkdtempSync(path.join(tmpdir(),"folio-team-test-"));
  const oldEnvironment={...process.env};
  Object.assign(process.env,{FOLIO_TEAM_AUTH:"1",FOLIO_PUBLIC_ORIGIN:origin,FOLIO_PROXY_KEY:proxy,FOLIO_DB_PATH:path.join(directory,"workspace.sqlite"),FOLIO_OWNER_USERNAME:"owner",FOLIO_OWNER_PASSWORD:"initial-owner-password",FOLIO_TEAM_DEV:"0"});
  const seed=createSeed();
  const legacy=new DatabaseSync(process.env.FOLIO_DB_PATH!);legacy.exec("CREATE TABLE workspaces(id INTEGER PRIMARY KEY,revision INTEGER,data TEXT)");legacy.prepare("INSERT INTO workspaces VALUES(1,17,?)").run(JSON.stringify(seed));legacy.close();
  try{
    let owner:Actor;
    await t.test("migrates the legacy workspace privately and restricts temporary passwords",async()=>{
      assert.equal((await api("session")).data.enabled,true);
      assert.equal((await api("workspace")).status,401);
      owner=await signin("OWNER","initial-owner-password");
      assert.equal((await api("workspace","GET",undefined,owner)).data.code,"password_change_required");
      assert.deepEqual((await api("session","GET",undefined,owner)).data.members,[]);
      assert.equal((await api("password","POST",{currentPassword:"initial-owner-password",newPassword:"owner-replaced-password"},owner)).status,200);
      const snapshot=(await api("workspace","GET",undefined,owner)).data;
      assert.equal(snapshot.workspace!.pages.length,seed.pages.length);
      assert.ok(Object.values(snapshot.access as Record<string,Access>).every((access)=>access.visibility==="private"&&access.ownerId===owner.id));
      const db=await teamDatabase();assert.equal((db.prepare("SELECT revision FROM workspaces WHERE id=1").get() as {revision:number}).revision,17);
      process.env.FOLIO_TEAM_AUTH="0";assert.equal(teamIsEnabled(),true);process.env.FOLIO_TEAM_AUTH="1";
    });
    const makeUser=async(username:string,role:string)=>{
      const created=await api("users","POST",{username,name:username,role,password:`initial-${username}-password`},owner!);assert.equal(created.status,201,created.data.error);
      const actor=await signin(username,`initial-${username}-password`);
      assert.equal((await api("password","POST",{currentPassword:`initial-${username}-password`,newPassword:`replaced-${username}-password`},actor)).status,200);
      return actor;
    };
    const member=await makeUser("member","member"),viewer=await makeUser("viewer","viewer");
    const rootId=seed.pages.find((page)=>!page.parentId&&page.kind==="document")!.id;
    const otherId=seed.pages.find((page)=>!page.parentId&&page.id!==rootId)!.id;
    await t.test("members see no private pages; sharing is revision-checked and role-capped",async()=>{
      assert.equal((await api("workspace","GET",undefined,member)).data.workspace!.pages.length,0);
      for(const suffix of ["comments","history","files","access"])assert.equal((await api(`pages/${rootId}/${suffix}`,"GET",undefined,member)).status,404);
      const access=(await api(`pages/${rootId}/access`,"GET",undefined,owner!)).data.access as Access;
      const grants=[{userId:member.id,role:"editor"},{userId:viewer.id,role:"editor"}];
      assert.equal((await api(`pages/${rootId}/access`,"PATCH",{visibility:"private",grants,baseRevision:access.accessRevision},owner!)).status,200);
      assert.equal((await api(`pages/${rootId}/access`,"PATCH",{visibility:"team",grants:[],baseRevision:access.accessRevision},owner!)).status,409);
      const current=(await api("workspace","GET",undefined,viewer)).data;
      assert.ok(current.workspace!.pages.some((page)=>page.id===rootId));
      const page=current.workspace!.pages.find((page)=>page.id===rootId)!;
      assert.equal((await api("workspace","POST",{changes:[{page:{...page,title:"Viewer overwrite"},baseRevision:current.pageRevisions![rootId]}]},viewer)).status,403);
      assert.equal((await api("workspace","POST",{theme:"dark"},viewer)).status,200);
      assert.equal((await api("workspace","GET",undefined,viewer)).data.workspace!.theme,"dark");
      assert.notEqual((await api("workspace","GET",undefined,owner!)).data.workspace!.theme,"dark");
      const before=(await api("workspace","GET",undefined,member)).data.workspace!.pages.find((item)=>item.id===rootId)!.favorite;
      assert.equal((await api("preferences","POST",{pageId:rootId,favorite:!before},viewer)).status,200);
      assert.equal((await api("workspace","GET",undefined,viewer)).data.workspace!.pages.find((item)=>item.id===rootId)!.favorite,!before);
      assert.equal((await api("workspace","GET",undefined,member)).data.workspace!.pages.find((item)=>item.id===rootId)!.favorite,before);
    });
    await t.test("different pages save concurrently while stale writes cannot overwrite one page",async()=>{
      const initial=(await api("workspace","GET",undefined,owner!)).data;
      const current=(await api("workspace","GET",undefined,member)).data;
      const page=current.workspace!.pages.find((item)=>item.id===rootId)!;
      const crossed=await api("workspace","POST",{changes:[{page:{...page,title:"Wrong account write"},baseRevision:current.pageRevisions![rootId]}]},{...owner!,cookie:member.cookie});
      assert.equal(crossed.status,409);assert.equal(crossed.data.code,"account_changed");
      const crossedPassword=await api("password","POST",{currentPassword:"replaced-member-password",newPassword:"unexpected-password-change"},{...owner!,cookie:member.cookie});
      assert.equal(crossedPassword.status,409);assert.equal(crossedPassword.data.code,"account_changed");
      assert.equal((await api("workspace","POST",{theme:"light"},member,{"X-Folio-User":""})).status,403);
      const changed=await api("workspace","POST",{changes:[{page:{...page,title:"Member edited"},baseRevision:current.pageRevisions![rootId]}]},member);
      assert.equal(changed.status,200,changed.data.error);
      const other=initial.workspace!.pages.find((item)=>item.id===otherId)!;
      assert.equal((await api("workspace","POST",{changes:[{page:{...other,title:"Independent edit"},baseRevision:initial.pageRevisions![otherId]}]},owner!)).status,200);
      assert.equal((await api("workspace","POST",{changes:[{page:{...page,title:"Stale"},baseRevision:current.pageRevisions![rootId]}]},member)).status,409);
      assert.equal((await api("workspace","GET",undefined,owner!)).data.workspace!.pages.find((item)=>item.id===rootId)!.title,"Member edited");
      assert.equal((await api(`pages/${rootId}/access`,"PATCH",{visibility:"team",grants:[],baseRevision:1},member)).status,403);
    });
    let fileId="";
    await t.test("comments, mentions, attachments and history use current page access",async()=>{
      const posted=await api(`pages/${rootId}/comments`,"POST",{body:"Please review",mentions:[owner!.id]},member);assert.equal(posted.status,201,posted.data.error);
      assert.equal((await api(`pages/${rootId}/comments`,"POST",{body:"Viewer mutation"},viewer)).status,403);
      const comment=posted.data.comments![0];
      assert.equal((await api(`comments/${comment.id}`,"PATCH",{resolved:true},owner!)).data.comments![0].resolved,true);
      assert.ok((await api("notifications","GET",undefined,owner!)).data.notifications!.length>0);
      const upload=await api(`pages/${rootId}/files`,"POST","<svg onload=alert(1)></svg>",member,{"X-Folio-Filename":encodeURIComponent("drawing.svg")});assert.equal(upload.status,201,upload.data.error);fileId=upload.data.files![0].id;
      const download=await api(`files/${fileId}`,"GET",undefined,viewer);assert.equal(download.status,200);assert.equal(download.response.headers.get("content-type"),"application/octet-stream");assert.match(download.response.headers.get("content-disposition")!,/^attachment/);
      const history=(await api(`pages/${rootId}/history`,"GET",undefined,member)).data.history!;assert.ok(history.length);
      assert.equal((await api(`pages/${rootId}/presence`,"POST",undefined,member)).status,200);
      assert.ok((await api(`pages/${rootId}/presence`,"GET",undefined,owner!)).data.presence!.some((person)=>person.id===member.id));
      const current=(await api("workspace","GET",undefined,member)).data;
      const restored=await api(`pages/${rootId}/restore`,"POST",{versionId:history[0].id,baseRevision:current.pageRevisions![rootId]},member);assert.equal(restored.status,200,restored.data.error);
      const access=(await api(`pages/${rootId}/access`,"GET",undefined,owner!)).data.access as Access;
      assert.equal((await api(`pages/${rootId}/access`,"PATCH",{visibility:"private",grants:[],baseRevision:access.accessRevision},owner!)).status,200);
      for(const suffix of ["comments","history","files"])assert.equal((await api(`pages/${rootId}/${suffix}`,"GET",undefined,member)).status,404);
      assert.equal((await api(`files/${fileId}`,"GET",undefined,viewer)).status,404);
      assert.ok(!(await api(`pages/${rootId}/presence`,"GET",undefined,owner!)).data.presence!.some((person)=>person.id===member.id));
    });
    await t.test("directly shared children hide parent identifiers and retain nesting when edited",async()=>{
      const parent=newPage("Private parent"),child=newPage("Shared child",parent.id);
      assert.equal((await api("workspace","POST",{changes:[{page:parent,baseRevision:null},{page:child,baseRevision:null}]},owner!)).status,200);
      assert.equal((await api(`pages/${child.id}/access`,"PATCH",{visibility:"private",grants:[{userId:member.id,role:"editor"}],baseRevision:0},owner!)).status,200);
      const snapshot=(await api("workspace","GET",undefined,member)).data,visible=snapshot.workspace!.pages.find((page)=>page.id===child.id)!;
      assert.equal(visible.parentId,null);assert.ok(!snapshot.workspace!.pages.some((page)=>page.id===parent.id));
      assert.equal((await api("workspace","POST",{changes:[{page:{...visible,title:"Child edited"},baseRevision:snapshot.pageRevisions![child.id]}]},member)).status,200);
      assert.equal((await api("workspace","GET",undefined,owner!)).data.workspace!.pages.find((page)=>page.id===child.id)!.parentId,parent.id);
    });
    await t.test("protected references stay hidden after schema conversion, history restore and reparenting",async()=>{
      const target=newPage("Secret related page"),database=newPage("Shared database",null,"database");
      database.columns=[{id:"link",name:"Link",type:"relation",options:[]}];
      assert.equal((await api("workspace","POST",{changes:[{page:target,baseRevision:null},{page:database,baseRevision:null}]},owner!)).status,200);
      assert.equal((await api(`pages/${database.id}/access`,"PATCH",{visibility:"private",grants:[{userId:member.id,role:"editor"}],baseRevision:0},owner!)).status,200);
      assert.equal((await api(`pages/${target.id}/access`,"PATCH",{visibility:"private",grants:[{userId:member.id,role:"viewer"}],baseRevision:0},owner!)).status,200);
      const row=newPage("Owned record",database.id);row.properties={link:target.id};
      assert.equal((await api("workspace","POST",{changes:[{page:row,baseRevision:null}]},member)).status,200);
      let snapshot=(await api("workspace","GET",undefined,member)).data;
      assert.equal((await api("workspace","POST",{changes:[{page:{...row,title:"Later title"},baseRevision:snapshot.pageRevisions![row.id]}]},member)).status,200);
      const versions=(await api(`pages/${row.id}/history`,"GET",undefined,member)).data.history!;
      assert.equal((await api(`pages/${target.id}/access`,"PATCH",{visibility:"private",grants:[],baseRevision:1},owner!)).status,200);
      snapshot=(await api("workspace","GET",undefined,member)).data;
      const visibleDatabase=snapshot.workspace!.pages.find((page)=>page.id===database.id)!;
      assert.equal(snapshot.workspace!.pages.find((page)=>page.id===row.id)!.properties.link,"");
      assert.equal((await api("workspace","POST",{changes:[{page:{...visibleDatabase,columns:[{id:"link",name:"Link",type:"text",options:[]}]},baseRevision:snapshot.pageRevisions![database.id]}]},member)).status,200);
      snapshot=(await api("workspace","GET",undefined,member)).data;
      assert.equal(snapshot.workspace!.pages.find((page)=>page.id===row.id)!.properties.link,"");
      const restored=await api(`pages/${row.id}/restore`,"POST",{versionId:versions[0].id,baseRevision:snapshot.pageRevisions![row.id]},member);
      assert.equal(restored.status,200,restored.data.error);assert.equal(restored.data.workspace!.pages.find((page)=>page.id===row.id)!.properties.link,"");
      const currentRow=restored.data.workspace!.pages.find((page)=>page.id===row.id)!;
      const moved=await api("workspace","POST",{changes:[{page:{...currentRow,parentId:null},baseRevision:restored.data.pageRevisions![row.id]}]},member);
      assert.equal(moved.status,200,moved.data.error);assert.equal(moved.data.workspace!.pages.find((page)=>page.id===row.id)!.properties.link,"");
      assert.equal((await api("workspace","GET",undefined,owner!)).data.workspace!.pages.find((page)=>page.id===row.id)!.properties.link,target.id);
    });
    await t.test("account disable/reset and logout invalidate existing sessions immediately",async()=>{
      assert.equal((await api(`users/${member.id}`,"PATCH",{disabled:true},owner!)).status,200);
      assert.equal((await api("workspace","GET",undefined,member)).status,401);
      assert.equal((await api("login","POST",{username:"member",password:"replaced-member-password"})).status,401);
      assert.equal((await api(`users/${viewer.id}`,"PATCH",{password:"reset-viewer-password"},owner!)).status,200);
      assert.equal((await api("workspace","GET",undefined,viewer)).status,401);
      const reset=await signin("viewer","reset-viewer-password");assert.equal((await api("workspace","GET",undefined,reset)).data.code,"password_change_required");
      const previousCookie=owner!.cookie;assert.equal((await api("logout","POST",{},owner!)).status,200);
      assert.equal((await api("workspace","GET",undefined,{...owner!,cookie:previousCookie})).status,401);
    });
    await t.test("rejects proxy bypass and cross-origin login before application work",async()=>{
      assert.equal((await api("login","POST",{username:"owner",password:"owner-replaced-password"},undefined,{Origin:"https://evil.test"})).status,403);
      const response=await handleTeamRequest(new Request(`${origin}/api/team/session`));assert.equal(response.status,403);
    });
  }finally{
    closeTeamDatabase();for(const key of Object.keys(process.env))if(!(key in oldEnvironment))delete process.env[key];Object.assign(process.env,oldEnvironment);rmSync(directory,{recursive:true,force:true});
  }
});
