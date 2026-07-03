import axios from 'axios';

/**
 * Módulo: consulta_pedido
 *
 * Consulta el estado de un pedido/orden.
 * Configura en .env:
 *
 *   ORDERS_API_URL=https://tu-ecommerce.com/api
 *   ORDERS_API_KEY=tu-api-key
 */
export const orderModule = {
  name: 'consulta_pedido',

  description:
    'Consulta el estado, ubicación o detalles de un pedido u orden de compra. ' +
    'Úsalo cuando el usuario pregunte por su pedido, envío, compra o número de orden.',

  parameters: {
    type: 'object',
    properties: {
      order_id: {
        type: 'string',
        description: 'El ID o número del pedido (ej: "ORD-9988", "00123")',
      },
    },
    required: ['order_id'],
  },

  async execute({ order_id }) {
    const baseUrl = process.env.ORDERS_API_URL;
    const apiKey  = process.env.ORDERS_API_KEY;

    if (!baseUrl || !apiKey) {
      return demoResponse(order_id);
    }

    const response = await axios.get(`${baseUrl}/orders/${order_id}`, {
      timeout: 10000,
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    const o = response.data;
    return {
      data: o,
      summary:
        `Pedido #${o.id} | Estado: ${o.status} | ` +
        `Total: ${o.total} | Envío: ${o.shipping_status} | ` +
        `Entrega estimada: ${o.estimated_delivery}`,
    };
  },
};

function demoResponse(orderId) {
  return {
    data: {
      id: orderId,
      status: 'Enviado',
      total: '$149.99',
      shipping_status: 'En camino',
      carrier: 'DHL',
      tracking: 'DHL123456789',
      estimated_delivery: '2026-06-12',
      items: [{ name: 'Producto A', qty: 2 }, { name: 'Producto B', qty: 1 }],
    },
    summary:
      `Pedido #${orderId} | Estado: Enviado | ` +
      `Envío: En camino (DHL) | Entrega estimada: 2026-06-12`,
  };
}
