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

  // Paths SVG para cada estado brasileiro (coordenadas baseadas em projeção Mercator)
  const statePaths = {
    // Norte
    'AC': 'M 50 280 L 70 265 L 85 268 L 95 275 L 98 290 L 92 305 L 82 312 L 68 310 L 55 298 Z',
    'AM': 'M 98 290 L 115 280 L 135 270 L 155 265 L 175 268 L 190 275 L 200 290 L 205 310 L 198 325 L 185 335 L 165 340 L 145 338 L 125 330 L 110 318 L 102 305 Z',
    'RR': 'M 185 200 L 200 195 L 215 198 L 228 205 L 235 218 L 238 235 L 235 252 L 225 265 L 210 268 L 195 265 L 185 255 L 180 240 L 182 220 Z',
    'PA': 'M 238 235 L 255 230 L 275 228 L 295 230 L 312 235 L 328 243 L 342 255 L 352 270 L 358 288 L 358 305 L 352 320 L 340 332 L 325 338 L 308 340 L 290 338 L 275 332 L 260 323 L 248 310 L 242 295 L 238 278 Z',
    'AP': 'M 315 190 L 330 185 L 345 188 L 355 195 L 360 208 L 360 223 L 355 238 L 345 248 L 330 250 L 318 245 L 312 235 L 310 220 L 312 205 Z',
    'TO': 'M 325 338 L 340 332 L 355 330 L 368 332 L 380 338 L 388 348 L 392 362 L 392 378 L 388 393 L 380 405 L 368 412 L 352 415 L 338 412 L 328 405 L 322 393 L 320 378 L 322 360 Z',
    'RO': 'M 165 340 L 180 335 L 195 333 L 210 335 L 222 340 L 230 348 L 235 360 L 235 373 L 230 385 L 220 393 L 205 398 L 188 398 L 173 393 L 165 383 L 162 368 L 163 353 Z',

    // Nordeste
    'MA': 'M 358 288 L 375 283 L 392 282 L 408 285 L 422 292 L 432 303 L 438 318 L 438 333 L 432 345 L 420 353 L 405 357 L 388 357 L 373 353 L 362 345 L 358 330 L 358 310 Z',
    'PI': 'M 388 357 L 405 355 L 420 356 L 432 360 L 442 368 L 448 380 L 450 395 L 448 410 L 442 422 L 432 430 L 418 435 L 402 436 L 388 433 L 378 425 L 372 413 L 370 398 L 372 383 L 378 370 Z',
    'CE': 'M 438 318 L 455 313 L 472 313 L 486 318 L 496 328 L 502 342 L 502 357 L 496 370 L 485 378 L 470 382 L 455 382 L 442 378 L 435 370 L 432 358 L 433 343 Z',
    'RN': 'M 485 378 L 500 375 L 515 377 L 525 385 L 530 398 L 530 412 L 525 424 L 515 430 L 500 432 L 488 428 L 480 420 L 477 408 L 478 395 Z',
    'PB': 'M 470 382 L 485 380 L 498 382 L 508 388 L 514 398 L 515 410 L 512 422 L 505 430 L 493 435 L 480 436 L 468 432 L 462 424 L 460 413 L 462 400 L 466 390 Z',
    'PE': 'M 442 378 L 460 376 L 477 378 L 490 385 L 498 395 L 502 408 L 502 422 L 498 435 L 490 445 L 477 450 L 462 452 L 448 450 L 438 443 L 432 432 L 430 418 L 432 403 L 436 390 Z',
    'AL': 'M 462 452 L 475 450 L 487 451 L 496 456 L 502 465 L 504 476 L 502 487 L 496 496 L 486 502 L 474 504 L 462 502 L 453 496 L 448 487 L 447 476 L 449 465 Z',
    'SE': 'M 448 450 L 462 448 L 474 449 L 484 454 L 490 463 L 492 474 L 490 485 L 484 494 L 474 500 L 462 502 L 450 500 L 443 494 L 440 485 L 440 474 L 442 463 Z',
    'BA': 'M 370 398 L 388 395 L 408 394 L 428 396 L 445 402 L 458 412 L 468 425 L 474 440 L 476 457 L 474 474 L 468 490 L 458 503 L 445 513 L 428 520 L 408 523 L 388 523 L 370 518 L 355 510 L 343 498 L 335 483 L 330 467 L 328 450 L 330 433 L 338 418 L 350 407 Z',

    // Centro-Oeste
    'MT': 'M 162 368 L 180 363 L 200 360 L 220 360 L 238 363 L 255 370 L 270 380 L 282 393 L 290 408 L 295 425 L 296 442 L 294 458 L 288 473 L 278 485 L 265 495 L 248 502 L 230 505 L 212 505 L 195 500 L 180 492 L 168 480 L 160 465 L 156 448 L 155 432 L 157 416 L 160 400 L 163 385 Z',
    'GO': 'M 322 378 L 340 373 L 358 370 L 375 370 L 390 373 L 403 380 L 413 390 L 420 403 L 423 418 L 423 433 L 420 448 L 413 461 L 403 471 L 390 478 L 375 482 L 358 483 L 340 480 L 325 473 L 313 463 L 305 450 L 300 435 L 298 420 L 300 405 L 306 392 Z',
    'DF': 'M 358 420 L 365 417 L 372 418 L 377 423 L 378 430 L 375 437 L 368 440 L 361 439 L 356 434 L 355 427 Z',
    'MS': 'M 248 502 L 265 498 L 283 496 L 300 497 L 316 502 L 330 510 L 340 522 L 347 537 L 350 553 L 350 568 L 347 582 L 340 595 L 330 605 L 316 612 L 300 616 L 283 617 L 265 615 L 248 610 L 233 602 L 220 590 L 210 575 L 203 558 L 200 542 L 200 527 L 203 512 L 213 500 Z',

    // Sudeste
    'MG': 'M 358 483 L 378 480 L 398 479 L 416 481 L 432 486 L 446 494 L 457 505 L 465 519 L 470 535 L 472 551 L 470 567 L 465 581 L 457 593 L 446 602 L 432 608 L 416 611 L 398 612 L 378 610 L 360 605 L 345 597 L 333 586 L 325 572 L 320 557 L 318 542 L 320 527 L 326 513 L 337 501 Z',
    'SP': 'M 300 616 L 318 613 L 336 612 L 353 614 L 368 619 L 381 627 L 391 638 L 398 651 L 402 665 L 403 679 L 400 692 L 393 703 L 383 711 L 370 716 L 355 718 L 338 718 L 321 715 L 306 709 L 293 700 L 283 688 L 276 674 L 272 659 L 271 645 L 273 631 L 279 619 Z',
    'RJ': 'M 398 612 L 415 610 L 431 611 L 445 615 L 457 622 L 466 632 L 472 644 L 475 657 L 475 670 L 472 682 L 466 693 L 457 701 L 445 707 L 431 710 L 415 711 L 400 709 L 387 704 L 377 696 L 370 686 L 366 674 L 365 662 L 367 650 L 373 639 L 383 630 Z',
    'ES': 'M 432 608 L 447 605 L 461 605 L 474 608 L 485 614 L 493 623 L 498 634 L 500 646 L 500 658 L 497 669 L 491 678 L 482 685 L 471 689 L 458 691 L 445 690 L 434 686 L 426 679 L 421 670 L 418 659 L 418 648 L 421 637 L 427 627 Z',

    // Sul
    'PR': 'M 283 688 L 300 684 L 318 682 L 335 683 L 350 687 L 363 694 L 373 704 L 380 716 L 384 729 L 385 742 L 383 754 L 378 765 L 370 774 L 359 781 L 346 785 L 331 787 L 316 786 L 301 782 L 288 775 L 278 765 L 271 753 L 267 740 L 266 727 L 268 714 L 274 702 Z',
    'SC': 'M 316 786 L 333 784 L 350 784 L 365 787 L 378 793 L 389 802 L 397 814 L 402 827 L 404 840 L 403 852 L 399 863 L 392 872 L 382 879 L 370 884 L 356 886 L 341 886 L 326 883 L 313 877 L 302 868 L 294 857 L 289 844 L 287 831 L 288 818 L 292 806 L 300 796 Z',
    'RS': 'M 266 852 L 283 848 L 301 846 L 318 847 L 334 851 L 348 858 L 360 868 L 369 880 L 375 894 L 378 908 L 378 922 L 375 935 L 369 947 L 360 957 L 348 965 L 334 970 L 318 973 L 301 973 L 283 970 L 268 964 L 255 955 L 245 943 L 238 929 L 234 914 L 233 899 L 235 885 L 241 872 L 251 861 Z'
  };

  // Posições dos labels dos estados
  const stateLabelPositions = {
    // Norte
    'AC': { x: 72, y: 292 },
    'AM': { x: 150, y: 308 },
    'RR': { x: 210, y: 232 },
    'PA': { x: 300, y: 285 },
    'AP': { x: 335, y: 218 },
    'TO': { x: 355, y: 375 },
    'RO': { x: 197, y: 368 },

    // Nordeste
    'MA': { x: 398, y: 318 },
    'PI': { x: 410, y: 395 },
    'CE': { x: 468, y: 345 },
    'RN': { x: 505, y: 395 },
    'PB': { x: 488, y: 408 },
    'PE': { x: 467, y: 415 },
    'AL': { x: 478, y: 478 },
    'SE': { x: 466, y: 474 },
    'BA': { x: 408, y: 458 },

    // Centro-Oeste
    'MT': { x: 220, y: 432 },
    'GO': { x: 360, y: 430 },
    'DF': { x: 367, y: 428 },
    'MS': { x: 275, y: 560 },

    // Sudeste
    'MG': { x: 410, y: 545 },
    'SP': { x: 345, y: 665 },
    'RJ': { x: 425, y: 660 },
    'ES': { x: 462, y: 647 },

    // Sul
    'PR': { x: 330, y: 735 },
    'SC': { x: 355, y: 835 },
    'RS': { x: 310, y: 910 }
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
      <svg
        viewBox="0 0 580 1000"
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: 'auto', maxHeight: '700px', filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.08))' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Fundo do mapa */}
        <rect x="0" y="0" width="580" height="1000" fill="transparent" />

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
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={1}
                style={{
                  transition: 'all 0.3s ease',
                  cursor: hasData ? 'pointer' : 'default'
                }}
                onMouseEnter={(e) => {
                  if (hasData) {
                    e.target.style.strokeWidth = '3';
                    e.target.style.filter = 'brightness(1.1)';
                    e.target.style.stroke = '#374151';
                  }
                }}
                onMouseLeave={(e) => {
                  e.target.style.strokeWidth = '2';
                  e.target.style.filter = 'brightness(1)';
                  e.target.style.stroke = strokeColor;
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
                fontSize="11"
                fontWeight="700"
                fill={hasData ? '#1f2937' : '#9ca3af'}
                textAnchor="middle"
                pointerEvents="none"
                style={{ userSelect: 'none', textShadow: '0 1px 2px rgba(255,255,255,0.8)' }}
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
