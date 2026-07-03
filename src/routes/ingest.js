import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { loadPDF } from '../loaders/pdfLoader.js';
import { loadURL } from '../loaders/urlLoader.js';
import { vectorStore } from '../vectorStore/inMemoryStore.js';

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

export default router;
