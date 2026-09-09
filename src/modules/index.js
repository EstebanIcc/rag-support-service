/**
 * Punto de entrada de módulos.
 * Importa y registra aquí todos los módulos que quieras activar.
 */
import { moduleRegistry }    from './registry.js';
import { jelouTicketModule } from './examples/jelouTicketModule.js';
import { jelouTransferTicketModule } from './examples/jelouTransferTicketModule.js';

// Registrar módulos activos
moduleRegistry.register(jelouTicketModule);
moduleRegistry.register(jelouTransferTicketModule);

export { moduleRegistry };
