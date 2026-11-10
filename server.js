'use strict';
// ViceClips — servidor sem dependências npm (Node >= 18 + FFmpeg).
const http=require('http'),fs=require('fs'),path=require('path'),{spawn}=require('child_process'),crypto=require('crypto'),{pipeline}=require('stream/promises');
try{for(const l of fs.readFileSync('.env','utf8').split('\n')){const m=l.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim()}}catch{}
const PORT=process.env.PORT||3000,KEY=process.env.OPENAI_API_KEY,FF=process.env.FFMPEG_PATH||'ffmpeg',FP=process.env.FFPROBE_PATH||'ffprobe';
const D=process.env.DATA_DIR||path.join(__dirname,'data');for(const s of['uploads','out','tmp','tr'])fs.mkdirSync(path.join(D,s),{recursive:true});
const dbf=path.join(D,'db.json');let db={videos:{},items:{}};try{db=JSON.parse(fs.readFileSync(dbf))}catch{}
const save=()=>fs.writeFileSync(dbf,JSON.stringify(db));const jobs={};const id=()=>crypto.randomBytes(6).toString('hex');
const run=(c,a,o={})=>new Promise((ok,no)=>{const p=spawn(c,a,o);let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err=(err+d).slice(-1500));p.on('error',()=>no(new Error(c+' não encontrado. Instale o FFmpeg.')));p.on('close',k=>k?no(new Error(c+' falhou: '+err)):ok(out))});
const mm=x=>`${Math.floor(x/60)}:${String(Math.floor(x%60)).padStart(2,'0')}`;
const ts=x=>{const h=Math.floor(x/3600),m=Math.floor(x%3600/60),s=Math.floor(x%60),ms=Math.floor(x%1*1000);return[h,m,s].map(n=>String(n).padStart(2,'0')).join(':')+','+String(ms).padStart(3,'0')};

// ---------- Análise ----------
function energy(file){return new Promise((ok,no)=>{const p=spawn(FF,['-v','error','-i',file,'-vn','-ac','1','-ar','8000','-f','s16le','-']);const e=[];let acc=0,n=0,rest=Buffer.alloc(0);p.stderr.resume();
p.stdout.on('data',d=>{const b=Buffer.concat([rest,d]),len=b.length&~1;rest=b.subarray(len);for(let i=0;i<len;i+=2){const v=b.readInt16LE(i);acc+=v*v;if(++n===8000){e.push(Math.sqrt(acc/n));acc=0;n=0}}});
p.on('error',()=>no(new Error('FFmpeg não encontrado.')));p.on('close',k=>k?no(new Error('Falha ao extrair áudio.')):ok(e))})}
function audioMoments(e,dur,s){ // picos de volume/reação (gritos, risadas, ação) em relação à base do vídeo
 const sm=e.map((_,i)=>{let t=0,c=0;for(let j=i-1;j<=i+1;j++)if(e[j]!==undefined){t+=e[j];c++}return t/c});
 const med=[...e].sort((a,b)=>a-b)[e.length>>1]||0;
 const sc=sm.map((v,i)=>{let b=0,c=0;for(let j=Math.max(0,i-12);j<i-2;j++){b+=sm[j];c++}b=c?b/c:med;return(v+0.5*Math.max(0,v-b))/(med+1)});
 const len=Math.min(s.max,Math.max(s.min,30),dur),n=s.count||Math.max(1,Math.min(20,Math.round(dur/240)));
 const th={loose:1.3,normal:2,strict:3}[s.level]||2,picked=[];
 for(const i of sc.map((_,i)=>i).sort((a,b)=>sc[b]-sc[a])){if(picked.length>=n||(picked.length&&sc[i]<th))break;if(picked.some(q=>Math.abs(q.peak-i)<len))continue;
  const start=Math.max(0,Math.min(i-len*.6,dur-len));picked.push({peak:i,start,end:Math.min(dur,start+len),score:sc[i],title:'Momento de destaque às '+mm(i)})}
 return picked}
async function transcribe(file,dur,job){const segs=[];for(let t=0;t<dur;t+=600){job.step=`Transcrevendo fala (${Math.floor(t/60)} min)`;const f=path.join(D,'tmp',id()+'.mp3');
 await run(FF,['-y','-v','error','-ss',t,'-t',600,'-i',file,'-vn','-ac','1','-ar','16000','-b:a','48k',f]);
 const fd=new FormData();fd.append('file',new Blob([fs.readFileSync(f)]),'a.mp3');fd.append('model','whisper-1');fd.append('response_format','verbose_json');
 const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+KEY},body:fd});fs.unlinkSync(f);
 if(!r.ok)throw new Error('Whisper HTTP '+r.status);for(const g of(await r.json()).segments||[])segs.push({start:g.start+t,end:g.end+t,text:g.text.trim()});job.progress=15+Math.min(15,t/dur*15)}return segs}
async function llmMoments(segs,s,dur,n){const txt=segs.map(g=>`[${Math.round(g.start)}s] ${g.text}`).join('\n').slice(0,90000);
 const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+KEY,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o-mini',response_format:{type:'json_object'},messages:[
 {role:'system',content:'Você é editor de clipes virais de lives e gameplays (GTA). Escolha momentos engraçados, reações inesperadas, tensão, perseguições, surpresas e falas marcantes. Cada trecho deve ter começo e fim com contexto (não cortar no meio de frase).'},
 {role:'user',content:`Vídeo de ${Math.round(dur)}s. Escolha até ${n} trechos de ${s.min} a ${s.max} segundos, sem sobreposição. Responda JSON: {"moments":[{"start":seg,"end":seg,"title":"descrição curta em português","score":0-10}]}\n\nTranscrição:\n${txt}`}]})});
 if(!r.ok)throw new Error('LLM HTTP '+r.status);const j=JSON.parse((await r.json()).choices[0].message.content),out=[];
 for(const x of(j.moments||[]).sort((a,b)=>b.score-a.score)){let a=+x.start,b=+x.end;if(!(b>a)||a<0||a>=dur)continue;if(b-a>s.max)b=a+s.max;if(b-a<s.min)b=Math.min(dur,a+s.min);
  if(out.some(o=>a<o.end&&b>o.start))continue;out.push({start:a,end:Math.min(b,dur),score:+x.score||5,title:String(x.title||'Momento').slice(0,90)})}return out.slice(0,n)}

// ---------- Renderização (FFmpeg) ----------
async function render(file,start,end,o,segs,out){const dur=end-start,T=path.join(D,'tmp');
 let chain=o.format==='vertical'?'[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg];[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2'
  :'[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2';
 const sub=o.subs&&segs.filter(g=>g.end>start&&g.start<end);let srt=null;
 if(sub&&sub.length){srt='s'+id()+'.srt';fs.writeFileSync(path.join(T,srt),sub.map((g,i)=>`${i+1}\n${ts(Math.max(0,g.start-start))} --> ${ts(Math.min(dur,g.end-start))}\n${g.text}\n`).join('\n'));
  chain+=`,subtitles=${srt}:force_style='FontSize=${o.format==='vertical'?9:8},Outline=2,Bold=1,MarginV=${o.format==='vertical'?45:20}'`}
 let af=[];if(o.fade){chain+=`,fade=t=in:d=0.2,fade=t=out:st=${Math.max(0,dur-.2)}:d=0.2`;af=['-af',`afade=t=in:d=0.2,afade=t=out:st=${Math.max(0,dur-.2)}:d=0.2`]}
 try{await run(FF,['-y','-v','error','-ss',start,'-t',dur,'-i',file,'-filter_complex',chain+'[v]','-map','[v]','-map','0:a?',...af,'-c:v','libx264','-preset','veryfast','-crf','23','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',out],{cwd:T})}
 finally{if(srt)fs.rmSync(path.join(T,srt),{force:true})}}
const addItem=(v,type,title,start,end,o,file,extra={})=>{const it={id:id(),videoId:v.id,type,title,start,end,dur:end-start,format:o.format,subs:o.subs,file,created:Date.now(),...extra};db.items[it.id]=it;save();return it};

async function runJob(job,v,s){const file=path.join(D,'uploads',v.file),dur=v.duration;
 job.step='Analisando energia do áudio';const e=await energy(file);job.progress=12;
 let segs=[];if(KEY){try{segs=await transcribe(file,dur,job)}catch(x){job.warnings.push('Transcrição falhou: '+x.message)}}
 else job.warnings.push('OPENAI_API_KEY não configurada: análise somente por áudio e sem legendas.');
 fs.writeFileSync(path.join(D,'tr',v.id+'.json'),JSON.stringify(segs));job.progress=32;job.step='Identificando momentos interessantes';
 const comp=s.mode==='best',len=Math.min(s.max,Math.max(s.min,30)),want=comp?Math.ceil(s.target*60/len)+2:s.count;
 let ms=audioMoments(e,dur,{...s,count:want});
 if(segs.length){try{const l=await llmMoments(segs,s,dur,want||Math.max(3,Math.round(dur/240)));if(l.length)ms=l}catch(x){job.warnings.push('Análise por IA falhou, usando áudio: '+x.message)}}
 for(const m of ms)if(m.title.startsWith('Momento de destaque')){const g=segs.find(g=>g.start>=m.start&&g.text.length>8);if(g)m.title=g.text.slice(0,80)}
 if(comp){let t=0;ms=ms.sort((a,b)=>b.score-a.score).filter(m=>(t<s.target*60)&&(t+=m.end-m.start,true))}
 ms.sort((a,b)=>a.start-b.start);job.moments=ms.length;job.progress=40;
 if(!ms.length)throw new Error('Nenhum momento encontrado neste vídeo.');
 const T=path.join(D,'tmp'),parts=[];
 for(const[i,m]of ms.entries()){job.step=`${comp?'Montando trecho':'Gerando clipe'} ${i+1} de ${ms.length}`;
  if(comp){const f=path.join(T,`${job.id}_${i}.mp4`);await render(file,m.start,m.end,{...s,fade:true},segs,f);parts.push(f)}
  else{const name=`${id()}.mp4`;await render(file,m.start,m.end,s,segs,path.join(D,'out',name));job.items.push(addItem(v,'clip',m.title,m.start,m.end,s,name));job.clips++}
  job.progress=40+55*(i+1)/ms.length}
 if(comp){job.step='Unindo compilação';const list=path.join(T,job.id+'.txt');fs.writeFileSync(list,parts.map(p=>`file '${p}'`).join('\n'));const name=`${id()}.mp4`;
  await run(FF,['-y','-v','error','-f','concat','-safe','0','-i',list,'-c','copy','-movflags','+faststart',path.join(D,'out',name)]);
  parts.forEach(p=>fs.rmSync(p,{force:true}));fs.rmSync(list,{force:true});
  job.items.push(addItem(v,'compilation',`Melhores momentos (${ms.length} trechos)`,0,0,s,name,{dur:ms.reduce((a,m)=>a+m.end-m.start,0)}));job.clips=1}
 job.progress=100;job.step='Concluído';job.status='done'}

async function getDuration(fp){
 for(const a of['format=duration','stream=duration']){try{const d=parseFloat((await run(FP,['-v','error','-show_entries',a,'-of','csv=p=0',fp])).split('\n').map(parseFloat).find(x=>x>0));if(d>0)return d}catch(e){if(/não encontrado/.test(e.message))throw e}}
 const t=await new Promise(ok=>{const p=spawn(FF,['-i',fp,'-f','null','-']);let err='';p.stderr.on('data',d=>err+=d);p.on('error',()=>ok(''));p.on('close',()=>ok(err))});
 const m=[...t.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)].pop();if(m)return+m[1]*3600+ +m[2]*60+ +m[3];
 throw new Error('Não consegui ler esse vídeo (arquivo corrompido ou codec não suportado).')}
// ---------- HTTP ----------
const crcT=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^c>>>1:c>>>1;return c>>>0});
const crc=b=>{let c=~0;for(const x of b)c=crcT[(c^x)&255]^c>>>8;return~c>>>0};
function zip(files){const L=[],C=[];let off=0;for(const f of files){const d=fs.readFileSync(f.path),n=Buffer.from(f.name),c=crc(d);
 const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50,0);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(c,14);h.writeUInt32LE(d.length,18);h.writeUInt32LE(d.length,22);h.writeUInt16LE(n.length,26);
 const e=Buffer.alloc(46);e.writeUInt32LE(0x02014b50,0);e.writeUInt16LE(20,4);e.writeUInt16LE(20,6);e.writeUInt16LE(0x800,8);e.writeUInt32LE(c,16);e.writeUInt32LE(d.length,20);e.writeUInt32LE(d.length,24);e.writeUInt16LE(n.length,28);e.writeUInt32LE(off,42);
 L.push(h,n,d);C.push(e,n);off+=30+n.length+d.length}
 const cd=Buffer.concat(C),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(cd.length,12);end.writeUInt32LE(off,16);return Buffer.concat([...L,cd,end])}
const send=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json'});res.end(JSON.stringify(o))};
const body=req=>new Promise(r=>{let b='';req.on('data',d=>b+=d);req.on('end',()=>{try{r(JSON.parse(b||'{}'))}catch{r({})}})});
const MIME={'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.html':'text/html;charset=utf-8'};
const num=(x,d,lo,hi)=>Math.min(hi,Math.max(lo,Number.isFinite(+x)&&x!==''&&x!=null?+x:d));
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://x'),p=u.pathname,m=req.method;let r;
 if(m==='GET'&&(p==='/'||p==='/index.html')){res.writeHead(200,{'content-type':MIME['.html']});return res.end(fs.readFileSync(path.join(__dirname,'public/index.html')))}
 if(m==='POST'&&p==='/api/upload'){const name=u.searchParams.get('name')||'video.mp4',ext=path.extname(name).toLowerCase();
  if(!['.mp4','.mov','.webm'].includes(ext)){req.resume();return send(res,400,{error:'Formato não suportado. Use MP4, MOV ou WEBM.'})}
  const vid=id(),file=vid+ext,fp=path.join(D,'uploads',file);await pipeline(req,fs.createWriteStream(fp));let dur;try{dur=await getDuration(fp)}catch(x){fs.rmSync(fp,{force:true});return send(res,400,{error:x.message})}
  db.videos[vid]={id:vid,name,file,duration:dur,created:Date.now()};save();return send(res,200,db.videos[vid])}
 if(m==='POST'&&(r=p.match(/^\/api\/videos\/(\w+)\/process$/))){const v=db.videos[r[1]];if(!v)return send(res,404,{error:'Vídeo não encontrado.'});const b=await body(req),min=num(b.min,15,3,300),max=num(b.max,60,3,600);
  const s={mode:b.mode==='best'?'best':'clips',format:b.format==='horizontal'?'horizontal':'vertical',min:Math.min(min,max),max:Math.max(min,max),count:num(b.count,0,0,50),level:b.level||'normal',subs:!!b.subs,target:num(b.target,3,.5,60)};
  const job={id:id(),videoId:v.id,status:'running',step:'Iniciando',progress:0,moments:0,clips:0,items:[],warnings:[]};jobs[job.id]=job;
  runJob(job,v,s).catch(e=>{job.status='error';job.error=e.message});return send(res,200,job)}
 if(m==='GET'&&(r=p.match(/^\/api\/jobs\/(\w+)$/)))return jobs[r[1]]?send(res,200,jobs[r[1]]):send(res,404,{error:'Job não encontrado.'});
 if(m==='GET'&&p==='/api/library')return send(res,200,{videos:Object.values(db.videos).sort((a,b)=>b.created-a.created),items:Object.values(db.items).sort((a,b)=>b.created-a.created)});
 if(m==='GET'&&(r=p.match(/^\/api\/videos\/(\w+)\/zip$/))){const its=Object.values(db.items).filter(i=>i.videoId===r[1]&&i.type==='clip');if(!its.length)return send(res,404,{error:'Sem clipes.'});
  const z=zip(its.map((i,n)=>({name:`clipe_${String(n+1).padStart(2,'0')}.mp4`,path:path.join(D,'out',i.file)})));res.writeHead(200,{'content-type':'application/zip','content-disposition':'attachment; filename="viceclips.zip"','content-length':z.length});return res.end(z)}
 if(m==='PUT'&&(r=p.match(/^\/api\/items\/(\w+)$/))){const it=db.items[r[1]],v=it&&db.videos[it.videoId];if(!it||it.type!=='clip'||!v)return send(res,404,{error:'Clipe não encontrado.'});
  const b=await body(req),st=num(b.start,it.start,0,v.duration),en=num(b.end,it.end,0,v.duration);if(en-st<1)return send(res,400,{error:'O clipe precisa ter pelo menos 1 segundo.'});
  let segs=[];try{segs=JSON.parse(fs.readFileSync(path.join(D,'tr',v.id+'.json')))}catch{}
  await render(path.join(D,'uploads',v.file),st,en,it,segs,path.join(D,'out',it.file));Object.assign(it,{start:st,end:en,dur:en-st});save();return send(res,200,it)}
 if(m==='DELETE'&&(r=p.match(/^\/api\/(items|videos)\/(\w+)$/))){const rm=i=>{fs.rmSync(path.join(D,'out',i.file),{force:true});delete db.items[i.id]};
  if(r[1]==='items'){if(db.items[r[2]])rm(db.items[r[2]])}else{const v=db.videos[r[2]];if(v){Object.values(db.items).filter(i=>i.videoId===v.id).forEach(rm);fs.rmSync(path.join(D,'uploads',v.file),{force:true});delete db.videos[v.id]}}
  save();return send(res,200,{ok:1})}
 if(m==='GET'&&(r=p.match(/^\/files\/(uploads|out)\/([\w.]+)$/))){const f=path.join(D,r[1],path.basename(r[2]));if(!fs.existsSync(f))return send(res,404,{error:'Arquivo não encontrado.'});
  const size=fs.statSync(f).size,h={'content-type':MIME[path.extname(f)]||'application/octet-stream','accept-ranges':'bytes'};if(u.searchParams.get('dl'))h['content-disposition']=`attachment; filename="${(u.searchParams.get('n')||'viceclips').replace(/[^\w\- ]/g,'')}.mp4"`;
  const rg=(req.headers.range||'').match(/bytes=(\d*)-(\d*)/);if(rg){const a=rg[1]?+rg[1]:0,z=rg[2]?+rg[2]:size-1;res.writeHead(206,{...h,'content-range':`bytes ${a}-${z}/${size}`,'content-length':z-a+1});return fs.createReadStream(f,{start:a,end:z}).pipe(res)}
  res.writeHead(200,{...h,'content-length':size});return fs.createReadStream(f).pipe(res)}
 send(res,404,{error:'Rota não encontrada.'})}catch(e){if(!res.headersSent)send(res,500,{error:e.message});else res.end()}});
process.on('uncaughtException',e=>console.error('Erro inesperado:',e));process.on('unhandledRejection',e=>console.error('Erro inesperado:',e));
server.on('error',e=>{console.error(e.code==='EADDRINUSE'?`A porta ${PORT} já está em uso. Feche a outra instância ou use PORT=3001 node server.js`:'Erro no servidor: '+e.message);process.exit(1)});
server.requestTimeout=0;server.listen(PORT,()=>console.log(`ViceClips em http://localhost:${PORT}  |  IA de fala: ${KEY?'ativa':'desativada (sem OPENAI_API_KEY)'}`));
