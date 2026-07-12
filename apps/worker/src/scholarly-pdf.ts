import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractScholarlyMetadataFromText, type ExtractedPaperMetadata, type ScholarlyPdfExtractor } from '@seshat/core';

export class PdfJsScholarlyExtractor implements ScholarlyPdfExtractor {
  async extract(file:ArrayBuffer):Promise<ExtractedPaperMetadata> {
    const task=getDocument({data:new Uint8Array(file),isEvalSupported:false,useSystemFonts:true}); const pdf=await task.promise;
    try { const metadata=await pdf.getMetadata().catch(()=>({info:{},metadata:null} as any)); const info=(metadata as any)?.info||{}; const lines:string[]=[]; const pages=Math.min(pdf.numPages,1000);
      for(let pageNumber=1;pageNumber<=pages;pageNumber+=1){const page=await pdf.getPage(pageNumber);const content=await page.getTextContent();let line='';let lastY:number|undefined;for(const item of content.items as any[]){if(!('str'in item))continue;const y=Number(item.transform?.[5]);if(lastY!==undefined&&Number.isFinite(y)&&Math.abs(y-lastY)>3){if(line.trim())lines.push(line.trim());line='';}line+=`${item.str} `;lastY=y;}if(line.trim())lines.push(line.trim());}
      const authors=String(info.Author||'').split(/[;,]+/).map((value)=>value.trim()).filter(Boolean);return extractScholarlyMetadataFromText(lines.join('\n'),{title:String(info.Title||'').trim()||undefined,authors:authors.length?authors:undefined,doi:String(info.DOI||'').trim()||undefined,publicationYear:String(info.CreationDate||'').match(/(?:19|20)\d{2}/)?.[0]});
    } finally {await pdf.destroy();}
  }
}
