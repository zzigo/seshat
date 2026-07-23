export const clampReaderPage=(value:number,total:number)=>Math.max(1,Math.min(Math.max(1,Math.floor(total||1)),Math.floor(value||1)));

export const mountReaderPageInput=(indicator:HTMLElement,onGoto:(page:number)=>void)=>{
  let current=1,total=1,editing=false;
  const paint=()=>{if(!editing)indicator.textContent=`${current} / ${total||'—'}`;};
  const open=()=>{
    if(editing)return;editing=true;const input=document.createElement('input');input.type='number';input.min='1';input.max=String(Math.max(1,total));input.step='1';input.value=String(current);input.className='reader-page-input';input.setAttribute('aria-label',`Go to page, 1 to ${total}`);
    const finish=(commit:boolean)=>{if(!editing)return;editing=false;const next=clampReaderPage(Number(input.value),total);paint();if(commit)onGoto(next);};
    input.addEventListener('click',(event)=>event.stopPropagation());input.addEventListener('keydown',(event)=>{event.stopPropagation();if(event.key==='Enter'){event.preventDefault();finish(true);}else if(event.key==='Escape'){event.preventDefault();finish(false);}});input.addEventListener('blur',()=>finish(true),{once:true});
    indicator.replaceChildren(input);window.requestAnimationFrame(()=>{input.focus();input.select();});
  };
  indicator.tabIndex=0;indicator.setAttribute('role','button');indicator.title='Go to page';indicator.setAttribute('aria-label','Go to page');
  const keydown=(event:KeyboardEvent)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();open();}};
  indicator.addEventListener('click',open);indicator.addEventListener('keydown',keydown);
  paint();
  return{
    update(page:number,pageTotal:number){current=clampReaderPage(page,pageTotal);total=Math.max(1,Math.floor(pageTotal||1));paint();},
    dispose(){indicator.removeEventListener('click',open);indicator.removeEventListener('keydown',keydown);},
  };
};
