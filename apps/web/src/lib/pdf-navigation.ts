export const pdfSpreadStart = (page: number, doublePage: boolean): number => {
  const current = Math.max(1, Math.floor(page));
  if (!doublePage || current === 1) return current;
  return current % 2 === 0 ? current : current - 1;
};

export const adjacentPdfPage = (
  currentPage: number,
  direction: -1 | 1,
  totalPages: number,
  doublePage: boolean,
): number => {
  const total = Math.max(1, Math.floor(totalPages));
  if (!doublePage) return Math.max(1, Math.min(total, currentPage + direction));
  const start = pdfSpreadStart(currentPage, true);
  if (direction > 0) return Math.max(1, Math.min(total, start === 1 ? 2 : start + 2));
  return start <= 2 ? 1 : start - 2;
};

export const pdfPageScrollTop = (offsetTop: number, zoom: number, inset = 0): number =>
  Math.max(0, offsetTop * Math.max(.01, zoom) - Math.max(0, inset));

