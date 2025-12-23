import React, { useMemo } from 'react';

/**
 * Mapa do Ceará com municípios preenchidos por intensidade de cor
 * baseado nos valores de investimento/gasto
 */

const CearaMap = ({ data = [], colorScale = '#6366f1', emptyColor = '#f3f4f6', strokeColor = '#9ca3af' }) => {

  // Normalizar dados para municípios
  const normalizedData = useMemo(() => {
    const dataMap = {};

    data.forEach(item => {
      const name = item.name;
      const value = Number(item.value) || 0;

      // Normalizar nome da cidade removendo acentos e convertendo para lowercase
      const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

      dataMap[normalized] = {
        ...item,
        value,
        originalName: name
      };
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

  // Principais municípios do Ceará (simplificados para demonstração)
  // Em produção, você deve usar paths SVG reais dos municípios
  const cityPaths = {
    'fortaleza': 'M 380 220 L 420 215 L 440 230 L 450 260 L 440 290 L 410 300 L 380 295 L 365 275 L 370 245 Z',
    'caucaia': 'M 340 230 L 365 225 L 380 245 L 375 270 L 355 280 L 330 270 L 320 250 Z',
    'juazeiro do norte': 'M 380 520 L 410 515 L 430 530 L 435 555 L 425 575 L 400 580 L 375 570 L 365 545 Z',
    'sobral': 'M 200 180 L 235 175 L 255 190 L 260 215 L 245 235 L 215 240 L 190 225 L 185 200 Z',
    'maracanau': 'M 355 265 L 380 260 L 395 275 L 390 295 L 370 305 L 350 300 L 340 285 Z',
    'crato': 'M 425 540 L 455 535 L 470 550 L 475 570 L 465 590 L 440 595 L 420 585 L 415 565 Z',
    'itapipoca': 'M 260 210 L 290 205 L 310 220 L 315 240 L 305 260 L 280 265 L 255 250 L 250 230 Z',
    'maranguape': 'M 390 250 L 415 245 L 430 260 L 435 280 L 425 300 L 405 305 L 385 295 L 380 275 Z',
    'aquiraz': 'M 430 250 L 455 245 L 470 260 L 475 280 L 465 300 L 445 305 L 425 295 L 420 275 Z',
    'iguatu': 'M 330 380 L 360 375 L 380 390 L 385 415 L 375 435 L 350 440 L 325 430 L 320 405 Z',
    'quixada': 'M 280 300 L 310 295 L 330 310 L 335 335 L 325 355 L 300 360 L 275 350 L 270 325 Z',
    'caninde': 'M 240 270 L 270 265 L 290 280 L 295 305 L 285 325 L 260 330 L 235 320 L 230 295 Z',
    'pacajus': 'M 410 280 L 435 275 L 450 290 L 455 310 L 445 330 L 425 335 L 405 325 L 400 305 Z',
    'crateus': 'M 150 260 L 180 255 L 200 270 L 205 295 L 195 315 L 170 320 L 145 310 L 140 285 Z',
    'horizonte': 'M 400 310 L 425 305 L 440 320 L 445 340 L 435 360 L 415 365 L 395 355 L 390 335 Z'
  };

  // Posições dos labels
  const cityLabelPositions = {
    'fortaleza': { x: 410, y: 260 },
    'caucaia': { x: 345, y: 255 },
    'juazeiro do norte': { x: 400, y: 550 },
    'sobral': { x: 220, y: 210 },
    'maracanau': { x: 365, y: 285 },
    'crato': { x: 445, y: 565 },
    'itapipoca': { x: 285, y: 235 },
    'maranguape': { x: 408, y: 275 },
    'aquiraz': { x: 450, y: 275 },
    'iguatu': { x: 355, y: 410 },
    'quixada': { x: 305, y: 330 },
    'caninde': { x: 265, y: 300 },
    'pacajus': { x: 425, y: 308 },
    'crateus': { x: 170, y: 290 },
    'horizonte': { x: 418, y: 338 }
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
      <svg
        viewBox="0 0 600 700"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', maxHeight: '600px', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Fundo do mapa */}
        <rect x="0" y="0" width="600" height="700" fill="transparent" />

        {/* Contorno do Ceará */}
        <path
          d="M 120 150 L 480 140 L 500 180 L 520 250 L 510 350 L 490 450 L 460 550 L 420 620 L 360 650 L 280 640 L 220 600 L 180 530 L 150 450 L 130 350 L 120 250 Z"
          fill="none"
          stroke="#d1d5db"
          strokeWidth="2"
          strokeDasharray="4,4"
          opacity="0.3"
        />

        {Object.entries(cityPaths).map(([cityKey, path]) => {
          const cityData = normalizedData[cityKey];
          const fillColor = cityData ? getColorForValue(cityData.value) : emptyColor;
          const hasData = cityData && cityData.value > 0;
          const labelPos = cityLabelPositions[cityKey] || { x: 0, y: 0 };
          const cityName = cityData?.originalName || cityKey.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

          return (
            <g key={cityKey}>
              <path
                id={cityKey}
                d={path}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={1}
                style={{
                  transition: 'all 0.3s ease',
                  cursor: hasData ? 'pointer' : 'default'
                }}
                onMouseEnter={(e) => {
                  if (hasData) {
                    e.target.style.strokeWidth = '2.5';
                    e.target.style.filter = 'brightness(1.1)';
                    e.target.style.stroke = '#374151';
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.strokeWidth = '1.5';
                  e.target.style.filter = 'brightness(1)';
                  e.target.style.stroke = strokeColor;
                }}
              >
                <title>
                  {cityName}
                  {cityData ? ` - ${formatCurrency(cityData.value)}` : ' - Sem dados'}
                </title>
              </path>

              {/* Label da cidade - mostrar apenas se tiver dados */}
              {hasData && (
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  fontSize="9"
                  fontWeight="600"
                  fill="#1f2937"
                  textAnchor="middle"
                  pointerEvents="none"
                  style={{ userSelect: 'none', textShadow: '0 1px 2px rgba(255,255,255,0.9)' }}
                >
                  {cityName.length > 12 ? cityName.substring(0, 10) + '...' : cityName}
                </text>
              )}
            </g>
          );
        })}

        {/* Título do mapa */}
        <text
          x="300"
          y="50"
          fontSize="20"
          fontWeight="700"
          fill="#374151"
          textAnchor="middle"
          style={{ userSelect: 'none' }}
        >
          Ceará
        </text>
      </svg>
    </div>
  );
};

export default CearaMap;
