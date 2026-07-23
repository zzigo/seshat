export type ReaderSearchRequestDetail = { query:string; direction?:-1|0|1 };
export type ReaderSearchResultDetail = { query:string; current:number; total:number; searching?:boolean; error?:string };

export const normalizeReaderSearchText=(value:string)=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();

export const readerTextMatchOffsets=(source:string,query:string,maximum=5000)=>{
  const text=normalizeReaderSearchText(source),needle=normalizeReaderSearchText(query),matches:number[]=[];
  if(!needle)return matches;
  let offset=0;
  while(matches.length<maximum){
    const index=text.indexOf(needle,offset);if(index<0)break;matches.push(index);offset=index+Math.max(1,needle.length);
  }
  return matches;
};

export const mountReaderSearch=(container:HTMLElement,trigger?:HTMLButtonElement)=>{
  const panel=document.createElement('div');panel.className='reader-search-panel';panel.hidden=true;panel.setAttribute('role','search');
  const input=document.createElement('input');input.type='search';input.placeholder='Search within item…';input.autocomplete='off';input.spellcheck=false;input.setAttribute('aria-label','Search within item');
  const previous=document.createElement('button');previous.type='button';previous.innerHTML='‹';previous.title='Previous match';previous.ariaLabel=previous.title;
  const next=document.createElement('button');next.type='button';next.innerHTML='›';next.title='Next match';next.ariaLabel=next.title;
  const count=document.createElement('output');count.value='—';count.ariaLabel='Search results';
  const close=document.createElement('button');close.type='button';close.innerHTML='×';close.title='Close search';close.ariaLabel=close.title;
  panel.append(input,previous,next,count,close);container.appendChild(panel);
  let timer=0,lastQuery='';
  const request=(direction:-1|0|1=0)=>{const query=input.value.trim();lastQuery=query;container.dispatchEvent(new CustomEvent<ReaderSearchRequestDetail>('seshat:reader-search',{detail:{query,direction}}));};
  const open=()=>{panel.hidden=false;window.requestAnimationFrame(()=>{input.focus();input.select();});};
  const hide=()=>{panel.hidden=true;input.value='';lastQuery='';count.value='—';request(0);};
  input.addEventListener('input',()=>{window.clearTimeout(timer);timer=window.setTimeout(()=>request(0),140);});
  input.addEventListener('keydown',(event)=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();request(event.shiftKey?-1:1);}else if(event.key==='Escape'){event.preventDefault();hide();}});
  previous.addEventListener('click',()=>request(-1));next.addEventListener('click',()=>request(1));close.addEventListener('click',hide);trigger?.addEventListener('click',open);
  const openRequested=()=>open();
  const keydown=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();event.stopPropagation();open();}};
  const results=(event:Event)=>{const detail=(event as CustomEvent<ReaderSearchResultDetail>).detail;if(!detail||detail.query!==lastQuery)return;if(detail.error){count.value='!';count.title=detail.error;return;}count.title='';count.value=detail.searching?'…':detail.total?`${detail.current} / ${detail.total}`:'0 / 0';};
  container.addEventListener('keydown',keydown);container.addEventListener('seshat:reader-search-open',openRequested);container.addEventListener('seshat:reader-search-results',results);
  return()=>{window.clearTimeout(timer);trigger?.removeEventListener('click',open);container.removeEventListener('keydown',keydown);container.removeEventListener('seshat:reader-search-open',openRequested);container.removeEventListener('seshat:reader-search-results',results);panel.remove();};
};
