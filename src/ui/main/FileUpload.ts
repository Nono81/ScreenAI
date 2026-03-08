// ============================================
// ScreenAI — File Upload & Processing
// ============================================

import type { FileCategory, MessageAttachment } from '../../types';
import { generateId } from '../../types';

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
const PDF_EXTS = ['pdf'];
const TEXT_EXTS = [
  'txt', 'md', 'csv', 'json', 'xml', 'html', 'htm',
  'ts', 'tsx', 'js', 'jsx', 'py', 'java', 'cpp', 'c', 'h',
  'go', 'rs', 'rb', 'php', 'swift', 'kt', 'cs',
  'css', 'scss', 'less', 'sql', 'sh', 'bash',
  'yml', 'yaml', 'toml', 'env', 'ini', 'conf',
  'docx', 'xlsx',
];

export const MAX_FILES = 5;
export const MAX_TOTAL_MB = 50;
export const MAX_IMAGE_MB = 20;
export const MAX_PDF_MB = 30;
export const MAX_TEXT_MB = 10;

export const ACCEPT_STRING = [
  ...IMAGE_EXTS.map(e => '.' + e),
  ...PDF_EXTS.map(e => '.' + e),
  ...TEXT_EXTS.map(e => '.' + e),
].join(',');

export function categorizeFile(file: File): FileCategory {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (PDF_EXTS.includes(ext)) return 'pdf';
  if (TEXT_EXTS.includes(ext)) return 'text';
  return 'unsupported';
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export async function processFile(file: File): Promise<MessageAttachment> {
  const type = categorizeFile(file);
  if (type === 'unsupported') {
    const ext = file.name.split('.').pop() || '?';
    throw new Error(`Format .${ext} non supporte. Formats acceptes : images, PDF, texte et code.`);
  }

  const base: MessageAttachment = {
    id: generateId(),
    name: file.name,
    type,
    size: file.size,
    mimeType: file.type || guessMimeType(file.name),
  };

  if (type === 'image') {
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) throw new Error(`${file.name} est trop volumineux (max ${MAX_IMAGE_MB} MB).`);
    base.base64 = await fileToBase64(file);
    base.thumbnail = await generateThumbnail(file, 64, 64);
    return base;
  }

  if (type === 'pdf') {
    if (file.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`${file.name} est trop volumineux (max ${MAX_PDF_MB} MB).`);
    base.base64 = await fileToBase64(file);
    try { base.textContent = await extractPdfText(file); } catch { base.textContent = ''; }
    return base;
  }

  // text
  if (file.size > MAX_TEXT_MB * 1024 * 1024) throw new Error(`${file.name} est trop volumineux (max ${MAX_TEXT_MB} MB).`);
  try { base.textContent = await file.text(); } catch { throw new Error(`Encodage non supporte pour ${file.name}.`); }
  return base;
}

export interface ValidationResult {
  valid: File[];
  errors: string[];
}

export function validateFiles(incoming: File[], existing: MessageAttachment[]): ValidationResult {
  const errors: string[] = [];
  const valid: File[] = [];
  let totalBytes = existing.reduce((s, f) => s + f.size, 0);

  if (existing.length >= MAX_FILES) {
    errors.push(`Maximum ${MAX_FILES} fichiers par message.`);
    return { valid: [], errors };
  }

  for (const file of incoming) {
    if (existing.length + valid.length >= MAX_FILES) {
      errors.push(`Maximum ${MAX_FILES} fichiers par message.`);
      break;
    }
    const type = categorizeFile(file);
    if (type === 'unsupported') {
      errors.push(`Format .${file.name.split('.').pop() || '?'} non supporte.`);
      continue;
    }
    if (totalBytes + file.size > MAX_TOTAL_MB * 1024 * 1024) {
      errors.push(`Taille totale trop elevee (max ${MAX_TOTAL_MB} MB).`);
      break;
    }
    totalBytes += file.size;
    valid.push(file);
  }
  return { valid, errors };
}

export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('Erreur de lecture du fichier'));
    reader.readAsDataURL(file);
  });
}

async function generateThumbnail(file: File, w: number, h: number): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      const scale = Math.max(w / img.width, h / img.height);
      const sw = w / scale; const sh = h / scale;
      const sx = (img.width - sw) / 2; const sy = (img.height - sh) / 2;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });
}

async function extractPdfText(file: File): Promise<string> {
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: arrayBuffer }).promise;
  const pageCount = Math.min(pdf.numPages, 100);
  const textParts: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = (content.items as any[]).map((item: any) => item.str || '').join(' ').replace(/\s+/g, ' ').trim();
    if (pageText) textParts.push(`--- Page ${i} ---\n${pageText}`);
  }
  return textParts.join('\n\n');
}

function guessMimeType(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', txt: 'text/plain', md: 'text/plain',
    csv: 'text/csv', json: 'application/json', html: 'text/html', xml: 'text/xml',
    js: 'text/javascript', ts: 'text/typescript', py: 'text/x-python',
  };
  return map[ext] || 'application/octet-stream';
}
