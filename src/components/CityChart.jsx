import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { MapPin } from 'lucide-react';
import CustomChartTooltip from './CustomChartTooltip';
import { formatCompactNumber, formatTooltipNumber } from '../lib/chartFormatters';

/**
 * Gráfico de barras horizontais para mostrar distribuição por cidades
 *
 * @param {Object} props
 * @param {Array} props.data - Array de objetos {name, value, percentage}
 * @param {string} props.title - Título do gráfico
 */
export default function CityChart({ data, title = 'Principais Cidades' }) {
  if (!data || data.length === 0) {
    return (
      <div className="chart-empty">
        <MapPin size={32} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
        <p style={{ fontSize: '0.875rem', color: 'var(--muted)' }}>Sem dados de cidades disponíveis</p>
      </div>
    );
  }

  // Cores para as barras (gradiente de azul)
  const colors = [
    '#3b82f6', // blue-500
    '#60a5fa', // blue-400
    '#93c5fd', // blue-300
    '#bfdbfe', // blue-200
    '#dbeafe', // blue-100
    '#eff6ff', // blue-50
    '#f0f9ff', // blue-50/50
    '#f8fafc', // slate-50
  ];

  return (
    <div className="chart-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <MapPin size={20} style={{ color: 'var(--primary)' }} />
        <h3 style={{ fontSize: '1rem', fontWeight: '600', margin: 0 }}>{title}</h3>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 5, right: 30, left: 10, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
          <XAxis
            type="number"
            stroke="var(--muted)"
            fontSize={12}
            tickFormatter={(value) => formatCompactNumber(value)}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="var(--muted)"
            fontSize={12}
            width={150}
            tick={{ fill: 'var(--foreground)' }}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface)' }}
            content={(
              <CustomChartTooltip
                labelFormatter={(value) => String(value || "")}
                labelMap={{ value: "Total" }}
                valueFormatter={formatTooltipNumber}
              />
            )}
          />
          <Bar dataKey="value" radius={[0, 4, 4, 0]}>
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
