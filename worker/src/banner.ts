import type { Env } from './index'
import { getPropertyConfig } from './origin'

interface Purpose {
  id: string
  name: string
  description: string
  required: boolean
  default: boolean
}

interface BannerConfig {
  id: string
  property_id: string
  version: number
  headline: string
  body_copy: string
  position: string
  purposes: Purpose[]
  monitoring_enabled: boolean
}

export async function handleBannerScript(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const propertyId = url.searchParams.get('prop')
  const orgId = url.searchParams.get('org')

  if (!propertyId || !orgId) {
    return new Response('Missing required parameters: org, prop', { status: 400 })
  }

  // Fetch banner config (KV cache + Supabase fallback)
  const config = await getBannerConfig(propertyId, env)
  if (!config) {
    return new Response('Banner not found', { status: 404 })
  }

  // Fetch property config (includes signing secret) — already cached by getPropertyConfig
  const propConfig = await getPropertyConfig(propertyId, env)
  if (!propConfig) {
    return new Response('Property not found', { status: 404 })
  }

  // Update snippet_last_seen_at asynchronously (fire and forget)
  // Note: the Worker uses cs_worker grant which allows UPDATE on snippet_last_seen_at
  fetch(`${env.SUPABASE_URL}/rest/v1/web_properties?id=eq.${propertyId}`, {
    method: 'PATCH',
    headers: {
      apikey: env.SUPABASE_WORKER_KEY,
      Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ snippet_last_seen_at: new Date().toISOString() }),
  }).catch(() => {
    // Non-blocking — never break the customer's site
  })

  const cdnOrigin = new URL(request.url).origin
  const script = compileBannerScript({
    cdnOrigin,
    orgId,
    propertyId,
    bannerId: config.id,
    bannerVersion: config.version,
    signingSecret: propConfig.event_signing_secret,
    headline: config.headline,
    bodyCopy: config.body_copy,
    position: config.position,
    purposes: config.purposes ?? [],
    monitoringEnabled: config.monitoring_enabled !== false,
  })

  return new Response(script, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

async function getBannerConfig(propertyId: string, env: Env): Promise<BannerConfig | null> {
  const cacheKey = `banner:config:${propertyId}`
  const cached = await env.BANNER_KV.get(cacheKey, 'json')
  if (cached) return cached as BannerConfig

  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/consent_banners?property_id=eq.${propertyId}&is_active=eq.true&select=*`,
    {
      headers: {
        apikey: env.SUPABASE_WORKER_KEY,
        Authorization: `Bearer ${env.SUPABASE_WORKER_KEY}`,
      },
    },
  )

  if (!res.ok) return null

  const banners = (await res.json()) as BannerConfig[]
  const config = banners[0] ?? null

  if (config) {
    await env.BANNER_KV.put(cacheKey, JSON.stringify(config), { expirationTtl: 300 })
  }

  return config
}

interface CompileArgs {
  cdnOrigin: string
  orgId: string
  propertyId: string
  bannerId: string
  bannerVersion: number
  signingSecret: string
  headline: string
  bodyCopy: string
  position: string
  purposes: Purpose[]
  monitoringEnabled: boolean
}

function compileBannerScript(args: CompileArgs): string {
  // The compiled script is self-contained vanilla JS. It uses Web Crypto (SubtleCrypto)
  // for HMAC signing — available in all modern browsers since 2020.
  const config = JSON.stringify({
    org: args.orgId,
    prop: args.propertyId,
    banner: args.bannerId,
    version: args.bannerVersion,
    secret: args.signingSecret,
    cdn: args.cdnOrigin,
    headline: args.headline,
    body: args.bodyCopy,
    position: args.position,
    purposes: args.purposes,
    monitoring: args.monitoringEnabled,
  })

  return `(function(){
"use strict";
var CFG=${config};
var STORAGE_KEY="cs_consent_"+CFG.prop+"_v"+CFG.version;
if(localStorage.getItem(STORAGE_KEY))return;

function hex(buf){var h="";var b=new Uint8Array(buf);for(var i=0;i<b.length;i++){h+=("0"+b[i].toString(16)).slice(-2)}return h}
function utf8(s){return new TextEncoder().encode(s)}
async function hmac(msg,secret){
  var k=await crypto.subtle.importKey("raw",utf8(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  var sig=await crypto.subtle.sign("HMAC",k,utf8(msg));
  return hex(sig);
}

function buildBanner(){
  var wrap=document.createElement("div");
  wrap.id="cs-banner";
  wrap.setAttribute("role","dialog");
  wrap.setAttribute("aria-label","Cookie consent");
  var pos=getPositionStyle(CFG.position);
  wrap.style.cssText="position:fixed;z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;color:#111;"+pos;

  var card=document.createElement("div");
  card.style.cssText="background:#fff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,0.15);padding:16px;max-width:480px;width:calc(100vw - 32px)";

  var h=document.createElement("h3");
  h.textContent=CFG.headline;
  h.style.cssText="font-size:14px;font-weight:600;margin:0 0 6px 0";
  card.appendChild(h);

  var p=document.createElement("p");
  p.textContent=CFG.body;
  p.style.cssText="font-size:13px;color:#4b5563;margin:0 0 12px 0;line-height:1.4";
  card.appendChild(p);

  var purposeBox=document.createElement("div");
  purposeBox.style.cssText="max-height:160px;overflow-y:auto;margin:0 0 12px 0;display:none";
  var checkboxes={};
  CFG.purposes.forEach(function(pp){
    var row=document.createElement("label");
    row.style.cssText="display:flex;align-items:flex-start;gap:8px;font-size:12px;margin:6px 0;cursor:pointer";
    var cb=document.createElement("input");
    cb.type="checkbox";
    cb.checked=pp.default||pp.required;
    cb.disabled=!!pp.required;
    cb.style.cssText="margin-top:2px";
    checkboxes[pp.id]=cb;
    var lbl=document.createElement("span");
    lbl.innerHTML="<strong>"+escapeHtml(pp.name)+"</strong>"+(pp.required?' <span style="color:#6b7280">(required)</span>':"")+(pp.description?'<br><span style="color:#6b7280">'+escapeHtml(pp.description)+"</span>":"");
    row.appendChild(cb);
    row.appendChild(lbl);
    purposeBox.appendChild(row);
  });
  card.appendChild(purposeBox);

  var btnRow=document.createElement("div");
  btnRow.style.cssText="display:flex;gap:8px;flex-wrap:wrap";

  var acceptAll=mkBtn("Accept all","#000","#fff");
  var customise=mkBtn("Customise","transparent","#111","1px solid #d1d5db");
  var rejectAll=mkBtn("Reject all","transparent","#111","1px solid #d1d5db");
  var savePrefs=mkBtn("Save preferences","#000","#fff");
  savePrefs.style.display="none";

  acceptAll.onclick=function(){submitAll(true)};
  rejectAll.onclick=function(){submitAll(false)};
  customise.onclick=function(){
    purposeBox.style.display="block";
    customise.style.display="none";
    acceptAll.style.display="none";
    rejectAll.style.display="none";
    savePrefs.style.display="inline-block";
  };
  savePrefs.onclick=function(){submitCustom()};

  btnRow.appendChild(acceptAll);
  btnRow.appendChild(customise);
  btnRow.appendChild(rejectAll);
  btnRow.appendChild(savePrefs);
  card.appendChild(btnRow);

  wrap.appendChild(card);
  return {root:wrap,checkboxes:checkboxes};
}

function mkBtn(text,bg,color,border){
  var b=document.createElement("button");
  b.type="button";
  b.textContent=text;
  b.style.cssText="font-size:12px;font-weight:500;padding:8px 12px;border-radius:6px;background:"+bg+";color:"+color+";border:"+(border||"none")+";cursor:pointer";
  return b;
}

function escapeHtml(s){return String(s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}

function getPositionStyle(pos){
  switch(pos){
    case "bottom-bar":return "bottom:16px;left:50%;transform:translateX(-50%)";
    case "bottom-left":return "bottom:16px;left:16px";
    case "bottom-right":return "bottom:16px;right:16px";
    case "modal":return "top:50%;left:50%;transform:translate(-50%,-50%)";
    default:return "bottom:16px;left:50%;transform:translateX(-50%)";
  }
}

var ui;
function render(){ui=buildBanner();document.body.appendChild(ui.root)}

async function postEvent(eventType,accepted,rejected){
  var ts=String(Date.now());
  var sig=await hmac(CFG.org+CFG.prop+ts,CFG.secret);
  var payload={
    org_id:CFG.org,
    property_id:CFG.prop,
    banner_id:CFG.banner,
    banner_version:CFG.version,
    event_type:eventType,
    purposes_accepted:accepted,
    purposes_rejected:rejected,
    signature:sig,
    timestamp:ts
  };
  try{
    await fetch(CFG.cdn+"/v1/events",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload),
      keepalive:true
    });
  }catch(e){/* never break the page */}
}

function submitAll(accept){
  var accepted=[],rejected=[];
  CFG.purposes.forEach(function(p){
    if(accept||p.required)accepted.push(p.id);
    else rejected.push(p.id);
  });
  finalise(accept?"consent_given":"consent_withdrawn",accepted,rejected);
}

function submitCustom(){
  var accepted=[],rejected=[];
  CFG.purposes.forEach(function(p){
    if(ui.checkboxes[p.id]&&ui.checkboxes[p.id].checked)accepted.push(p.id);
    else rejected.push(p.id);
  });
  finalise("purpose_updated",accepted,rejected);
}

function finalise(eventType,accepted,rejected){
  postEvent(eventType,accepted,rejected);
  localStorage.setItem(STORAGE_KEY,JSON.stringify({type:eventType,accepted:accepted,rejected:rejected,ts:Date.now()}));
  if(ui&&ui.root&&ui.root.parentNode)ui.root.parentNode.removeChild(ui.root);
  window.dispatchEvent(new CustomEvent("consentshield:consent",{detail:{event_type:eventType,accepted:accepted,rejected:rejected}}));
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",render);
}else{
  render();
}
})();`
}
