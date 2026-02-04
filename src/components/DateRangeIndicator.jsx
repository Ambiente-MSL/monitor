import { Calendar } from 'lucide-react';
import { format, differenceInCalendarDays, startOfDay } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import useQueryState from '../hooks/useQueryState';

export default function DateRangeIndicator() {
  const [get] = useQueryState();
  const since = get('since');
  const until = get('until');

  if (!since || !until) return null;

  const parseUnixTimestamp = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    return new Date(ms);
  };

  const startDate = parseUnixTimestamp(since);
  const endDate = parseUnixTimestamp(until);

  if (!startDate || !endDate) return null;

  const formatDate = (date) => {
    return format(date, "dd 'de' MMM", { locale: ptBR });
  };

  const daysDiff = Math.max(
    1,
    differenceInCalendarDays(startOfDay(endDate), startOfDay(startDate)) + 1,
  );

  return (
    <div className="date-range-indicator">
      <Calendar size={16} className="date-range-indicator__icon" />
      <div className="date-range-indicator__content">
        <span className="date-range-indicator__label">Período analisado:</span>
        <span className="date-range-indicator__dates">
          {formatDate(startDate)} — {formatDate(endDate)}
        </span>
        <span className="date-range-indicator__days">({daysDiff} dias)</span>
      </div>
    </div>
  );
}
