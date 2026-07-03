/**
 * Punto de entrada de módulos.
 * Importa y registra aquí todos los módulos que quieras activar.
 */
import { moduleRegistry }    from './registry.js';
import { jelouTicketModule } from './examples/jelouTicketModule.js';

// Registrar módulos activos
// ticketModule y orderModule desactivados — reemplazados por jelouTicketModule (consulta_ticket real)
moduleRegistry.register(jelouTicketModule);

export { moduleRegistry };
