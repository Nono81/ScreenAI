// ============================================
// ScreenAI — PDF Export
// ============================================

import { jsPDF } from 'jspdf';

export async function generatePdfBlob(
  canvas: HTMLCanvasElement,
  ocrText?: string,
): Promise<Blob> {
  const imgData = canvas.toDataURL('image/png');
  const imgWidth = canvas.width;
  const imgHeight = canvas.height;

  const isLandscape = imgWidth > imgHeight;
  const pageWidth = isLandscape ? 297 : 210;
  const pageHeight = isLandscape ? 210 : 297;
  const margin = 10;
  const maxW = pageWidth - margin * 2;
  const maxH = pageHeight - margin * 2 - 20; // 20mm for header/footer

  // px to mm: 1px ≈ 0.264583mm at 96dpi
  const pxToMm = 0.264583;
  const ratio = Math.min(maxW / (imgWidth * pxToMm), maxH / (imgHeight * pxToMm));
  const pdfW = imgWidth * pxToMm * ratio;
  const pdfH = imgHeight * pxToMm * ratio;
  const xOff = (pageWidth - pdfW) / 2;

  const pdf = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  // Header
  pdf.setFontSize(9);
  pdf.setTextColor(150, 150, 150);
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR') + ' a ' + now.toLocaleTimeString('fr-FR');
  pdf.text(`ScreenAI  -  Capture du ${dateStr}`, margin, margin + 4);

  // Image
  pdf.addImage(imgData, 'PNG', xOff, margin + 10, pdfW, pdfH);

  // Footer — dimensions
  pdf.setFontSize(8);
  pdf.setTextColor(180, 180, 180);
  pdf.text(`${imgWidth} x ${imgHeight} px`, pageWidth / 2, pageHeight - margin, {
    align: 'center',
  });

  // Page 2 — OCR text (optional)
  if (ocrText && ocrText.trim().length > 0) {
    pdf.addPage();
    pdf.setFontSize(14);
    pdf.setTextColor(50, 50, 50);
    pdf.text('Texte extrait', margin, margin + 8);

    pdf.setFontSize(10);
    pdf.setTextColor(80, 80, 80);
    const lines = pdf.splitTextToSize(ocrText, maxW);
    pdf.text(lines, margin, margin + 18);
  }

  return pdf.output('blob') as unknown as Blob;
}
