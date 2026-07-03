/**
 * Registro central de módulos del agente RAG.
 *
 * Cada módulo representa una capacidad externa (consultar tickets,
 * obtener datos de CRM, ejecutar búsquedas, etc.) que el agente
 * puede invocar automáticamente según la intención del usuario.
 *
 * Estructura de un módulo:
 * {
 *   name:        string   — identificador único (snake_case)
 *   description: string   — qué hace (OpenAI lo lee para decidir cuándo llamarlo)
 *   parameters:  object   — JSON Schema de los parámetros que necesita
 *   execute:     async fn — recibe los parámetros y retorna { data, summary }
 * }
 */
class ModuleRegistry {
  constructor() {
    this._modules = new Map();
  }

  /**
   * Registra un módulo en el sistema.
   * Si ya existe uno con el mismo nombre, lo reemplaza.
   */
  register(module) {
    const required = ['name', 'description', 'parameters', 'execute'];
    for (const field of required) {
      if (!module[field]) throw new Error(`Módulo inválido: falta el campo "${field}"`);
    }
    if (typeof module.execute !== 'function') {
      throw new Error(`El campo "execute" debe ser una función async`);
    }
    this._modules.set(module.name, module);
    return module.name;
  }

  unregister(name) {
    return this._modules.delete(name);
  }

  getByName(name) {
    return this._modules.get(name) || null;
  }

  getAll() {
    return Array.from(this._modules.values());
  }

  /**
   * Convierte los módulos al formato de "tools" que espera OpenAI
   * para function calling.
   */
  toOpenAITools() {
    return this.getAll().map((mod) => ({
      type: 'function',
      function: {
        name: mod.name,
        description: mod.description,
        parameters: mod.parameters,
      },
    }));
  }

  /**
   * Ejecuta un módulo por nombre con los argumentos dados.
   * @returns {Promise<{data: any, summary: string}>}
   */
  async execute(name, args) {
    const mod = this.getByName(name);
    if (!mod) throw new Error(`Módulo "${name}" no encontrado`);
    return mod.execute(args);
  }

  get size() {
    return this._modules.size;
  }
}

// Singleton exportado
export const moduleRegistry = new ModuleRegistry();
