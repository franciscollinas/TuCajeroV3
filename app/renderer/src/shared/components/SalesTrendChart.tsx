import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import { formatCompactCurrency, formatCurrency } from '../utils/formatters';

export interface SalesTrendPoint {
  name: string;
  ventas: number;
  ingresos: number;
}

const TICK = { fontSize: 12, fill: '#94a3b8' };

/**
 * Ingresos (barras, eje izquierdo en $) y número de ventas (línea, eje derecho).
 * Antes ambas series compartían un solo eje: con ingresos de millones y ventas de
 * decenas, la serie de conteo quedaba pegada a cero y no se veía.
 */
export default function SalesTrendChart({ data }: { data: SalesTrendPoint[] }): JSX.Element {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 10, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
        <XAxis dataKey="name" tick={TICK} axisLine={false} tickLine={false} minTickGap={12} />
        <YAxis yAxisId="ingresos" tick={TICK} axisLine={false} tickLine={false} width={64} tickFormatter={(v: number) => formatCompactCurrency(v)} />
        <YAxis yAxisId="ventas" orientation="right" allowDecimals={false} tick={TICK} axisLine={false} tickLine={false} width={32} />
        <Tooltip
          contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
          formatter={(value: number, name: string) => (name === 'ingresos' ? [formatCurrency(value), 'Ingresos'] : [value, 'Ventas'])}
        />
        <Bar yAxisId="ingresos" dataKey="ingresos" name="ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
        <Line yAxisId="ventas" type="monotone" dataKey="ventas" name="ventas" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: '#6366f1' }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
