type JsonRecord = Record<string, any>;

const semanticKind = (title: string): string => {
  const value = title.toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^\d+(?:\s+\d+)*\s+/, '');
  if (/^(table of contents|contents|indice|contenido)$/.test(value)) return 'toc';
  if (/^(introduction|introduccion)(\b|$)/.test(value)) return 'introduction';
  if (/^(references|bibliography|works cited|referencias|bibliografia)(\b|$)/.test(value)) return 'references';
  if (/^(appendix|appendices|apendice|anexo)(\b|$)/.test(value)) return 'appendix';
  return 'section';
};
const sectionLevel = (title: string, explicit: unknown): number => {
  const numbered = title.match(/^\s*(\d+(?:\.\d+){0,5})(?:[.)]|\s)/);
  if (numbered) return Math.min(6, numbered[1].split('.').length);
  return Math.max(1, Math.min(6, Number.isInteger(explicit) ? Number(explicit) : 1));
};

export const buildDocumentStructure = (document: JsonRecord): JsonRecord => {
  const collectionNames = ['texts', 'pictures', 'tables', 'groups', 'key_value_items', 'form_items'];
  const collections = new Map(collectionNames.map((name) => [name, Array.isArray(document[name]) ? document[name] : []]));
  const resolve = (reference: unknown): JsonRecord | null => {
    const path = reference && typeof reference === 'object' ? String((reference as JsonRecord).$ref || '') : '';
    const match = path.match(/^#\/(\w+)\/(\d+)$/); if (!match) return null;
    return collections.get(match[1])?.[Number(match[2])] || null;
  };
  const pageOf = (item: JsonRecord): number | undefined => {
    const page = Array.isArray(item.prov) ? item.prov.find((entry: JsonRecord) => Number(entry?.page_no) > 0)?.page_no : undefined;
    return Number(page) > 0 ? Number(page) : undefined;
  };
  const ordered: JsonRecord[] = [];
  const walk = (reference: unknown): void => {
    const item = resolve(reference); if (!item || item.content_layer === 'furniture' || ['page_header', 'page_footer'].includes(item.label)) return;
    if (Array.isArray(item.children) && ['list', 'ordered_list', 'group'].includes(item.label)) { item.children.forEach(walk); return; }
    ordered.push(item);
  };
  if (Array.isArray(document.body?.children)) document.body.children.forEach(walk);

  const sections: JsonRecord[] = []; const blocks: JsonRecord[] = []; const parents: Array<[number, string]> = [];
  const kindMap: Record<string, string> = { text:'paragraph', paragraph:'paragraph', formula:'formula', picture:'picture', table:'table', list_item:'list', caption:'caption', code:'code', checkbox_selected:'form', checkbox_unselected:'form', key_value_area:'form' };
  let currentSection: string | null = null;
  for (const item of ordered) {
    const label = String(item.label || 'text'); const text = String(item.text || item.orig || '').trim(); const page = pageOf(item);
    if (['section_header', 'title'].includes(label) && text) {
      const level = sectionLevel(text, item.level);
      while (parents.length && parents.at(-1)![0] >= level) parents.pop();
      const id = `section-${sections.length + 1}`;
      sections.push({ id, level, title:text, parentId:parents.at(-1)?.[1] || null, page, kind:semanticKind(text) });
      parents.push([level, id]); currentSection = id; continue;
    }
    const kind = kindMap[label] || 'paragraph'; if (kind === 'paragraph' && !text) continue;
    blocks.push({ id:`block-${blocks.length + 1}`, kind, label, page, sectionId:currentSection, text:text ? text.slice(0, 240) : null });
  }
  return { schemaVersion:2, sections, blocks };
};
