import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({limit:'1mb'}));
app.use(express.static(path.join(__dirname,'public')));

const client = new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY});
let browser;
async function getBrowser(){ if(!browser) browser=await chromium.launch({headless:true}); return browser; }

const toolDefs=[
 {name:'web_search',description:'Search the web using a public search URL and return result titles/links. Use for research and discovery.',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
 {name:'open_url',description:'Open a URL in a browser and return the page title and visible text excerpt.',input_schema:{type:'object',properties:{url:{type:'string'}},required:['url']}},
 {name:'youtube_search',description:'Search YouTube for a query and return video titles, channels and links.',input_schema:{type:'object',properties:{query:{type:'string'}},required:['query']}},
 {name:'download_file',description:'Download a direct public file URL to the agent workspace. Do not bypass access controls, paywalls, DRM, or authentication.',input_schema:{type:'object',properties:{url:{type:'string'},filename:{type:'string'}},required:['url','filename']}},
 {name:'open_canva',description:'Open Canva in the browser so the user can continue a signed-in design workflow. This tool does not bypass login or security.',input_schema:{type:'object',properties:{path:{type:'string'}},required:[]}}
];

async function tool(name,input){
 const b=await getBrowser();
 if(name==='web_search'){
  const p=await b.newPage(); await p.goto('https://www.google.com/search?q='+encodeURIComponent(input.query),{waitUntil:'domcontentloaded',timeout:20000});
  const results=await p.locator('a').evaluateAll(as=>as.map(a=>({title:(a.innerText||'').trim(),url:a.href})).filter(x=>x.title&&x.url&&x.url.startsWith('http')).slice(0,12)); await p.close(); return results;
 }
 if(name==='youtube_search'){
  const p=await b.newPage(); await p.goto('https://www.youtube.com/results?search_query='+encodeURIComponent(input.query),{waitUntil:'domcontentloaded',timeout:25000});
  const results=await p.locator('ytd-video-renderer').evaluateAll(es=>es.slice(0,10).map(e=>({title:e.querySelector('#video-title')?.textContent?.trim(),url:e.querySelector('#video-title')?.href,channel:e.querySelector('ytd-channel-name')?.textContent?.trim()}))); await p.close(); return results;
 }
 if(name==='open_url'){
  const p=await b.newPage(); await p.goto(input.url,{waitUntil:'domcontentloaded',timeout:25000}); const title=await p.title(); const text=(await p.locator('body').innerText()).slice(0,7000); await p.close(); return {title,text};
 }
 if(name==='open_canva'){
  const p=await b.newPage(); await p.goto('https://www.canva.com/'+(input.path||''),{waitUntil:'domcontentloaded',timeout:25000}); const title=await p.title(); await p.close(); return {opened:true,title,url:p.url()};
 }
 if(name==='download_file'){
  const u=new URL(input.url); if(!['http:','https:'].includes(u.protocol)) throw new Error('Only HTTP(S) URLs are supported.');
  const safe=path.basename(input.filename).replace(/[^a-zA-Z0-9._-]/g,'_'); const dir=path.join(__dirname,'workspace'); await fs.mkdir(dir,{recursive:true}); const res=await fetch(input.url); if(!res.ok) throw new Error(`Download failed: ${res.status}`); const buf=Buffer.from(await res.arrayBuffer()); await fs.writeFile(path.join(dir,safe),buf); return {saved:path.join('workspace',safe),bytes:buf.length};
 }
 throw new Error('Unknown tool: '+name);
}

app.post('/api/agent',async(req,res)=>{
 try{
  if(!process.env.ANTHROPIC_API_KEY) return res.status(503).json({error:'Set ANTHROPIC_API_KEY on the server. Never put it in the HTML or GitHub repository.'});
  const goal=String(req.body.goal||'').trim(); if(!goal) return res.status(400).json({error:'Missing goal'});
  const events=[]; let messages=[{role:'user',content:goal}];
  const system=`You are JARVIS Agent Core. Turn the user's goal into a short executable plan and use tools when useful. Work iteratively: plan, act, inspect the result, then continue. Never claim an action succeeded without tool evidence. You may research public information, open websites, search YouTube and download public direct files. Never bypass logins, CAPTCHAs, paywalls, DRM, access controls, or site security. For consequential actions such as purchases, publishing, deleting data, sending messages, changing accounts, or submitting forms, stop and request explicit user approval before the action. Be concise. Available tools: web_search, open_url, youtube_search, download_file, open_canva.`;
  for(let turn=0;turn<8;turn++){
   const msg=await client.messages.create({model:process.env.ANTHROPIC_MODEL||'claude-sonnet-4-5',max_tokens:1200,system,tools:toolDefs,messages});
   messages.push({role:'assistant',content:msg.content});
   let used=false;
   for(const block of msg.content){
    if(block.type==='text'&&block.text.trim()) events.push({type:'JARVIS',message:block.text.trim()});
    if(block.type==='tool_use'){
      used=true; events.push({type:'TOOL',message:`Using ${block.name}…`});
      try{const result=await tool(block.name,block.input); events.push({type:'RESULT',message:`${block.name} completed.`,ok:true}); messages.push({role:'user',content:[{type:'tool_result',tool_use_id:block.id,content:JSON.stringify(result).slice(0,12000)}]});}
      catch(err){events.push({type:'ERROR',message:`${block.name}: ${err.message}`}); messages.push({role:'user',content:[{type:'tool_result',tool_use_id:block.id,is_error:true,content:err.message}]});}
    }
   }
   if(!used) return res.json({events,answer:msg.content.filter(x=>x.type==='text').map(x=>x.text).join('\n')});
  }
  res.json({events,answer:'Execution limit reached. The current results are shown above.'});
 }catch(e){res.status(500).json({error:e.message});}
});

const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`JARVIS Agent running on http://localhost:${port}`));
