export type WasabiOrphan = {
  key: string;
  path: string;
  filename: string;
  directory: string;
  sizeBytes: number;
  lastModified?: string;
};

export type WasabiOrphanAudit = {
  objects: WasabiOrphan[];
  count: number;
  scanned: number;
  truncated: boolean;
  root: string;
  paths: string[];
  error?: string;
};

type OrphanDialogOptions = {
  paths?: string[];
  title?: string;
  report?: (message:string,kind?:'saving'|'success'|'error')=>void;
};

const bytesLabel = (value:number) => value >= 1_000_000_000
  ? `${(value/1_000_000_000).toFixed(1)} GB`
  : value >= 1_000_000
    ? `${(value/1_000_000).toFixed(value>=10_000_000?0:1)} MB`
    : value >= 1_000
      ? `${Math.round(value/1_000)} KB`
      : value ? `${value} B` : '0 B';

export const loadWasabiOrphans = async (paths:string[]=[]):Promise<WasabiOrphanAudit> => {
  const query=new URLSearchParams();
  [...new Set(paths.map((path)=>String(path)))].forEach((path)=>query.append('path',path));
  const response=await fetch(`/api/wasabi/orphans${query.size?`?${query}`:''}`,{cache:'no-store'});
  const result=await response.json().catch(()=>({})) as Partial<WasabiOrphanAudit>;
  if(!response.ok)throw new Error(result.error||'Orphan files could not be audited.');
  return{
    objects:Array.isArray(result.objects)?result.objects:[],
    count:Number(result.count||0),
    scanned:Number(result.scanned||0),
    truncated:Boolean(result.truncated),
    root:String(result.root||''),
    paths:Array.isArray(result.paths)?result.paths:paths,
  };
};

const deleteWasabiOrphans = async (keys:string[]) => {
  const response=await fetch('/api/wasabi/orphans',{
    method:'DELETE',
    headers:{'content-type':'application/json'},
    body:JSON.stringify({keys}),
  });
  const result=await response.json().catch(()=>({})) as {error?:string;deleted?:string[];blocked?:string[]};
  if(!response.ok)throw new Error(result.error||'Orphan files could not be deleted.');
  return{deleted:Array.isArray(result.deleted)?result.deleted:[],blocked:Array.isArray(result.blocked)?result.blocked:[]};
};

export const openWasabiOrphanDialog = async (options:OrphanDialogOptions={}) => {
  document.querySelector<HTMLDialogElement>('[data-wasabi-orphan-dialog]')?.close();
  const paths=[...new Set((options.paths||[]).map((path)=>String(path)))];
  const dialog=document.createElement('dialog');dialog.className='wasabi-orphan-dialog';dialog.dataset.wasabiOrphanDialog='';
  const form=document.createElement('form');form.addEventListener('submit',(event)=>event.preventDefault());
  const header=document.createElement('header');const heading=document.createElement('div');const eyebrow=document.createElement('small');eyebrow.textContent='SANITIZE WASABI';const title=document.createElement('strong');title.textContent=options.title||'Orphan files';heading.append(eyebrow,title);
  const close=document.createElement('button');close.type='button';close.textContent='×';close.ariaLabel='Close orphan audit';close.addEventListener('click',()=>dialog.close());header.append(heading,close);
  const filter=document.createElement('input');filter.type='search';filter.placeholder='Search orphan filenames or paths…';filter.ariaLabel='Search orphan files';
  const tools=document.createElement('div');tools.className='wasabi-orphan-tools';const selectVisible=document.createElement('button');selectVisible.type='button';selectVisible.textContent='Select visible';const clearSelection=document.createElement('button');clearSelection.type='button';clearSelection.textContent='Clear';const status=document.createElement('output');status.value='Checking Wasabi links…';tools.append(selectVisible,clearSelection,status);
  const list=document.createElement('div');list.className='wasabi-orphan-list';
  const footer=document.createElement('footer');const scope=document.createElement('small');scope.textContent=paths.length?`${paths.length} affected folder${paths.length===1?'':'s'}`:'Full Wasabi library root';const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='Delete selected';remove.disabled=true;footer.append(scope,remove);
  form.append(header,filter,tools,list,footer);dialog.appendChild(form);(document.fullscreenElement||document.body).appendChild(dialog);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});dialog.addEventListener('click',(event)=>{if(event.target===dialog)dialog.close();});dialog.showModal();

  let audit:WasabiOrphanAudit|undefined;
  const selected=new Set<string>();
  let armed=false;
  const visible=()=>audit?.objects.filter((object)=>{const needle=filter.value.trim().toLocaleLowerCase();return!needle||`${object.filename} ${object.path}`.toLocaleLowerCase().includes(needle);})||[];
  const resetDelete=()=>{armed=false;remove.textContent='Delete selected';remove.disabled=!selected.size;};
  const render=()=>{
    const rows=visible();list.replaceChildren();
    for(const object of rows){
      const row=document.createElement('label');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=selected.has(object.key);checkbox.addEventListener('change',()=>{if(checkbox.checked)selected.add(object.key);else selected.delete(object.key);resetDelete();});
      const copy=document.createElement('span');const name=document.createElement('strong');name.textContent=object.filename;const path=document.createElement('small');path.textContent=object.path;copy.append(name,path);
      const facts=document.createElement('span');facts.textContent=[bytesLabel(object.sizeBytes),object.lastModified?new Date(object.lastModified).toLocaleDateString():''].filter(Boolean).join(' · ');row.append(checkbox,copy,facts);list.appendChild(row);
    }
    if(!rows.length){const empty=document.createElement('p');empty.textContent=audit?.objects.length?'No orphan files match this search.':'No orphan documents were found in this scope.';list.appendChild(empty);}
    status.value=audit?`${audit.objects.length} orphan${audit.objects.length===1?'':'s'} · ${audit.scanned} objects checked${audit.truncated?' · result limit reached':''}`:'Checking Wasabi links…';
    resetDelete();
  };
  filter.addEventListener('input',render);
  selectVisible.addEventListener('click',()=>{visible().forEach((object)=>selected.add(object.key));render();});
  clearSelection.addEventListener('click',()=>{selected.clear();render();});
  remove.addEventListener('click',async()=>{
    if(!selected.size)return;
    if(!armed){armed=true;remove.textContent=`Confirm delete ${selected.size}`;status.value='Confirm to permanently delete only the selected orphan files.';return;}
    const keys=[...selected];remove.disabled=true;status.value=`Deleting ${keys.length} orphan file${keys.length===1?'':'s'}…`;options.report?.('deleting selected Wasabi orphans…','saving');
    try{
      const result=await deleteWasabiOrphans(keys);const deleted=new Set(result.deleted);audit!.objects=audit!.objects.filter((object)=>!deleted.has(object.key));audit!.count=audit!.objects.length;result.deleted.forEach((key)=>selected.delete(key));result.blocked.forEach((key)=>selected.delete(key));render();
      const message=`${result.deleted.length} orphan file${result.deleted.length===1?'':'s'} deleted${result.blocked.length?` · ${result.blocked.length} protected because now linked`:''}`;
      status.value=message;options.report?.(message,'success');window.dispatchEvent(new CustomEvent('seshat:wasabi-orphans-changed',{detail:{count:audit!.objects.length,scope:paths.length?'folder':'root'}}));
    }catch(error){status.value=error instanceof Error?error.message:'Orphan files could not be deleted.';options.report?.(status.value,'error');resetDelete();}
  });
  try{audit=await loadWasabiOrphans(paths);render();window.dispatchEvent(new CustomEvent('seshat:wasabi-orphans-changed',{detail:{count:audit.objects.length,scope:paths.length?'folder':'root'}}));filter.focus();}
  catch(error){status.value=error instanceof Error?error.message:'Orphan files could not be audited.';options.report?.(status.value,'error');const empty=document.createElement('p');empty.textContent=status.value;list.replaceChildren(empty);}
  return dialog;
};
