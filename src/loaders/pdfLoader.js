import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import fs from 'fs';

/**
 * Extrae texto de un archivo PDF (ruta) y lo divide en chunks.
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
 * Extrae texto de un PDF en base64 y lo divide en chunks.
 *
 * @param {string} base64     - Contenido del PDF codificado en base64
 * @param {string} moduleName - Nombre del módulo (ej: "onboarding soporte")
 * @param {string} fileName   - Nombre original del archivo
 * @param {object} options
 * @returns {Promise<{ chunks: Array, text: string, totalPages: number }>}
 */
export async function loadPDFFromBase64(base64, moduleName, fileName = 'archivo.pdf', { chunkSize = 500, overlap = 50 } = {}) {
  console.log('[pdfLoader] Decodificando base64 → Buffer...');

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.length === 0) {
    throw new Error('El base64 proporcionado resultó en un buffer vacío.');
  }

  // Verificar firma PDF (%PDF-)
  const signature = buffer.slice(0, 5).toString('ascii');
  if (!signature.startsWith('%PDF')) {
    throw new Error('El archivo no parece ser un PDF válido (firma incorrecta: "' + signature + '")');
  }

  console.log('[pdfLoader] Buffer OK — tamaño:', buffer.length, 'bytes. Parseando PDF...');

  const data = await pdfParse(buffer);
  const text = data.text.replace(/\s+/g, ' ').trim();

  console.log('[pdfLoader] Texto extraído:', text.length, 'caracteres |', data.numpages, 'páginas');

  const chunks = splitIntoChunks(text, chunkSize, overlap);

  const result = chunks.map((chunk, index) => ({
    text: chunk,
    metadata: {
      source:      moduleName,
      title:       moduleName,
      fileName:    fileName,
      type:        'pdf-base64',
      pages:       data.numpages,
      chunkIndex:  index,
      totalChunks: chunks.length,
    },
  }));

  return {
    chunks:     result,
    text:       text,
    totalPages: data.numpages,
  };
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
