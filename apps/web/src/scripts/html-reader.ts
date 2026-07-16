import { annotationColors, type Annotation } from './annotations';
import { updateReadingLocation, type ReadingLocation } from '../lib/reading-progress';

type HtmlAnchor = {
  quote:string;prefix:string;suffix:string;startOffset:number;endOffset:number;
  sourceKind:'html';locator:string;rects:[];
};
type ReaderSourceDetail={kind?:string;load?:()=>Promise<string>};
type ReaderLocationDetail={text?:string;start?:number;end?:number};

const highlightName=(id:string)=>`seshat-html-annotation-${id.replace(/[^a-zA-Z0-9_-]/g,'-')}`;

export async function mountHtmlReader(
  element:HTMLElement,
  referenceId:string,
  _title:string,
  report:(message:string,tone?:'ready'|'saving'|'error')=>void,
):Promise<()=>void>{
  const controller=new AbortController();let disposed=false,saveTimer=0;
  const shell=document.createElement('div');shell.className='seshat-html-reader';
  const scroll=document.createElement('div');scroll.className='seshat-html-reader-scroll';scroll.tabIndex=0;
  const content=document.createElement('article');content.className='webarchive-reader-content';scroll.appendChild(content);shell.appendChild(scroll);element.replaceChildren(shell);
  report('preparing WebArchive reader…','saving');
  const [htmlResponse,annotationResponse,stateResponse]=await Promise.all([
    fetch(`/api/library/${encodeURIComponent(referenceId)}/artifact/html`,{signal:controller.signal,cache:'no-store'}),
    fetch(`/api/library/${encodeURIComponent(referenceId)}/annotations`,{signal:controller.signal,cache:'no-store'}),
    fetch(`/api/library/${encodeURIComponent(referenceId)}/reading-state`,{signal:controller.signal,cache:'no-store'}),
  ]);
  if(!htmlResponse.ok)throw new Error('The clean WebArchive reader is not available yet.');
  const parsed=new DOMParser().parseFromString(await htmlResponse.text(),'text/html');
  parsed.querySelectorAll('script,style,noscript,template,iframe,object,embed,form').forEach((node)=>node.remove());
  parsed.querySelectorAll<HTMLElement>('*').forEach((node)=>{
    [...node.attributes].forEach((attribute)=>{if(attribute.name.toLowerCase().startsWith('on')||attribute.name==='style'||attribute.name==='srcset')node.removeAttribute(attribute.name);});
    if(node instanceof HTMLImageElement&&!node.src.startsWith('data:image/'))node.removeAttribute('src');
    if(node instanceof HTMLAnchorElement){const href=node.getAttribute('href')||'';if(!/^(?:https?:|mailto:|#)/i.test(href))node.removeAttribute('href');node.target='_blank';node.rel='noreferrer noopener';}
  });
  const sourceBody=parsed.body.querySelector('article')||parsed.body;content.replaceChildren(...[...sourceBody.childNodes].map((node)=>document.importNode(node,true)));
  let annotations:Annotation[]=annotationResponse.ok?((await annotationResponse.json()).annotations||[]):[];
  annotations=annotations.filter((item)=>item.sourceKind==='html');
  const readingState=stateResponse.ok?await stateResponse.json() as {location?:ReadingLocation}:{location:{}};let readingLocation:ReadingLocation=readingState.location||{};

  const textNodes=()=>{const walker=document.createTreeWalker(content,NodeFilter.SHOW_TEXT);const nodes:Text[]=[];let node:Node|null;while(node=walker.nextNode()){if(!(node.parentElement?.closest('.html-annotation-palette,script,style,noscript')))nodes.push(node as Text);}return nodes;};
  const readerText=()=>textNodes().map((node)=>node.data).join('');
  const rangeAt=(start:number,end:number):Range|null=>{
    const nodes=textNodes();let cursor=0,startNode:Text|null=null,endNode:Text|null=null,startOffset=0,endOffset=0;
    for(const node of nodes){const next=cursor+node.data.length;if(!startNode&&start>=cursor&&start<=next){startNode=node;startOffset=Math.min(node.data.length,start-cursor);}if(!endNode&&end>=cursor&&end<=next){endNode=node;endOffset=Math.min(node.data.length,end-cursor);break;}cursor=next;}
    if(!startNode||!endNode)return null;const range=document.createRange();range.setStart(startNode,startOffset);range.setEnd(endNode,endOffset);return range;
  };
  const rangeForAnnotation=(annotation:Annotation):Range|null=>{
    const source=readerText();let start=annotation.startOffset;
    if(start<0||source.slice(start,start+annotation.quote.length)!==annotation.quote){const candidates:number[]=[];let cursor=source.indexOf(annotation.quote);while(cursor>=0&&candidates.length<100){candidates.push(cursor);cursor=source.indexOf(annotation.quote,cursor+1);}start=candidates.sort((left,right)=>{const score=(position:number)=>(annotation.prefix&&source.slice(Math.max(0,position-annotation.prefix.length),position)===annotation.prefix?2:0)+(annotation.suffix&&source.slice(position+annotation.quote.length,position+annotation.quote.length+annotation.suffix.length)===annotation.suffix?1:0);return score(right)-score(left);})[0]??-1;}
    return start>=0?rangeAt(start,start+annotation.quote.length):null;
  };
  const renderedNames=new Set<string>(),styleId=`seshat-html-annotation-styles-${referenceId.replace(/[^a-zA-Z0-9_-]/g,'-')}`;
  const renderHighlights=()=>{
    const registry=(CSS as any).highlights,Highlight=(window as any).Highlight;if(!registry||typeof Highlight!=='function')return;
    renderedNames.forEach((name)=>registry.delete(name));renderedNames.clear();let style=document.getElementById(styleId) as HTMLStyleElement|null;
    if(!style){style=document.createElement('style');style.id=styleId;document.head.appendChild(style);}const rules:string[]=[];
    annotations.forEach((annotation)=>{const range=rangeForAnnotation(annotation);if(!range)return;const name=highlightName(annotation.id);registry.set(name,new Highlight(range));renderedNames.add(name);rules.push(`::highlight(${name}){background-color:color-mix(in srgb,${annotation.color} 42%,transparent);color:inherit}`);});style.textContent=rules.join('');
  };
  renderHighlights();

  let pending:HtmlAnchor|null=null;const palette=document.createElement('div');palette.className='annotation-palette html-annotation-palette';palette.hidden=true;
  annotationColors.forEach((color,index)=>{const button=document.createElement('button');button.type='button';button.title=`${index+1} · ${color.label}`;button.dataset.annotationKey=String(index+1);button.style.setProperty('--annotation-color',color.hex);const dot=document.createElement('i');const key=document.createElement('small');key.textContent=String(index+1);button.append(dot,key);button.addEventListener('click',()=>{if(pending)void save(pending,color);});palette.appendChild(button);});
  const comment=document.createElement('button');comment.type='button';comment.className='annotation-comment';comment.dataset.annotationKey='m';comment.textContent='M';comment.title='M · Comment';comment.addEventListener('click',()=>{if(pending)void saveComment(pending);});palette.appendChild(comment);document.body.appendChild(palette);
  const selectionAnchor=():HtmlAnchor|null=>{const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed)return null;const range=selection.getRangeAt(0);if(!content.contains(range.commonAncestorContainer))return null;const quote=selection.toString();if(!quote.trim())return null;const before=document.createRange();before.selectNodeContents(content);before.setEnd(range.startContainer,range.startOffset);const source=readerText(),startOffset=before.toString().length,endOffset=startOffset+quote.length;return{quote:source.slice(startOffset,endOffset),startOffset,endOffset,prefix:source.slice(Math.max(0,startOffset-250),startOffset),suffix:source.slice(endOffset,endOffset+250),sourceKind:'html',locator:'webarchive-reader',rects:[]};};
  const showPalette=()=>{pending=selectionAnchor();if(!pending){palette.hidden=true;return;}const range=window.getSelection()!.getRangeAt(0),rect=range.getBoundingClientRect();palette.hidden=false;const bounds=palette.getBoundingClientRect(),lift=matchMedia('(pointer:coarse)').matches?58:8;palette.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-bounds.width-8))}px`;palette.style.top=`${Math.max(8,rect.top-bounds.height-lift)}px`;};
  async function save(anchor:HtmlAnchor,color:typeof annotationColors[number],details:Record<string,unknown>={}){palette.hidden=true;report('saving WebArchive annotation…','saving');const response=await fetch(`/api/library/${encodeURIComponent(referenceId)}/annotations`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...anchor,color:color.hex,category:color.category,...details})});const result=await response.json().catch(()=>({}));if(!response.ok){report(result.error||'Annotation could not be saved','error');return null;}annotations.push(result.annotation);pending=null;window.getSelection()?.removeAllRanges();renderHighlights();window.dispatchEvent(new CustomEvent('seshat:annotations-changed',{detail:{referenceId}}));report('WebArchive annotation saved');return result.annotation as Annotation;}
  async function saveComment(anchor:HtmlAnchor){const annotation=await save(anchor,annotationColors[7],{note:'',reviewStatus:'captured'});if(annotation)window.dispatchEvent(new CustomEvent('seshat:request-edit-annotation',{detail:{referenceId,annotationId:annotation.id}}));}

  const keyboard=(event:KeyboardEvent)=>{if((event.target as HTMLElement|null)?.matches('input,textarea,select,[contenteditable="true"]'))return;const key=event.key.toLowerCase();if(palette.hidden)return;if(/^[1-8]$/.test(key)||key==='m'){event.preventDefault();palette.querySelector<HTMLButtonElement>(`[data-annotation-key="${key}"]`)?.click();}};
  const annotationsChanged=async(event:Event)=>{if((event as CustomEvent).detail?.referenceId!==referenceId)return;const response=await fetch(`/api/library/${encodeURIComponent(referenceId)}/annotations`);if(!response.ok)return;annotations=((await response.json()).annotations||[]).filter((item:Annotation)=>item.sourceKind==='html');renderHighlights();};
  const provideSource=(event:Event)=>{const detail=(event as CustomEvent<ReaderSourceDetail>).detail;if(!detail||detail.load)return;detail.kind='html';detail.load=async()=>readerText();};
  const locate=(event:Event)=>{const detail=(event as CustomEvent<ReaderLocationDetail>).detail||{},start=Math.max(0,Number(detail.start)||0),end=Math.max(start+1,Number(detail.end)||start+String(detail.text||'').length),range=rangeAt(start,end);if(!range)return;const registry=(CSS as any).highlights,Highlight=(window as any).Highlight;if(registry&&typeof Highlight==='function')registry.set('seshat-read-aloud',new Highlight(range));(range.startContainer.parentElement||content).scrollIntoView({block:'center',behavior:'smooth'});};
  const clearLocate=()=>{(CSS as any).highlights?.delete?.('seshat-read-aloud');};
  const invert=(event:Event)=>shell.classList.toggle('is-inverted',Boolean((event as CustomEvent<{active?:boolean}>).detail?.active));
  const persist=(keepalive=false)=>{const max=Math.max(1,scroll.scrollHeight-scroll.clientHeight),fraction=Math.max(0,Math.min(1,scroll.scrollTop/max));readingLocation=updateReadingLocation(readingLocation,{format:'html',fraction});void fetch(`/api/library/${encodeURIComponent(referenceId)}/reading-state`,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({location:readingLocation,preferences:{}}),...(keepalive?{keepalive:true}:{signal:controller.signal})}).catch(()=>undefined);element.dispatchEvent(new CustomEvent('seshat:reader-controls',{detail:{format:'text',progress:fraction}}));};
  const onScroll=()=>{window.clearTimeout(saveTimer);saveTimer=window.setTimeout(persist,500);};
  scroll.addEventListener('mouseup',()=>window.setTimeout(showPalette));scroll.addEventListener('touchend',()=>window.setTimeout(showPalette));scroll.addEventListener('keyup',(event)=>{if(event.key==='Shift'||event.key.startsWith('Arrow'))showPalette();});scroll.addEventListener('scroll',onScroll,{passive:true});document.addEventListener('keydown',keyboard);window.addEventListener('seshat:annotations-changed',annotationsChanged);element.addEventListener('seshat:reader-source',provideSource);element.addEventListener('seshat:html-reader-locate',locate);element.addEventListener('seshat:html-reader-clear',clearLocate);element.addEventListener('seshat:doc-toggle-invert',invert);
  requestAnimationFrame(()=>{const fraction=Math.max(0,Math.min(1,Number(readingLocation.fraction||readingLocation.progress||0)));scroll.scrollTop=fraction*Math.max(0,scroll.scrollHeight-scroll.clientHeight);});report('WebArchive reader ready');
  return()=>{if(disposed)return;window.clearTimeout(saveTimer);persist(true);disposed=true;controller.abort();palette.remove();document.getElementById(styleId)?.remove();renderedNames.forEach((name)=>(CSS as any).highlights?.delete?.(name));document.removeEventListener('keydown',keyboard);window.removeEventListener('seshat:annotations-changed',annotationsChanged);element.removeEventListener('seshat:reader-source',provideSource);element.removeEventListener('seshat:html-reader-locate',locate);element.removeEventListener('seshat:html-reader-clear',clearLocate);element.removeEventListener('seshat:doc-toggle-invert',invert);};
}
