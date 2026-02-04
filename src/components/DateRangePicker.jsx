import { useMemo, useState, useEffect, useRef } from "react";
import { addDays, endOfDay, format, startOfDay, differenceInCalendarDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRangePicker as ReactDateRangePicker } from "react-date-range";
import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";
import { Calendar, X, ChevronDown } from "lucide-react";
import useQueryState from "../hooks/useQueryState";

// Configurar timezone para Fortaleza, Brasil (UTC-3)
const parseDateParam = (value) => {
  if (!value) return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;

  // Criar data no timezone de Fortaleza (UTC-3)
  const d = new Date(ms);

  // Ajustar para timezone de Fortaleza se necessário
  const tzOffset = d.getTimezoneOffset() * 60000; // offset em ms
  const localTime = new Date(d.getTime() - tzOffset);

  return Number.isNaN(localTime.getTime()) ? null : localTime;
};

const toUnixSeconds = (date) => {
  if (!date) return null;
  // Garantir que a data está no timezone correto antes de converter
  const tzOffset = date.getTimezoneOffset() * 60000;
  const localDate = new Date(date.getTime() - tzOffset);
  return Math.floor(localDate.getTime() / 1000);
};

const fmt = (d) => {
  if (!d) return "";
  // Formatar data usando locale pt-BR
  return format(d, "dd MMM yy", { locale: ptBR }).toUpperCase();
};

export default function DateRangePicker({ onRangeChange, variant = "default" }) {
  const now = useMemo(() => new Date(), []);
  const todayStart = useMemo(() => startOfDay(now), [now]);
  const defaultEnd = useMemo(() => endOfDay(addDays(todayStart, -1)), [todayStart]);
  const defaultStart = useMemo(() => startOfDay(addDays(defaultEnd, -6)), [defaultEnd]);

  const [get, set] = useQueryState({});
  const qSince = get("since") || "";
  const qUntil = get("until") || "";

  const initialStart = startOfDay(parseDateParam(qSince) ?? defaultStart);
  const initialEnd = endOfDay(parseDateParam(qUntil) ?? defaultEnd);

  const [state, setState] = useState([
    {
      startDate: initialStart,
      endDate: initialEnd,
      key: "selection",
    },
  ]);

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);
  const firstSync = useRef(false);

  // Sincronização inicial com URL
  useEffect(() => {
    if (firstSync.current) return;
    if (!qSince && !qUntil && state[0].startDate && state[0].endDate) {
      set({
        since: String(toUnixSeconds(state[0].startDate)),
        until: String(toUnixSeconds(state[0].endDate)),
      });
    }
    firstSync.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qSince, qUntil]);

  // Atualizar datas quando query params mudam
  useEffect(() => {
    const ns = parseDateParam(qSince);
    const ne = parseDateParam(qUntil);
    if (ns && ne) {
      const s = startOfDay(ns);
      const e = endOfDay(ne);
      setState([
        {
          startDate: s,
          endDate: e,
          key: "selection",
        },
      ]);
    } else if (!qSince && !qUntil) {
      setState([
        {
          startDate: defaultStart,
          endDate: defaultEnd,
          key: "selection",
        },
      ]);
    }
  }, [qSince, qUntil, defaultStart, defaultEnd]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const updateQuery = (s, e) => {
    if (s && e) {
      set({ since: String(toUnixSeconds(s)), until: String(toUnixSeconds(e)) });
      onRangeChange?.(s, e);
    } else {
      set({ since: null, until: null });
      const defaultStartDate = defaultStart;
      const defaultEndDate = defaultEnd;
      onRangeChange?.(defaultStartDate, defaultEndDate);
    }
  };

  const handleRangeChange = (item) => {
    setState([item.selection]);
  };

  const applyRange = () => {
    const { startDate, endDate } = state[0];
    if (startDate && endDate) {
      const s = startOfDay(startDate);
      const e = endOfDay(endDate);
      updateQuery(s, e);
      setIsOpen(false);
    }
  };

  const clearDates = () => {
    setState([
      {
        startDate: defaultStart,
        endDate: defaultEnd,
        key: "selection",
      },
    ]);
    updateQuery(defaultStart, defaultEnd);
    setIsOpen(false);
  };

  const selectPreset = (days) => {
    const s = startOfDay(addDays(defaultEnd, -(days - 1)));
    const e = defaultEnd;
    setState([
      {
        startDate: s,
        endDate: e,
        key: "selection",
      },
    ]);
    updateQuery(s, e);
    setIsOpen(false);
  };

  const presets = [
    { days: 7, label: "Últimos 7 dias" },
    { days: 15, label: "Últimos 15 dias" },
    { days: 30, label: "Últimos 30 dias" },
    { days: 60, label: "Últimos 60 dias" },
    { days: 90, label: "Últimos 90 dias" },
  ];

  const { startDate, endDate } = state[0];

  const activeDays = startDate && endDate
    ? Math.max(
      1,
      differenceInCalendarDays(startOfDay(endDate), startOfDay(startDate)) + 1,
    )
    : null;

  const wrapperClass = `date-range-wrapper-new${
    variant === "compact" ? " date-range-wrapper-new--compact" : ""
  }`;

  return (
    <div className={wrapperClass}>
      {variant !== "compact" &&
        presets.slice(0, 4).map(({ days, label }) => (
          <button
            key={days}
            type="button"
            className={`date-range-preset-new ${
              activeDays === days ? "date-range-preset-new--active" : ""
            }`}
            onClick={() => selectPreset(days)}
          >
            {label}
          </button>
        ))}

      <div className="date-range-custom-new" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="date-range-btn-new"
          data-open={isOpen || undefined}
        >
          <Calendar size={14} className="date-range-btn-new__icon" />
          <span className="date-range-btn-new__text">
            {startDate && endDate ? `${fmt(startDate)} — ${fmt(endDate)}` : "Selecione o período"}
          </span>
          <ChevronDown
            size={14}
            className={`date-range-btn-new__chevron ${isOpen ? "date-range-btn-new__chevron--open" : ""}`}
          />
        </button>

        {isOpen && (
          <div className="date-range-dropdown-new">
            <div className="date-range-dropdown-new__header">
              <span className="date-range-dropdown-new__title">Selecionar período</span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="date-range-dropdown-new__close"
                aria-label="Fechar"
              >
                <X size={16} />
              </button>
            </div>

            <div className="date-range-dropdown-new__body">
              <div className="date-range-dropdown-new__calendar">
                <ReactDateRangePicker
                  onChange={handleRangeChange}
                  moveRangeOnFirstSelection={false}
                  months={1}
                  ranges={state}
                  direction="horizontal"
                  locale={ptBR}
                  maxDate={new Date()}
                  rangeColors={["#a855f7"]}
                  showMonthAndYearPickers={true}
                  showDateDisplay={false}
                />
              </div>
            </div>

            <div className="date-range-dropdown-new__footer">
              <button
                type="button"
                className="date-range-dropdown-new__btn date-range-dropdown-new__btn--secondary"
                onClick={clearDates}
              >
                Limpar
              </button>
              <button
                type="button"
                className="date-range-dropdown-new__btn date-range-dropdown-new__btn--primary"
                onClick={applyRange}
                disabled={!startDate || !endDate}
              >
                Aplicar período
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
