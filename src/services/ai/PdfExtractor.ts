import * as pdfjsLib from 'pdfjs-dist';

// Safari ReadableStream async iterator polyfill for pdfjs-dist
if (typeof ReadableStream !== 'undefined' && !ReadableStream.prototype[Symbol.asyncIterator]) {
  (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

// Configure the worker source using UNPKG CDN for the specific version
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export class PdfExtractor {
  /**
   * Extracts text from a single PDF File object
   * @param file The PDF File object
   * @returns A promise that resolves to the extracted text
   */
  static async extractTextFromFile(file: File): Promise<string> {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdfDocument = await loadingTask.promise;

    const numPages = pdfDocument.numPages;
    let fullText = '';

    for (let i = 1; i <= numPages; i++) {
      const page = await pdfDocument.getPage(i);
      const textContent = await page.getTextContent();
      
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(' ');
      
      fullText += pageText + '\n\n';
    }

    return fullText.trim();
  }

  /**
   * Extracts text from multiple PDF File objects
   * @param files Array of PDF File objects
   * @returns A promise that resolves to a combined string of all extracted texts
   */
  static async extractTextFromMultipleFiles(files: File[]): Promise<string> {
    const extractionPromises = files.map(file => this.extractTextFromFile(file));
    const extractedTexts = await Promise.all(extractionPromises);
    
    return extractedTexts.join('\n\n--- NEXT DOCUMENT ---\n\n');
  }
}
