import axios from 'axios';
import * as cheerio from 'cheerio';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

/**
 * Detecta si una URL apunta a un PDF (por Content-Type o extensión)
 */
function isPdfUrl(url, contentType = '') {
  if (contentType.includes('application/pdf')) return true;
  const decoded = decodeURIComponent(url.split('?')[0]);
  return decoded.toLowerCase().endsWith('.pdf');
}

/**
 * Extrae texto de una URL (HTML o PDF remoto) y lo divide en chunks
 * @param {string} url
 * @param {object} options
 * @param {number} options.chunkSize
 * @param {number} options.overlap
 * @returns {Promise<Array<{text: string, metadata: object}>>}
 */
export async function loadURL(url, { chunkSize = 500, overlap = 50 } = {}) {
  const response = await axios.get(url, {
    timeout: 30000,
    responseType: 'arraybuffer',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RAGBot/1.0)',
    },
  });

  const contentType = response.headers['content-type'] || '';

  // PDF remoto
  if (isPdfUrl(url, contentType)) {
    const buffer = Buffer.from(response.data);
    const data = await pdfParse(buffer);
    const text = data.text.replace(/\s+/g, ' ').trim();
    const chunks = splitIntoChunks(text, chunkSize, overlap);

    const filename = decodeURIComponent(url.split('/').pop().split('?')[0]);

    return chunks.map((chunk, index) => ({
      text: chunk,
      metadata: {
        source: url,
        title: filename,
        type: 'pdf-url',
        pages: data.numpages,
        chunkIndex: index,
        totalChunks: chunks.length,
        fetchedAt: new Date().toISOString(),
      },
    }));
  }

  // HTML normal
  const html = Buffer.from(response.data).toString('utf-8');
  const $ = cheerio.load(html);

  $('script, style, nav, footer, header, aside, [role="banner"], [role="navigation"]').remove();

  const title = $('title').text().trim();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  const chunks = splitIntoChunks(text, chunkSize, overlap);

  return chunks.map((chunk, index) => ({
    text: chunk,
    metadata: {
      source: url,
      title,
      type: 'url',
      chunkIndex: index,
      totalChunks: chunks.length,
      fetchedAt: new Date().toISOString(),
    },
  }));
}

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
