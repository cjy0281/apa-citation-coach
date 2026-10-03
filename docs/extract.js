import {unzipSync,strFromU8} from './vendor/fflate.mjs';
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const list=(el,name)=>Array.from(el.getElementsByTagNameNS(W,name));
const attr=(el,name)=>el?.getAttributeNS(W,name)??null;
const xml=text=>{const d=new DOMParser().parseFromString(text,'application/xml');if(d.querySelector('parsererror'))throw Error('Word XML 無法解析');return d;};
function direct(el,name){return Array.from(el?.children||[]).find(x=>x.namespaceURI===W&&x.localName===name);}
export async function extractFile(file){
 if(file.size>10*1024*1024)throw Error('檔案超過 10 MB。');
 const bytes=new Uint8Array(await file.arrayBuffer());
 if(/\.pdf$/i.test(file.name))return extractPDF(bytes,file.name);
 if(/\.docx$/i.test(file.name))return extractDOCX(bytes,file.name);
 throw Error('僅支援 PDF、DOCX。');
}
async function extractPDF(data,name){
 const pdfjs=await import('./vendor/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdf.worker.mjs',import.meta.url).href;
 const loadingTask=pdfjs.getDocument({data,cMapUrl:new URL('./vendor/cmaps/',import.meta.url).href,cMapPacked:true,standardFontDataUrl:new URL('./vendor/standard_fonts/',import.meta.url).href,wasmUrl:new URL('./vendor/wasm/',import.meta.url).href,isEvalSupported:false});
 const pdf=await loadingTask.promise;
 try{
 if(pdf.numPages>20)throw Error('PDF 超過20頁；請提供比賽作品或縮小範圍。');
 const units=[],pages=[];let blank=0;
 for(let p=1;p<=pdf.numPages;p++){
  const page=await pdf.getPage(p),vp=page.getViewport({scale:1}),tc=await page.getTextContent();
  const scale=page.userUnit||1;
  const items=tc.items.filter(x=>typeof x.str==='string'&&x.str.trim());
  const lines=[];let lastY=null;
  for(const x of items){const y=x.transform[5];if(lastY!==null&&Math.abs(y-lastY)>3)lines.push('\n');lines.push(x.str);if(x.hasEOL)lines.push('\n');else lines.push(' ');lastY=y;}
  const text=lines.join('').replace(/\n\s*\n+/g,'\n').trim();if(text.length<20)blank++;
  units.push({id:'P'+p,location:'第'+p+'頁',text});
  pages.push({page:p,widthMm:Math.round(vp.width*25.4/72*10)/10,heightMm:Math.round(vp.height*25.4/72*10)/10,rotation:page.rotate,
   textSpans:items.slice(0,2000).map(x=>({text:x.str,sizePt:Math.round(Math.hypot(x.transform[2],x.transform[3])*scale*10)/10,x:x.transform[4]*scale,y:x.transform[5]*scale,fontHint:tc.styles[x.fontName]?.fontFamily||'unknown'}))});
 }
 if(blank===pdf.numPages)throw Error('這份 PDF 沒有足夠可讀文字，可能是掃描檔；請改用 DOCX 或可選取文字的 PDF。');
 return {name,kind:'pdf',units,metadata:{pageCount:pdf.numPages,pages},limitations:['PDF 文字順序可能與視覺位置不同。','字型名稱僅為解析器提示，不能據此斷言新細明體或 Times New Roman。','粗體、斜體、縮排、圖表與照片內容及每頁頁首頁尾完整性需人工核對。',...(blank?['有'+blank+'頁文字少於20字，這些頁面不能視為已檢查。']:[])]};
 }finally{await loadingTask.destroy();}
}
function extractDOCX(bytes,name){
 // 先讀 ZIP 中央目錄的未壓縮大小，阻擋壓縮炸彈；僅解壓 Word XML。
 let total=0;const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let i=0;i+46<bytes.length;i++){if(view.getUint32(i,true)===0x02014b50){total+=view.getUint32(i+24,true);if(total>40*1024*1024)throw Error('Word 解壓後過大。');const n=view.getUint16(i+28,true),e=view.getUint16(i+30,true),c=view.getUint16(i+32,true);i+=45+n+e+c;}}
 const z=unzipSync(bytes,{filter:e=>/^word\/(document|styles|header\d+|footer\d+)\.xml$/.test(e.name)&&e.originalSize<8*1024*1024});
 if(!z['word/document.xml'])throw Error('不是有效的 DOCX 文件。');
 const doc=xml(strFromU8(z['word/document.xml']));
 const styles=z['word/styles.xml']?xml(strFromU8(z['word/styles.xml'])):null;
 const defs=new Map((styles?list(styles,'style'):[]).map(s=>[attr(s,'styleId'),s]));
 const defaultP=styles?list(styles,'style').find(s=>attr(s,'type')==='paragraph'&&attr(s,'default')==='1'):null;
 const defaultR=styles?list(styles,'rPrDefault')[0]:null;
 function chain(id){const a=[];const visited=new Set();while(id&&defs.has(id)&&!visited.has(id)){visited.add(id);const s=defs.get(id);a.push(s);id=attr(direct(s,'basedOn'),'val');}return a;}
 function effective(ps,rs,key){for(const p of [...rs,...ps]){const v=direct(p,key);if(v)return v;}return direct(defaultR&&direct(defaultR,'rPr'),key);}
 const units=list(doc,'p').map((p,i)=>{
  const pp=direct(p,'pPr'),sid=attr(direct(pp,'pStyle'),'val')||attr(defaultP,'styleId');
  const pc=chain(sid);const ps=[direct(pp,'rPr'),...pc.map(s=>direct(s,'rPr'))].filter(Boolean);
  const runs=list(p,'r').map(r=>{const rp=direct(r,'rPr');const rs=[rp,...chain(attr(direct(rp,'rStyle'),'val')).map(s=>direct(s,'rPr'))].filter(Boolean);
   const fonts=effective(ps,rs,'rFonts');const val=key=>attr(effective(ps,rs,key),'val');
   const bold=val('b'),italic=val('i'),size=val('sz');
   return {text:Array.from(r.children).map(x=>x.localName==='t'?x.textContent:x.localName==='tab'?'\t':['br','cr'].includes(x.localName)?'\n':'').join(''),bold:bold===null?null:!['0','false','off'].includes(bold),italic:italic===null?null:!['0','false','off'].includes(italic),sizePt:size?Number(size)/2:null,font:fonts?{eastAsia:attr(fonts,'eastAsia'),ascii:attr(fonts,'ascii')}:null,color:val('color')};});
  const pcProps=[pp,...pc.map(s=>direct(s,'pPr'))].filter(Boolean);
  const prop=k=>pcProps.map(x=>direct(x,k)).find(Boolean);
  return {id:'D'+(i+1),location:'Word段落'+(i+1),text:runs.map(r=>r.text).join(''),format:{runs,style:sid,indent:prop('ind')?{left:attr(prop('ind'),'left'),hanging:attr(prop('ind'),'hanging'),firstLine:attr(prop('ind'),'firstLine')}:null,lineSpacing:prop('spacing')?{line:attr(prop('spacing'),'line'),lineRule:attr(prop('spacing'),'lineRule')}:null}};
 }).filter(x=>x.text.trim());
 const sections=list(doc,'sectPr').map(s=>{const sz=direct(s,'pgSz'),m=direct(s,'pgMar');return {sizeTwips:sz?{w:attr(sz,'w'),h:attr(sz,'h')}:null,marginsTwips:m?Object.fromEntries(['top','bottom','left','right'].map(k=>[k,attr(m,k)])):null};});
 const hf=Object.entries(z).filter(([k])=>/header|footer/.test(k)).map(([k,v])=>({part:k,text:list(xml(strFromU8(v)),'p').map(p=>list(p,'t').map(x=>x.textContent).join('')).join('\n')}));
 return {name,kind:'docx',units,metadata:{sections,headerFooter:hf},limitations:['DOCX 不含可靠的實際分頁；位置是段落編號，不是頁碼。','頁數、每頁頁首頁尾、表格跨頁與圖表位置請另以匯出的 PDF 人工核對。','未解析的主題字型、表格樣式或未明示／未繼承的屬性，以未知處理；不能當成格式錯誤。','圖片內文字、圖表影像與文字方塊的視覺順序未完整檢查。']};
}
export function fromText(text){return {name:'貼上文字',kind:'text',units:text.split(/\n\s*\n/).filter(x=>x.trim()).map((text,i)=>({id:'T'+(i+1),location:'貼上段落'+(i+1),text})),metadata:{},limitations:['貼上文字沒有原始排版，字型、字級、粗斜體、縮排、紙張、頁數、圖表位置及頁首頁尾均需人工確認。']};}
