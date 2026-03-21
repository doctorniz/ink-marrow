import { degrees, PDFDocument, rgb } from 'pdf-lib'
import type { PdfNewPageOptions } from '@/types/pdf'

const PAGE_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const

export async function createBlankPdf(options: PdfNewPageOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create()

  const size = options.size === 'custom'
    ? { width: options.customWidth ?? 595.28, height: options.customHeight ?? 841.89 }
    : PAGE_SIZES[options.size]

  const page = doc.addPage([size.width, size.height])

  if (options.style !== 'blank') {
    await drawPageStyle(page, options.style, size)
  }

  return doc.save()
}

async function drawPageStyle(
  page: ReturnType<PDFDocument['addPage']>,
  style: 'lined' | 'grid' | 'dot-grid',
  size: { width: number; height: number },
): Promise<void> {
  const lineColor = rgb(0.85, 0.85, 0.85)
  const margin = 50
  const spacing = style === 'lined' ? 24 : 15

  switch (style) {
    case 'lined': {
      page.drawLine({
        start: { x: margin + 20, y: size.height - margin },
        end: { x: margin + 20, y: margin },
        thickness: 0.5,
        color: rgb(0.9, 0.6, 0.6),
      })
      for (let y = size.height - margin - spacing; y > margin; y -= spacing) {
        page.drawLine({
          start: { x: margin, y },
          end: { x: size.width - margin, y },
          thickness: 0.3,
          color: lineColor,
        })
      }
      break
    }
    case 'grid': {
      for (let y = margin; y <= size.height - margin; y += spacing) {
        page.drawLine({
          start: { x: margin, y },
          end: { x: size.width - margin, y },
          thickness: 0.2,
          color: lineColor,
        })
      }
      for (let x = margin; x <= size.width - margin; x += spacing) {
        page.drawLine({
          start: { x, y: margin },
          end: { x, y: size.height - margin },
          thickness: 0.2,
          color: lineColor,
        })
      }
      break
    }
    case 'dot-grid': {
      for (let y = margin; y <= size.height - margin; y += spacing) {
        for (let x = margin; x <= size.width - margin; x += spacing) {
          page.drawCircle({
            x,
            y,
            size: 0.8,
            color: lineColor,
          })
        }
      }
      break
    }
  }
}

export async function mergePdfs(pdfBytesArray: Uint8Array[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create()

  for (const pdfBytes of pdfBytesArray) {
    const doc = await PDFDocument.load(pdfBytes)
    const pages = await merged.copyPages(doc, doc.getPageIndices())
    for (const page of pages) {
      merged.addPage(page)
    }
  }

  return merged.save()
}

export async function extractPages(
  pdfBytes: Uint8Array,
  startPage: number,
  endPage: number,
): Promise<Uint8Array> {
  const source = await PDFDocument.load(pdfBytes)
  const extracted = await PDFDocument.create()

  const indices = Array.from(
    { length: endPage - startPage + 1 },
    (_, i) => startPage + i,
  )

  const pages = await extracted.copyPages(source, indices)
  for (const page of pages) {
    extracted.addPage(page)
  }

  return extracted.save()
}

export async function deletePage(
  pdfBytes: Uint8Array,
  pageIndex: number,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  doc.removePage(pageIndex)
  return doc.save()
}

export async function rotatePage(
  pdfBytes: Uint8Array,
  pageIndex: number,
  deg: 0 | 90 | 180 | 270,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  const page = doc.getPage(pageIndex)
  const nextAngle = (page.getRotation().angle + deg) % 360
  page.setRotation(degrees(nextAngle))
  return doc.save()
}
