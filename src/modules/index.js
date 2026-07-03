/**
 * Punto de entrada de módulos.
 * Importa y registra aquí todos los módulos que quieras activar.
 */
import { moduleRegistry }    from './registry.js';
import { ticketModule }      from './examples/ticketModule.js';
import { orderModule }       from './examples/orderModule.js';
import { jelouTicketModule } from './examples/jelouTicketModule.js';

// Registrar módulos activos
moduleRegistry.register(ticketModule);
moduleRegistry.register(orderModule);
moduleRegistry.register(jelouTicketModule);

export { moduleRegistry };
