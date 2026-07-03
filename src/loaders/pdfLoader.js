import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import fs from 'fs';

/**
 * Extrae texto de un archivo PDF y lo divide en chunks
 * @param {string} filePath - Ruta al archivo PDF
 * @param {object} options
 * @param {number} options.chunkSize - Tamaño de cada chunk en caracteres
 * @param {number} options.overlap - Superposición entre chunks
 * @returns {Promise<Array<{text: string, metadata: object}>>}
 */
export async function loadPDF(filePath, { chunkSize = 500, overlap = 50 } = {}) {
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  const text = data.text.replace(/\s+/g, ' ').trim();
  const chunks = splitIntoChunks(text, chunkSize, overlap);

  return chunks.map((chunk, index) => ({
    text: chunk,
    metadata: {
      source: filePath,
      type: 'pdf',
      pages: data.numpages,
      chunkIndex: index,
      totalChunks: chunks.length,
    },
  }));
}

/**
 * Divide texto en chunks con superposición
 */
function splitIntoChunks(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += chunkSize - overlap;
  }

  return chunks;
}
