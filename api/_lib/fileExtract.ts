// Raw text extraction from uploaded source documents. Purely mechanical — no
// AI involved here, just turning a file's bytes into plain text. What that text
// means (which parts are the price, the scope, etc.) is a separate step in
// api/extract.ts, deliberately kept apart from this so the "can we even read
// this file" failure mode is distinct from "did the model extract this well."

export const MAX_FILE_BYTES = 4 * 1024 * 1024 // 4MB per file — generous for text-heavy documents

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx'] as const

export interface ExtractedFile {
  name: string
  text: string
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

// pdf-parse inserts "-- N of M --" page-break markers into getText() output;
// strip them so they don't confuse the field-extraction prompt downstream.
function cleanPdfText(text: string): string {
  return text
    .replace(/--\s*\d+\s*of\s*\d+\s*--/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function extractTextFromFile(filename: string, buffer: Buffer): Promise<ExtractedFile> {
  const ext = extensionOf(filename)

  if (ext === '.txt' || ext === '.md') {
    return { name: filename, text: buffer.toString('utf-8') }
  }

  if (ext === '.pdf') {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: buffer })
    try {
      const result = await parser.getText()
      return { name: filename, text: cleanPdfText(result.text) }
    } finally {
      await parser.destroy()
    }
  }

  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return { name: filename, text: result.value }
  }

  if (ext === '.doc') {
    throw new Error(
      `"${filename}" is a legacy .doc file (pre-2007 Word format), which has no reliable text extraction in this environment. Please re-save it as .docx, or paste the text directly.`,
    )
  }

  throw new Error(`"${filename}" has an unsupported file type. Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`)
}
