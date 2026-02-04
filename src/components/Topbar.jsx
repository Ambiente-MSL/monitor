import { useMemo, useCallback, useState } from "react";
import PropTypes from "prop-types";
import { endOfDay, startOfDay, subDays, differenceInCalendarDays } from "date-fns";
import { Bell, LogOut } from "lucide-react";
import DateRangePicker from "./DateRangePicker";
import AccountSelect from "./AccountSelect";
import InfoTooltip from "./InfoTooltip";
import useQueryState from "../hooks/useQueryState";
import { useAuth } from "../context/AuthContext";
import logo from "../assets/logo-dashboard.svg";
import { useNavigate } from "react-router-dom";

const DEFAULT_PRESETS = [
  { id: "7d", label: "7 dias", days: 7 },
  { id: "1m", label: "30 dias", days: 30 },
  { id: "3m", label: "90 dias", days: 90 },
  { id: "6m", label: "180 dias", days: 180 },
  { id: "1y", label: "365 dias", days: 365 },
];

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

function useQueryRange() {
  const [get, set] = useQueryState({});
  const sinceParam = get("since");
  const untilParam = get("until");
  const since = parseDateParam(sinceParam);
  const until = parseDateParam(untilParam);
  return {
    since,
    until,
    setRange(start, end) {
      set({
        since: start ? String(toUnixSeconds(start)) : null,
        until: end ? String(toUnixSeconds(end)) : null,
      });
    },
  };
}

export default function Topbar({
  presets = DEFAULT_PRESETS,
  selectedPreset,
  onPresetSelect,
  onDateChange,
  userName,
  avatarUrl,
  notificationCount = 0,
  className = "",
  showFilters = true,
}) {

  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const { since, until, setRange } = useQueryRange();
  const now = useMemo(() => new Date(), []);
  const defaultEnd = useMemo(() => endOfDay(subDays(startOfDay(now), 1)), [now]);

  const uncontrolledPreset = useMemo(() => {
    if (!since || !until) return "custom";
    const diff = differenceInCalendarDays(endOfDay(until), startOfDay(since)) + 1;
    const match = presets.find((preset) => preset.days === diff);
    return match?.id ?? "custom";
  }, [since, until, presets]);

  const activePreset = selectedPreset ?? uncontrolledPreset;

  const handlePresetClick = (preset) => () => {
    if (!preset) return;
    if (typeof onPresetSelect === "function") {
      onPresetSelect(preset.id, preset);
    } else {
      const endDate = defaultEnd;
      const startDate = startOfDay(subDays(endDate, preset.days - 1));
      setRange(startDate, endDate);
    }
  };

  const handleRangeChange = (start, end) => {
    if (typeof onDateChange === "function") {
      onDateChange(start, end);
    } else {
      setRange(start, end);
    }
  };

  const displayNotification = Number.isFinite(notificationCount) && notificationCount > 0;

  const handleLogout = useCallback(async () => {
    if (!signOut || isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await signOut();
      navigate("/login");
    } catch (err) {
      console.error("Falha ao desconectar", err);
    } finally {
      setIsLoggingOut(false);
    }
  }, [isLoggingOut, navigate, signOut]);

  const logoutLabel = isLoggingOut ? "Saindo..." : "Sair";
  return (
    <header className={`topbar topbar--dark ${className}`.trim()}>
      <div className="topbar__inner">
        <div className="topbar__logo">
          <img src={logo} alt="Dashboard Logo" className="topbar__logo-img" />
          <span className="topbar__logo-text">MSL ESTRATÉGIA</span>
        </div>
        <div className="topbar__controls">
          <div className="topbar__notif">
            <button type="button" className="topbar__notif-btn" aria-label="Notificações">
              <Bell size={16} />
              {displayNotification && <span className="topbar__notif-badge">{notificationCount}</span>}
            </button>
          </div>

          {showFilters && (
            <>
              <div className="topbar__chips topbar__chips--compact">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className={`topbar__chip${activePreset === preset.id ? " topbar__chip--active" : ""}`}
                    onClick={handlePresetClick(preset)}
                    title="Período de data predefinido."
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="topbar__range topbar__range--compact">
                <DateRangePicker variant="compact" onRangeChange={handleRangeChange} />
                <InfoTooltip text="Selecione um intervalo de datas para atualizar todos os gráficos e métricas." />
              </div>
            </>
          )}

          <div className="topbar__account">
            <AccountSelect />
          </div>
          <button
            type="button"
            className="topbar__logout-btn"
            onClick={handleLogout}
            disabled={!signOut || isLoggingOut}
          >
            <LogOut size={16} />
            <span>{logoutLabel}</span>
          </button>
        </div>
      </div>
    </header>
  );
}

Topbar.propTypes = {
  presets: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      days: PropTypes.number.isRequired,
    }),
  ),
  selectedPreset: PropTypes.string,
  onPresetSelect: PropTypes.func,
  onDateChange: PropTypes.func,
  userName: PropTypes.string,
  avatarUrl: PropTypes.string,
  notificationCount: PropTypes.number,
  className: PropTypes.string,
  showFilters: PropTypes.bool,
};
