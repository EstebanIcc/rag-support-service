import { Router } from 'express';
import { moduleRegistry } from '../modules/registry.js';

const router = Router();

/**
 * GET /modules
 * Lista todos los módulos registrados
 */
router.get('/', (req, res) => {
  const modules = moduleRegistry.getAll().map((m) => ({
    name:        m.name,
    description: m.description,
    parameters:  m.parameters,
  }));

  res.json({ modules, total: modules.length });
});

/**
 * DELETE /modules/:name
 * Desactiva un módulo por nombre
 */
router.delete('/:name', (req, res) => {
  const removed = moduleRegistry.unregister(req.params.name);
  if (!removed) {
    return res.status(404).json({ error: `Módulo "${req.params.name}" no encontrado.` });
  }
  res.json({ message: `Módulo "${req.params.name}" eliminado correctamente.` });
});

export default router;
