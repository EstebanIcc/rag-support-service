import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { loadPDF, loadPDFFromBase64 } from '../loaders/pdfLoader.js';
import { loadURL } from '../loaders/urlLoader.js';
import { vectorStore } from '../vectorStore/inMemoryStore.js';
import { upsertModule } from '../knowledge/ragKnowledge.js';

const router = Router();

// Configurar multer para subida de PDFs
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Solo se aceptan archivos PDF'), false);
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE) || 500;
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP) || 50;

/**
 * POST /ingest/pdf
 * Form-data: file (PDF)
 */
router.post('/pdf', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se proporcionó ningún archivo PDF.' });
  }

  const filePath = req.file.path;

  try {
    const chunks = await loadPDF(filePath, { chunkSize: CHUNK_SIZE, overlap: CHUNK_OVERLAP });
    const documentId = uuidv4();

    vectorStore.registerDocument({
      id: documentId,
      source: req.file.originalname,
      type: 'pdf',
    });

    const count = await vectorStore.addChunks(chunks, documentId);

    res.json({
      message: 'PDF ingestado correctamente.',
      documentId,
      filename: req.file.originalname,
      chunksCreated: count,
    });
  } catch (err) {
    console.error('[/ingest/pdf]', err.message);
    res.status(500).json({ error: 'Error procesando el PDF.', detail: err.message });
  } finally {
    // Limpiar archivo temporal
    fs.unlink(filePath, () => {});
  }
});

/**
 * POST /ingest/url
 * Body: { url: string }
 */
router.post('/url', async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'El campo "url" es requerido.' });
  }

  try {
    new URL(url); // Validar formato URL
  } catch {
    return res.status(400).json({ error: 'La URL proporcionada no es válida.' });
  }

  try {
    const chunks = await loadURL(url, { chunkSize: CHUNK_SIZE, overlap: CHUNK_OVERLAP });
    const documentId = uuidv4();

    vectorStore.registerDocument({
      id: documentId,
      source: url,
      type: 'url',
    });

    const count = await vectorStore.addChunks(chunks, documentId);

    res.json({
      message: 'URL ingestada correctamente.',
      documentId,
      url,
      chunksCreated: count,
    });
  } catch (err) {
    console.error('[/ingest/url]', err.message);
    res.status(500).json({ error: 'Error procesando la URL.', detail: err.message });
  }
});

/**
 * POST /ingest/base64
 *
 * Body:
 *   base64      (string, requerido) — PDF codificado en base64
 *   moduleName  (string, requerido) — nombre del módulo (ej: "onboarding soporte")
 *   fileName    (string, opcional)  — nombre original del archivo
 *
 * Flujo:
 *   1. Decodifica base64 → extrae texto del PDF
 *   2. Guarda/actualiza en PocketBase (RAG_DB)
 *   3. Carga chunks en el vector store para búsqueda semántica inmediata
 *
 * Ejemplo:
 *   curl -X POST http://localhost:3000/ingest/base64 \
 *     -H "Content-Type: application/json" \
 *     -d '{"base64":"JVBERi0x...","moduleName":"onboarding soporte","fileName":"manual.pdf"}'
 */
router.post('/base64', async (req, res) => {
  const { base64, moduleName, fileName = 'documento.pdf' } = req.body;

  if (!base64 || typeof base64 !== 'string') {
    return res.status(400).json({ error: 'El campo "base64" es requerido.' });
  }
  if (!moduleName || typeof moduleName !== 'string' || moduleName.trim() === '') {
    return res.status(400).json({ error: 'El campo "moduleName" es requerido (ej: "onboarding soporte").' });
  }

  const name = moduleName.trim();

  try {
    // 1. Parsear PDF desde base64
    console.log('\n[/ingest/base64] Procesando módulo "' + name + '"...');
    const { chunks, text, totalPages } = await loadPDFFromBase64(
      base64,
      name,
      fileName,
      { chunkSize: CHUNK_SIZE, overlap: CHUNK_OVERLAP },
    );

    console.log('[/ingest/base64] Chunks generados:', chunks.length, '| Páginas:', totalPages);

    // 2. Guardar en PocketBase (crea o actualiza si el moduleName ya existe)
    const { record, isNew } = await upsertModule({
      moduleName: name,
      content:    text,
      fileName:   fileName,
      totalPages: totalPages,
    });

    console.log('[/ingest/base64] PocketBase', isNew ? 'creado' : 'actualizado', '— id:', record.id);

    // 3. Si el módulo ya existía, eliminar sus chunks anteriores del vector store
    if (!isNew) {
      vectorStore.removeDocument(record.id);
      console.log('[/ingest/base64] Chunks anteriores eliminados del vector store.');
    }

    // 4. Registrar y cargar los nuevos chunks en el vector store
    vectorStore.registerDocument({ id: record.id, source: name, type: 'pdf-base64' });
    const count = await vectorStore.addChunks(chunks, record.id);

    console.log('[/ingest/base64] Vector store actualizado —', count, 'chunks cargados.\n');

    return res.json({
      ok:         true,
      action:     isNew ? 'created' : 'updated',
      moduleName: name,
      fileName:   fileName,
      totalPages: totalPages,
      chunks:     count,
      recordId:   record.id,
    });

  } catch (err) {
    console.error('[/ingest/base64]', err.message);
    return res.status(500).json({ error: 'Error procesando el PDF en base64.', detail: err.message });
  }
});

export default router;
