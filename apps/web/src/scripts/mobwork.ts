import { setInlineTitle } from '../lib/inline-title';
import { referenceVisualKind } from '../lib/reference-visual';

type MobileItem={id:string;title:string;type:string;persons:string;year:number|null;language:string;format:string;sizeBytes:number;progress:number;readAt:string|null;updatedAt:string};
type MobileLibrary={id:string;name:string;parentId:string|null;itemCount:number};
type MobileQuickFolder={id:string;name:string;depth:number;recentCount:number};
type MobilePayload={libraries:MobileLibrary[];quickFolders?:MobileQuickFolder[]};

const ROW_HEIGHT=72;
const OVERSCAN=5;

export const mountMobwork=(root:HTMLElement)=>{
  const data=JSON.parse(document.getElementById('mobwork-data')?.textContent||'{"libraries":[]}') as MobilePayload;
  const list=root.querySelector<HTMLElement>('[data-mobile-list]')!;
  const spacer=root.querySelector<HTMLElement>('[data-list-spacer]')!;
  const windowHost=root.querySelector<HTMLElement>('[data-list-window]')!;
  const loading=root.querySelector<HTMLElement>('[data-mobile-loading]')!;
  const empty=root.querySelector<HTMLElement>('[data-mobile-empty]')!;
  const status=root.querySelector<HTMLOutputElement>('[data-result-status]')!;
  const resultTitle=root.querySelector<HTMLElement>('[data-result-title]')!;
  const scopeLabel=root.querySelector<HTMLElement>('[data-scope-label]')!;
  const form=root.querySelector<HTMLFormElement>('[data-mobile-search]')!;
  const search=form.elements.namedItem('q') as HTMLInputElement;
  const clear=root.querySelector<HTMLButtonElement>('[data-clear-search]')!;
  const sheet=document.querySelector<HTMLDialogElement>('[data-collection-sheet]')!;
  const collectionList=sheet.querySelector<HTMLElement>('[data-collection-list]')!;
  const quickFolders=root.querySelector<HTMLElement>('[data-quick-folders]')!;
  let items:MobileItem[]=[],hasMore=true,isLoading=false,offset=0,view:'recent'|'all'='recent',libraryId='',libraryName='',query='',requestVersion=0,searchTimer=0;

  const byteLabel=(value:number)=>value>=1_000_000_000?`${(value/1_000_000_000).toFixed(1)} GB`:value>=1_000_000?`${(value/1_000_000).toFixed(value>=10_000_000?0:1)} MB`:value>=1_000?`${Math.round(value/1_000)} KB`:value?`${value} B`:'';
  const updateControls=()=>{
    root.querySelectorAll<HTMLButtonElement>('[data-mobile-view]').forEach((button)=>button.setAttribute('aria-pressed',String(button.dataset.mobileView===view&&!libraryId)));
    clear.hidden=!search.value;
    scopeLabel.textContent=libraryName|| (view==='recent'?'Recent':'All');
    resultTitle.textContent=query?`Results for “${query}”`:libraryName|| (view==='recent'?'Recent readings':'All references');
    status.value=isLoading&&!items.length?'loading…':`${items.length}${hasMore?'+':''} loaded`;
  };

  const renderWindow=()=>{
    const viewport=Math.max(1,list.clientHeight);
    const start=Math.max(0,Math.floor(list.scrollTop/ROW_HEIGHT)-OVERSCAN);
    const end=Math.min(items.length,Math.ceil((list.scrollTop+viewport)/ROW_HEIGHT)+OVERSCAN);
    spacer.style.height=`${items.length*ROW_HEIGHT}px`;
    windowHost.style.transform=`translateY(${start*ROW_HEIGHT}px)`;
    windowHost.replaceChildren();
    for(let index=start;index<end;index+=1){
      const item=items[index];
      const row=document.createElement('button');row.type='button';row.className='mobwork-row';row.setAttribute('role','listitem');row.dataset.referenceId=item.id;
      const format=document.createElement('span');format.className='mobwork-row-format';format.title=(item.format||item.type||'Document').toUpperCase();const glyph=document.createElement('i');glyph.className=`tree-reference-glyph is-${referenceVisualKind(item.format)}`;format.appendChild(glyph);
      const copy=document.createElement('span');copy.className='mobwork-row-copy';const title=document.createElement('strong');setInlineTitle(title,item.title);const meta=document.createElement('small');meta.textContent=[item.persons,item.year?String(item.year):'',item.language].filter(Boolean).join(' · ');copy.append(title,meta);
      const facts=document.createElement('span');facts.className='mobwork-row-facts';const size=document.createElement('small');size.textContent=byteLabel(item.sizeBytes);const arrow=document.createElement('span');arrow.textContent='›';facts.append(size,arrow);
      if(item.progress>0){const meter=document.createElement('i');meter.style.setProperty('--progress',`${Math.max(0,Math.min(100,item.progress))}%`);copy.appendChild(meter);}
      row.append(format,copy,facts);row.addEventListener('click',()=>window.dispatchEvent(new CustomEvent('seshat:open-reader',{detail:{id:item.id,title:item.title}})));windowHost.appendChild(row);
    }
    status.value=isLoading&&!items.length?'loading…':`${items.length}${hasMore?'+':''} loaded · ${end-start} in DOM`;
  };

  const load=async(replace=false)=>{
    if(isLoading&&!replace)return;
    if(replace){requestVersion+=1;items=[];offset=0;hasMore=true;list.scrollTop=0;renderWindow();}
    if(!hasMore)return;
    const version=requestVersion;isLoading=true;loading.hidden=Boolean(items.length);empty.hidden=true;updateControls();
    const url=new URL('/api/library/mobile',location.origin);url.searchParams.set('view',view);url.searchParams.set('limit','60');url.searchParams.set('offset',String(offset));if(libraryId)url.searchParams.set('libraryId',libraryId);if(query)url.searchParams.set('q',query);
    try{const response=await fetch(url,{cache:'no-store'});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||'References could not be loaded.');if(version!==requestVersion)return;const incoming=(result.items||[]) as MobileItem[];items.push(...incoming);offset=items.length;hasMore=Boolean(result.hasMore);empty.hidden=Boolean(items.length);}
    catch(error){if(version===requestVersion){empty.hidden=false;empty.querySelector('strong')!.textContent=error instanceof Error?error.message:'References could not be loaded.';}}
    finally{if(version===requestVersion){isLoading=false;loading.hidden=true;updateControls();renderWindow();}}
  };

  const chooseView=(next:'recent'|'all')=>{view=next;libraryId='';libraryName='';sheet.close();updateControls();void load(true);};
  const chooseLibrary=(id:string,name:string)=>{view='all';libraryId=id;libraryName=name;if(sheet.open)sheet.close();updateControls();void load(true);};
  root.querySelectorAll<HTMLButtonElement>('[data-mobile-view]').forEach((button)=>button.addEventListener('click',()=>chooseView(button.dataset.mobileView==='recent'?'recent':'all')));
  form.addEventListener('submit',(event)=>event.preventDefault());
  search.addEventListener('input',()=>{window.clearTimeout(searchTimer);clear.hidden=!search.value;searchTimer=window.setTimeout(()=>{query=search.value.trim();void load(true);},260);});
  clear.addEventListener('click',()=>{search.value='';query='';clear.hidden=true;search.focus();void load(true);});
  root.querySelector('[data-focus-search]')?.addEventListener('click',()=>search.focus());
  root.querySelectorAll('[data-open-collections]').forEach((button)=>button.addEventListener('click',()=>sheet.showModal()));
  sheet.querySelector('[data-close-collections]')?.addEventListener('click',()=>sheet.close());sheet.addEventListener('click',(event)=>{if(event.target===sheet)sheet.close();});

  const children=new Map<string|null,MobileLibrary[]>();data.libraries.forEach((library)=>{const values=children.get(library.parentId)||[];values.push(library);children.set(library.parentId,values);});children.forEach((values)=>values.sort((a,b)=>a.name.localeCompare(b.name)));
  const addCollection=(library:MobileLibrary,depth:number)=>{const button=document.createElement('button');button.type='button';button.style.setProperty('--depth',String(Math.min(7,depth)));const marker=document.createElement('i');const label=document.createElement('span');label.textContent=library.name;const count=document.createElement('small');count.textContent=String(library.itemCount);button.append(marker,label,count);button.addEventListener('click',()=>chooseLibrary(library.id,library.name));collectionList.appendChild(button);(children.get(library.id)||[]).forEach((child)=>addCollection(child,depth+1));};
  const all=document.createElement('button');all.type='button';all.innerHTML='<i></i><span>All references</span><small>∞</small>';all.addEventListener('click',()=>chooseView('all'));collectionList.appendChild(all);(children.get(null)||[]).forEach((library)=>addCollection(library,0));

  (data.quickFolders||[]).forEach((folder,index)=>{const button=document.createElement('button');button.type='button';button.dataset.tone=String(index%6);button.title=`${folder.name} · level ${folder.depth} · ${folder.recentCount} recent`;const icon=document.createElement('i');const label=document.createElement('span');label.textContent=folder.name;button.append(icon,label);button.addEventListener('click',()=>chooseLibrary(folder.id,folder.name));quickFolders.appendChild(button);});
  quickFolders.hidden=!quickFolders.childElementCount;

  const themeButton=root.querySelector<HTMLButtonElement>('[data-mobile-theme]')!;
  const applyThemeButton=()=>{const dark=document.documentElement.getAttribute('data-theme')==='dark';themeButton.setAttribute('aria-label',dark?'Switch to light theme':'Switch to dark theme');themeButton.dataset.mode=dark?'dark':'light';};
  themeButton.addEventListener('click',()=>{const dark=document.documentElement.getAttribute('data-theme')==='dark';const next=dark?'light':'dark';const preset=localStorage.getItem(`seshat-theme-${next}-preset`)||(next==='dark'?'ink':'papyrus');localStorage.setItem('seshat-theme',next);document.documentElement.setAttribute('data-theme',next);document.documentElement.setAttribute('data-theme-preset',preset);document.documentElement.classList.toggle('dark-theme',next==='dark');window.dispatchEvent(new CustomEvent('seshat:theme-changed',{detail:{theme:next,preset}}));applyThemeButton();});applyThemeButton();

  list.addEventListener('scroll',()=>{renderWindow();if(hasMore&&!isLoading&&list.scrollTop+list.clientHeight>list.scrollHeight-ROW_HEIGHT*10)void load();},{passive:true});
  new ResizeObserver(renderWindow).observe(list);updateControls();void load(true);
};
