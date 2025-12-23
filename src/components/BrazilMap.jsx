import React, { useMemo } from 'react';

/**
 * Mapa do Brasil com estados preenchidos por intensidade de cor
 * baseado nos valores de investimento/gasto
 */
// Mapear nomes completos dos estados para suas siglas (constante fora do componente)
const STATE_NAME_TO_CODE = {
  'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM',
  'Bahia': 'BA', 'Ceará': 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES',
  'Goiás': 'GO', 'Maranhão': 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB', 'Paraná': 'PR',
  'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC',
  'São Paulo': 'SP', 'Sergipe': 'SE', 'Tocantins': 'TO'
};

const BrazilMap = ({ data = [], colorScale = '#6366f1', emptyColor = '#f3f4f6', strokeColor = '#9ca3af' }) => {

  // Normalizar dados para incluir tanto nome completo quanto sigla
  const normalizedData = useMemo(() => {
    const dataMap = {};

    data.forEach(item => {
      const name = item.name;
      const value = Number(item.value) || 0;

      // Tentar encontrar código do estado
      let code = null;

      // Procurar por nome completo
      if (STATE_NAME_TO_CODE[name]) {
        code = STATE_NAME_TO_CODE[name];
      }
      // Procurar por sigla diretamente
      else if (Object.values(STATE_NAME_TO_CODE).includes(name)) {
        code = name;
      }
      // Procurar parcialmente (ex: "São Paulo" vs "Sao Paulo")
      else {
        const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
        const found = Object.keys(STATE_NAME_TO_CODE).find(stateName =>
          stateName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase() === normalized
        );
        if (found) {
          code = STATE_NAME_TO_CODE[found];
        }
      }

      if (code) {
        dataMap[code] = {
          ...item,
          value,
          code
        };
      }
    });

    return dataMap;
  }, [data]);

  // Calcular valores máximo e mínimo para escala de cores
  const { minValue, maxValue } = useMemo(() => {
    const values = Object.values(normalizedData).map(d => d.value).filter(v => v > 0);
    return {
      minValue: Math.min(...values, 0),
      maxValue: Math.max(...values, 0)
    };
  }, [normalizedData]);

  // Função para calcular cor baseada no valor (escala de intensidade)
  const getColorForValue = (value) => {
    if (!value || value === 0 || maxValue === 0) {
      return emptyColor;
    }

    // Normalizar valor entre 0 e 1
    const normalized = (value - minValue) / (maxValue - minValue);

    // Converter hex para RGB
    const hex = colorScale.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Interpolar entre cor clara (25% opacity) e cor escura (100% opacity)
    const minOpacity = 0.25;
    const maxOpacity = 1.0;
    const opacity = minOpacity + (normalized * (maxOpacity - minOpacity));

    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };

  // Formatação de moeda
  const formatCurrency = (num) => {
    if (typeof num !== 'number') return 'R$ 0,00';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(num);
  };

  // Paths SVG para cada estado brasileiro (coordenadas simplificadas mas proporcionais)
  const statePaths = {
    // Norte
    'AC': 'M85,250 L100,240 L115,245 L120,260 L110,275 L95,270 Z',
    'AM': 'M120,180 L180,170 L200,185 L190,220 L160,230 L130,215 Z',
    'RR': 'M200,90 L230,85 L245,105 L235,130 L210,125 Z',
    'PA': 'M250,170 L320,165 L340,190 L330,230 L280,235 Z',
    'AP': 'M280,110 L300,100 L315,110 L310,130 L295,135 Z',
    'TO': 'M320,240 L355,235 L370,260 L360,290 L330,285 Z',
    'RO': 'M180,270 L215,265 L230,285 L220,310 L190,305 Z',

    // Nordeste
    'MA': 'M350,210 L385,205 L400,220 L395,245 L365,240 Z',
    'PI': 'M360,240 L395,235 L410,255 L400,280 L370,275 Z',
    'CE': 'M410,220 L440,215 L455,230 L450,250 L425,245 Z',
    'RN': 'M445,235 L465,230 L475,245 L470,260 L455,255 Z',
    'PB': 'M435,255 L455,250 L465,265 L460,280 L445,275 Z',
    'PE': 'M420,260 L450,255 L465,275 L455,295 L430,290 Z',
    'AL': 'M420,305 L435,300 L445,310 L440,325 L425,320 Z',
    'SE': 'M430,295 L445,290 L455,305 L450,320 L440,315 Z',
    'BA': 'M380,280 L420,275 L435,295 L430,340 L400,350 L370,330 Z',

    // Centro-Oeste
    'MT': 'M240,270 L290,265 L305,300 L295,335 L250,330 Z',
    'GO': 'M310,320 L350,315 L365,340 L355,370 L320,365 Z',
    'DF': 'M330,340 L340,335 L345,345 L340,355 Z',
    'MS': 'M270,380 L310,375 L325,400 L315,430 L280,425 Z',

    // Sudeste
    'MG': 'M340,350 L390,345 L405,370 L395,400 L350,395 Z',
    'SP': 'M330,400 L370,395 L385,420 L375,450 L340,445 Z',
    'RJ': 'M370,405 L395,400 L410,420 L400,440 L380,435 Z',
    'ES': 'M385,380 L400,375 L410,390 L405,405 L390,400 Z',

    // Sul
    'PR': 'M310,430 L350,425 L365,445 L355,470 L320,465 Z',
    'SC': 'M320,470 L355,465 L370,485 L360,510 L330,505 Z',
    'RS': 'M300,500 L340,495 L355,520 L345,550 L310,545 Z'
  };

  // Posições dos labels dos estados
  const stateLabelPositions = {
    // Norte
    'AC': { x: 102, y: 258 },
    'AM': { x: 155, y: 203 },
    'RR': { x: 222, y: 108 },
    'PA': { x: 285, y: 198 },
    'AP': { x: 297, y: 118 },
    'TO': { x: 345, y: 263 },
    'RO': { x: 202, y: 283 },

    // Nordeste
    'MA': { x: 372, y: 223 },
    'PI': { x: 385, y: 258 },
    'CE': { x: 432, y: 233 },
    'RN': { x: 460, y: 243 },
    'PB': { x: 450, y: 263 },
    'PE': { x: 442, y: 273 },
    'AL': { x: 432, y: 313 },
    'SE': { x: 447, y: 303 },
    'BA': { x: 405, y: 313 },

    // Centro-Oeste
    'MT': { x: 267, y: 298 },
    'GO': { x: 337, y: 343 },
    'DF': { x: 342, y: 345 },
    'MS': { x: 297, y: 403 },

    // Sudeste
    'MG': { x: 367, y: 373 },
    'SP': { x: 357, y: 418 },
    'RJ': { x: 392, y: 418 },
    'ES': { x: 397, y: 388 },

    // Sul
    'PR': { x: 337, y: 448 },
    'SC': { x: 345, y: 483 },
    'RS': { x: 325, y: 523 }
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
      <svg
        viewBox="0 0 500 600"
        style={{ width: '100%', height: 'auto', maxHeight: '600px' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {Object.entries(statePaths).map(([code, path]) => {
          const stateData = normalizedData[code];
          const fillColor = stateData ? getColorForValue(stateData.value) : emptyColor;
          const hasData = stateData && stateData.value > 0;
          const labelPos = stateLabelPositions[code] || { x: 0, y: 0 };

          return (
            <g key={code}>
              <path
                id={code}
                d={path}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth="1.5"
                opacity={1}
                style={{
                  transition: 'all 0.3s ease',
                  cursor: hasData ? 'pointer' : 'default'
                }}
                onMouseEnter={(e) => {
                  if (hasData) {
                    e.target.style.strokeWidth = '3';
                    e.target.style.filter = 'brightness(1.1)';
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.strokeWidth = '1.5';
                  e.target.style.filter = 'brightness(1)';
                }}
              >
                <title>
                  {code}
                  {stateData ? ` - ${formatCurrency(stateData.value)}` : ' - Sem dados'}
                </title>
              </path>

              {/* Label do estado */}
              <text
                x={labelPos.x}
                y={labelPos.y}
                fontSize="10"
                fontWeight="600"
                fill={hasData ? '#1f2937' : '#9ca3af'}
                textAnchor="middle"
                pointerEvents="none"
                style={{ userSelect: 'none' }}
              >
                {code}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};

export default BrazilMap;
