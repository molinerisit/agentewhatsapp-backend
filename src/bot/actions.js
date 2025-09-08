// src/bot/actions.js
// Plantillas seguras. Podes editar/añadir las tuyas.
// Usan parámetros $1, $2... (node-postgres los interpola con seguridad).
export const ACTIONS = {
  reservas: [
    {
      id: 'create_appointment',
      description: 'Crear turno',
      sql: `INSERT INTO appointments (customer_name, phone, service, start_time, end_time, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, customer_name, service, start_time, end_time`,
      params: ['customer_name','phone','service','start_time','end_time','notes?'] // ? = opcional
    },
    {
      id: 'cancel_appointment',
      description: 'Cancelar turno por ID',
      sql: `UPDATE appointments SET status='cancelled', cancelled_at=now() WHERE id=$1 RETURNING id, status`,
      params: ['appointment_id']
    },
    {
      id: 'reschedule_appointment',
      description: 'Reprogramar turno',
      sql: `UPDATE appointments
            SET start_time=$2, end_time=$3
            WHERE id=$1
            RETURNING id, start_time, end_time`,
      params: ['appointment_id','new_start_time','new_end_time']
    }
  ],
  ventas: [
    {
      id: 'create_order',
      description: 'Crear pedido simple',
      sql: `INSERT INTO orders (customer_name, customer_phone, total_amount, notes)
            VALUES ($1, $2, $3, $4)
            RETURNING id, customer_name, total_amount, created_at`,
      params: ['customer_name','phone','total_amount','notes?']
    },
    {
      id: 'add_order_item',
      description: 'Agregar item a pedido',
      sql: `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
            VALUES ($1, $2, $3, $4)
            RETURNING id, order_id, product_id, quantity`,
      params: ['order_id','product_id','quantity','unit_price']
    },
    {
      id: 'update_stock',
      description: 'Actualizar stock de producto',
      sql: `UPDATE products SET stock = stock + $2 WHERE id=$1 RETURNING id, stock`,
      params: ['product_id','delta_stock']
    }
  ]
};

export function getActionsForMode(mode='ventas') {
  return ACTIONS[mode] || [];
}

export function findAction(mode, actionId) {
  return getActionsForMode(mode).find(a => a.id === actionId) || null;
}
