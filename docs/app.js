import {extractFile,fromText} from './extract.js';
const $=id=>document.getElementById(id);let documentData=null,lastReport=null,busy=false,history=[];let generation=0;
const starters=Array.from(document.querySelectorAll('.starter-grid button'));
function resetConversation(){history=[];lastReport=null;$('download').disabled=true;}
starters.forEach(button=>button.addEventListener('click',()=>{if(busy)return;resetConversation();$('task').value=button.dataset.task;$('question').value=button.textContent.replace(/^[①②③④]\s*/, '');starters.forEach(b=>b.setAttribute('aria-pressed',String(b===button)));status('已選擇開場項目。可補充資料，再按開始檢查。');$('question').focus();}));
$('task').addEventListener('change',()=>{resetConversation();starters.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.task===$('task').value)));status('已切換任務，開始新的檢查。');});
function status(text){$('status').textContent=text;}
// 對應檢查不需要逐字的字型座標，減少傳送與費用；不假裝這次完成版面檢查。
function prepare(d,task){
 if(['matching','coach','diagnosis','source'].includes(task))return {...d,units:d.units.map(({id,location,text})=>({id,location,text})),metadata:d.kind==='pdf'?{pageCount:d.metadata.pageCount}: {},limitations:[...d.limitations,'此任務未傳送完整字型與座標資訊，不代表已檢查版面。']};
 if(d.kind==='pdf')return {...d,metadata:{...d.metadata,pages:d.metadata.pages.map(p=>({...p,textSpans:p.textSpans.filter(x=>x.y<60||x.y>p.heightMm*72/25.4-70),fontSizeCounts:p.textSpans.reduce((a,x)=>(a[x.sizePt]=(a[x.sizePt]||0)+1,a),{})}))},limitations:[...d.limitations,'PDF字級只提供文字片段數量統計與頁頂／頁底樣本；不是逐字完整版面驗證。']};
 return d;
}
function availability(){ $('submit').disabled=busy;$('clear').disabled=busy;$('file').disabled=busy;$('text').disabled=busy;$('task').disabled=busy;$('question').disabled=busy;starters.forEach(b=>b.disabled=busy); }
$('file').addEventListener('change',async()=>{
 const file=$('file').files[0];const token=++generation;documentData=null;resetConversation();if(!file)return;
 busy=true;availability();$('file-status').textContent='正在解析…';
 try{const d=await extractFile(file);if(token!==generation)return;documentData=d;$('text').value='';$('file-status').textContent=d.name+' · '+d.units.length+'個'+(d.kind==='pdf'?'頁面':'文字段落');$('preview-text').textContent=d.limitations.join('\n')+'\n\n'+d.units.map(u=>'['+u.id+' '+u.location+']\n'+u.text).join('\n\n');status('檔案已解析，請選擇一項檢查。');}
 catch(e){$('file').value='';$('preview-text').textContent='未成功解析這份檔案。';$('file-status').textContent=e.message;status('未載入檔案，請改用可讀文字的檔案或貼上內容。');}
 finally{busy=false;availability();}
});
$('text').addEventListener('input',()=>{resetConversation();if($('text').value.trim()){documentData=null;$('file').value='';$('file-status').textContent='目前使用貼上文字。';$('preview-text').textContent='貼上文字不能檢查原始版面。';}});
function el(tag,text,cls){const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;}
function auditParts(a,row){
 const reference=a.referenceInventory.find(x=>x.id===row.referenceId);
 const citations=row.citationIds.map(id=>a.citationInventory.find(x=>x.id===id)).filter(Boolean);
 return {reference,citations};
}
function renderAudit(root,a){
 root.append(el('h3','逐筆核對：正文 ↔ 參考文獻'));root.append(el('p','表格可左右捲動，查看格式、主張疑點與下一步。','muted'));
 root.append(el('p','AI盤點 '+a.referenceInventory.length+' 筆參考文獻、'+a.citationInventory.length+' 組正文來源。頁碼以PDF檔案頁序為準；可對應不代表文獻真實或支持主張。','muted'));
 const wrap=el('div',undefined,'audit-scroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','逐筆引用核對表，可左右捲動');
 const table=el('table',undefined,'audit-table');const thead=el('thead'),tr=el('tr');
 for(const title of ['編號','參考文獻／位置／原文','正文引註／位置／原文','對應判定','引註與參考文獻格式','題名與正文主張初篩','理由、規範及下一步']){const th=el('th',title);th.scope='col';tr.append(th);}thead.append(tr);table.append(thead);
 const tbody=el('tbody');
 for(const row of a.rows){const {reference,citations}=auditParts(a,row),line=el('tr');
 const ref=reference?[reference.id+' '+reference.label,reference.location,'「'+reference.evidence+'」'].join('\n'):'提供的參考文獻中未找到／需確認例外';
 const cite=citations.length?citations.map(c=>c.id+' '+c.label+'\n'+c.occurrences.map(o=>o.location+'「'+o.evidence+'」').join('\n')).join('\n\n'):'提供的正文中未找到';
 for(const value of [row.id,ref,cite,row.matchStatus,'正文：'+row.citationFormat+'\n\n參考文獻：'+row.referenceFormat,row.contentSupport,row.explanation+'\n\n依據：'+row.rule+'\n\n下一步：'+row.nextStep])line.append(el('td',value));tbody.append(line);
 }
 table.append(tbody);wrap.append(table);root.append(wrap);
 if(!a.rows.length)root.append(el('p','尚未產生逐筆對照。請看摘要與未完成項目。','muted'));
}
function auditText(a){if(!a)return [];return ['逐筆核對：正文 ↔ 參考文獻',...a.rows.map(row=>{const {reference,citations}=auditParts(a,row);return [row.id+'｜'+row.matchStatus,'參考文獻：'+(reference?reference.id+' '+reference.label+'\n位置：'+reference.location+'\n原文：'+reference.evidence:'未找到／需確認例外'),'正文引註：'+(citations.length?citations.map(c=>c.id+' '+c.label+'\n'+c.occurrences.map(o=>o.location+'：'+o.evidence).join('\n')).join('\n'):'未找到'),'正文格式：'+row.citationFormat,'參考文獻格式：'+row.referenceFormat,'題名與主張初篩：'+row.contentSupport,'理由：'+row.explanation,'依據：'+row.rule,'下一步：'+row.nextStep].join('\n');})];}
function render(r){const root=$('result');root.replaceChildren();const head=el('div',undefined,'summary');head.append(el('p',r.summary),el('p','目前階段：'+r.stage,'muted'));root.append(head);
 if(r.citationAudit)renderAudit(root,r.citationAudit);
 if(r.citationAudit&&r.findings.length)root.append(el('h3','其他具體問題與漏引疑點'));
 for(const f of r.findings){const d=el('article',undefined,'finding');const h=el('h3');h.append(el('span',f.status,'badge'+(f.status==='可確認'?' ok':'')),document.createTextNode(f.id+' · '+f.location));d.append(h);for(const [label,key] of [['證據','evidence'],['依據','rule'],['下一步','nextStep']])d.append(el('p',label+'：'+f[key]));root.append(d);}
 root.append(el('div','已完成範圍\n'+(r.completed.join('\n')||'尚未標示')+'\n\n未完成／需人工確認\n'+(r.unfinished.join('\n')||'未列出')+(r.questions.length?'\n\n需你確認\n'+r.questions.join('\n'):''),'coverage'),el('p',r.reminder,'muted'));
}
$('submit').addEventListener('click',async()=>{
 if(busy)return;const api=window.APA_CONFIG?.apiUrl?.trim();if(!api){status('老師尚未填入新的Cloudflare後端網址。');return;}
 if(!$('consent').checked){status('請先勾選內容傳送同意。');return;}if(!$('code').value.trim()){status('請輸入班級通關碼。');return;}
 const d=documentData||fromText($('text').value);const count=d.units.reduce((s,u)=>s+u.text.length,0);if(count>70000){status('解析文字超過70,000字元；請縮小範圍。');return;}if(!count&&!$('question').value.trim()){status('請提供作品文字或問題。');return;}
 busy=true;availability();$('download').disabled=true;lastReport=null;status('AI正在檢查；請稍候，不要重複送出。');
 try{const question=$('question').value;const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json','X-Class-Code':$('code').value.trim()},body:JSON.stringify({task:$('task').value,question,history,document:prepare(d,$('task').value)}),signal:AbortSignal.timeout($('task').value==='matching'?170000:110000)});const data=await response.json();if(!response.ok)throw Error(data.error||'服務無法回覆');render(data.result);const r=data.result;const recap=[r.summary,'階段：'+r.stage,...auditText(r.citationAudit),...r.findings.map(f=>f.id+' '+f.location+' '+f.status+' '+f.nextStep),...r.questions,'未完成：'+r.unfinished.join('；')].join('\n').slice(0,5000);history=[...history,{role:'user',content:question||'請依選定項目檢查提供的作品。'},{role:'assistant',content:recap}].slice(-6);lastReport={...data,file:d.name,created:new Date().toISOString()};$('question').value='';$('download').disabled=false;status('本次已回傳。請查看未完成項目；若需繼續，可在補充問題中回答提示，再按開始檢查。'+(data.usage?' 本次輸入 '+data.usage.input_tokens+'、輸出 '+data.usage.output_tokens+' tokens。':''));}
 catch(e){status(e.name==='TimeoutError'?'等待逾時；此請求可能已計費。請縮小範圍後再試。':e.message==='Failed to fetch'?'連線失敗；請檢查後端網址及ALLOWED_ORIGIN設定。':e.message);}
 finally{busy=false;availability();}
});
$('clear').addEventListener('click',()=>{generation++;documentData=null;resetConversation();for(const id of ['file','text','question','code'])$(id).value='';$('consent').checked=false;$('file-status').textContent='內容已清除。';$('preview-text').textContent='尚未選擇檔案。';$('result').replaceChildren(el('p','請提供新的檢查內容。','muted'));status('已清除作品、通關碼、對話與結果。');});
$('download').addEventListener('click',()=>{if(!lastReport)return;const r=lastReport.result;const text=['APA引註格式教練檢查紀錄','作品：'+lastReport.file,'時間：'+lastReport.created,'模型：'+lastReport.model,'項目：'+lastReport.task,'',r.summary,'SCRAF階段：'+r.stage,'',...auditText(r.citationAudit),...r.findings.map(f=>[f.id+'｜'+f.status+'｜'+f.location,'證據：'+f.evidence,'依據：'+f.rule,'下一步：'+f.nextStep].join('\n')),'','已完成範圍',...r.completed,'','未完成／需人工確認',...r.unfinished,'','需你確認',...r.questions,'',r.reminder].join('\n\n');const url=URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'}));const a=el('a');a.href=url;a.download='APA檢查紀錄.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
