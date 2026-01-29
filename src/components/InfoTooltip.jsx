import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";
import PropTypes from "prop-types";

/**
 * Componente de ícone de informação com tooltip.
 * Exibe um ícone (i) que mostra uma dica ao passar o mouse.
 */
export default function InfoTooltip({ text, size = 14, className = "" }) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const iconRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    if (visible && iconRef.current && tooltipRef.current) {
      const iconRect = iconRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let top = iconRect.bottom + 8;
      let left = iconRect.left + iconRect.width / 2 - tooltipRect.width / 2;

      // Ajustar se sair da tela horizontalmente
      if (left < 8) {
        left = 8;
      } else if (left + tooltipRect.width > viewportWidth - 8) {
        left = viewportWidth - tooltipRect.width - 8;
      }

      // Ajustar se sair da tela verticalmente (mostrar acima)
      if (top + tooltipRect.height > viewportHeight - 8) {
        top = iconRect.top - tooltipRect.height - 8;
      }

      setPosition({ top, left });
    }
  }, [visible]);

  return (
    <span
      className={`info-tooltip ${className}`.trim()}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      tabIndex={0}
      role="button"
      aria-label="Informação"
    >
      <span ref={iconRef} className="info-tooltip__icon">
        <Info size={size} />
      </span>
      {visible && (
        <span
          ref={tooltipRef}
          className="info-tooltip__content"
          style={{ top: position.top, left: position.left }}
          role="tooltip"
        >
          {text}
        </span>
      )}
    </span>
  );
}

InfoTooltip.propTypes = {
  text: PropTypes.string.isRequired,
  size: PropTypes.number,
  className: PropTypes.string,
};
