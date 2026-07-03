import { Router } from 'express';
import { vectorStore } from '../vectorStore/inMemoryStore.js';

const router = Router();

/**
 * GET /documents
 * Lista todos los documentos indexados
 */
router.get('/', (req, res) => {
  const documents = vectorStore.getDocuments();
  const stats = vectorStore.getStats();

  res.json({ documents, stats });
});

/**
 * DELETE /documents/:id
 * Elimina un documento del store
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const removed = vectorStore.removeDocument(id);

  if (removed === 0) {
    return res.status(404).json({ error: 'Documento no encontrado.' });
  }

  res.json({ message: `Documento eliminado. Chunks removidos: ${removed}` });
});

export default router;
