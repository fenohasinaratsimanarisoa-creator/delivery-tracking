import { useEffect, useRef, useState, useCallback } from 'react';
import type { RouteStep } from '../../services/routing/types';
import i18n from '../../services/i18n/i18n';
import { getLanguage } from '../../services/i18n/i18n';

const DEVIATION_THRESHOLD_M = 50;
const ARRIVAL_THRESHOLD_M = 100;
const INSTRUCTION_ANNOUNCE_DISTANCE_M = 150;
const DEVIATION_CHECK_INTERVAL_MS = 5000;

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return haversineDistance(ax, ay, px, py);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return haversineDistance(px, py, cx, cy);
}

function distanceToPolyline(lat: number, lng: number, polyline: [number, number][]): number {
  let minDist = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const dist = pointToSegmentDistance(lat, lng, polyline[i][0], polyline[i][1], polyline[i + 1][0], polyline[i + 1][1]);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
}

function findCurrentStepIndex(
  lat: number,
  lng: number,
  steps: RouteStep[],
): number {
  let minDist = Infinity;
  let bestIdx = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    for (const wp of step.waypoints) {
      const dist = haversineDistance(lat, lng, wp[0], wp[1]);
      if (dist < minDist) {
        minDist = dist;
        bestIdx = i;
      }
    }
  }
  return bestIdx;
}

function buildInstructionText(step: RouteStep): string {
  if (step.instruction) return step.instruction;
  const lang = i18n.language || 'fr';
  const modifier = step.maneuverModifier || '';
  const street = step.streetName || '';
  const typeMap: Record<string, string> = {
    depart: lang === 'fr' ? 'Départ' : 'Depart',
    turn: lang === 'fr' ? 'Tournez' : 'Turn',
    'new name': lang === 'fr' ? 'Continuez' : 'Continue',
    arrive: lang === 'fr' ? 'Arrivée' : 'Arrive',
    roundabout: lang === 'fr' ? 'Prenez le rond-point' : 'Take the roundabout',
    rotary: lang === 'fr' ? 'Prenez le rond-point' : 'Take the roundabout',
    fork: lang === 'fr' ? 'Tenez la droite' : 'Keep right',
    merge: lang === 'fr' ? 'Rejoignez' : 'Merge',
    'end of road': lang === 'fr' ? 'Au bout de la route' : 'End of road',
    'use lane': lang === 'fr' ? 'Utilisez la voie' : 'Use the lane',
    continue: lang === 'fr' ? 'Continuez tout droit' : 'Continue straight',
    'off ramp': lang === 'fr' ? 'Prenez la sortie' : 'Take the exit',
    'on ramp': lang === 'fr' ? 'Prenez l\'entrée' : 'Take the ramp',
  };
  const typeLabel = typeMap[step.maneuverType || ''] || (lang === 'fr' ? 'Continuez' : 'Continue');
  const modMap: Record<string, string> = {
    left: lang === 'fr' ? 'à gauche' : 'left',
    right: lang === 'fr' ? 'à droite' : 'right',
    straight: lang === 'fr' ? 'tout droit' : 'straight',
    uturn: lang === 'fr' ? 'en U' : 'U-turn',
    slight_left: lang === 'fr' ? 'légèrement à gauche' : 'slightly left',
    slight_right: lang === 'fr' ? 'légèrement à droite' : 'slightly right',
    sharp_left: lang === 'fr' ? 'à gauche' : 'hard left',
    sharp_right: lang === 'fr' ? 'à droite' : 'hard right',
  };
  if (step.maneuverType === 'arrive') return lang === 'fr' ? 'Vous êtes arrivé' : 'You have arrived';
  if (step.maneuverType === 'depart') return `${lang === 'fr' ? 'Départ' : 'Depart'}${street ? ' — ' + street : ''}`;
  const modLabel = modMap[modifier] || '';
  if (street) return `${typeLabel} ${modLabel} sur ${street}`;
  return `${typeLabel} ${modLabel}`;
}

function buildVoiceText(step: RouteStep, distance: number): string {
  const base = buildInstructionText(step);
  const lang = i18n.language || 'fr';
  if (distance > 0 && step.maneuverType !== 'depart' && step.maneuverType !== 'arrive') {
    if (distance > 1000) {
      return lang === 'fr'
        ? `Dans ${(distance / 1000).toFixed(1)} kilomètres, ${base}`
        : `In ${(distance / 1000).toFixed(1)} kilometers, ${base}`;
    }
    return lang === 'fr'
      ? `Dans ${Math.round(distance)} mètres, ${base}`
      : `In ${Math.round(distance)} meters, ${base}`;
  }
  return base;
}

interface NavigationOverlayProps {
  position: { lat: number; lng: number; heading?: number; speed?: number };
  destination: { lat: number; lng: number; label: string };
  routePolyline: [number, number][];
  routeSteps: RouteStep[];
  routingDistance: number;
  routingDuration: number;
  onRecalcRoute: (lat: number, lng: number) => void;
  onExitNavigation: () => void;
  onArrival: () => void;
  isRecalculating?: boolean;
  dataSaver?: boolean;
  onToggleDataSaver?: () => void;
}

export default function NavigationOverlay({
  position,
  destination,
  routePolyline,
  routeSteps,
  routingDistance,
  onRecalcRoute,
  onExitNavigation,
  onArrival,
  isRecalculating,
  dataSaver,
  onToggleDataSaver,
}: NavigationOverlayProps) {
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [deviationDetected, setDeviationDetected] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [muted, setMuted] = useState(false);
  const [networkOk, setNetworkOk] = useState(true);
  const [lastRecalcNotification, setLastRecalcNotification] = useState<string | null>(null);

  const lastSpokenStepRef = useRef(-1);
  const lastDeviationCheckRef = useRef<number>(0);
  const speechRef = useRef<SpeechSynthesisUtterance | null>(null);
  const lastRouteDataRef = useRef<{ polyline: [number, number][]; steps: RouteStep[] }>({ polyline: [], steps: [] });
  const recalcNotificationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (routePolyline.length > 0) {
      lastRouteDataRef.current = { polyline: routePolyline, steps: routeSteps };
    }
  }, [routePolyline, routeSteps]);

  const speak = useCallback((text: string) => {
    if (muted || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getLanguage() === 'fr' ? 'fr-FR' : 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;
    speechRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  }, [muted]);

  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (arrived) return;
    const idx = findCurrentStepIndex(position.lat, position.lng, routeSteps);
    setCurrentStepIdx(idx);

    const currentStep = routeSteps[idx];
    if (currentStep && idx !== lastSpokenStepRef.current) {
      lastSpokenStepRef.current = idx;
      const distToManeuver = idx < routeSteps.length - 1
        ? routeSteps.slice(idx).reduce((sum, s) => sum + s.distance, 0)
        : 0;
      if (distToManeuver <= INSTRUCTION_ANNOUNCE_DISTANCE_M || distToManeuver === 0) {
        const voiceText = buildVoiceText(currentStep, 0);
        speak(voiceText);
      } else {
        const voiceText = buildVoiceText(currentStep, distToManeuver);
        setTimeout(() => speak(voiceText), 500);
      }
    }
  }, [position.lat, position.lng, routeSteps, arrived, speak]);

  useEffect(() => {
    if (arrived || routeSteps.length === 0) return;
    const lastStep = routeSteps[routeSteps.length - 1];
    const distToDest = haversineDistance(position.lat, position.lng, destination.lat, destination.lng);
    if (distToDest <= ARRIVAL_THRESHOLD_M && lastStep.maneuverType === 'arrive') {
      setArrived(true);
      speak(i18n.t('navigation.arrivedAtDestination'));
      onArrival();
    }
  }, [position.lat, position.lng, destination, routeSteps, arrived, speak, onArrival]);

  useEffect(() => {
    if (arrived || routePolyline.length === 0 || !position.speed || position.speed <= 0) return;

    const now = Date.now();
    if (now - lastDeviationCheckRef.current < DEVIATION_CHECK_INTERVAL_MS) return;
    lastDeviationCheckRef.current = now;

    const activePolyline = routePolyline.length > 0 ? routePolyline : lastRouteDataRef.current.polyline;
    const dist = distanceToPolyline(position.lat, position.lng, activePolyline);

    if (dist > DEVIATION_THRESHOLD_M) {
      setDeviationDetected(true);
      setLastRecalcNotification(i18n.t('navigation.deviationBanner'));
      if (recalcNotificationTimeoutRef.current) clearTimeout(recalcNotificationTimeoutRef.current);
      recalcNotificationTimeoutRef.current = setTimeout(() => setLastRecalcNotification(null), 5000);
      onRecalcRoute(position.lat, position.lng);
    } else {
      setDeviationDetected(false);
    }
  }, [position, routePolyline, arrived, onRecalcRoute]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNetworkOk(navigator.onLine);
    }, 10000);
    setNetworkOk(navigator.onLine);
    return () => clearInterval(timer);
  }, []);

  const currentStep = routeSteps[currentStepIdx] || null;
  const instructionText = currentStep ? buildInstructionText(currentStep) : i18n.t('navigation.calculating');
  const distToNextManeuver = currentStep ? currentStep.distance : 0;
  const distToDest = haversineDistance(position.lat, position.lng, destination.lat, destination.lng);
  const remainingDuration = routeSteps.slice(currentStepIdx).reduce((sum, s) => sum + s.duration, 0);
  const remainingHours = Math.floor(remainingDuration / 3600);
  const remainingMinutes = Math.floor((remainingDuration % 3600) / 60);
  const remainingTime = remainingHours > 0 ? `${remainingHours}h ${remainingMinutes}min` : `${remainingMinutes}min`;

  if (arrived) {
    return (
      <div style={{
        position: 'absolute', inset: 0, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--color-overlay, rgba(11,18,32,0.7))',
        backdropFilter: 'blur(12px)',
      }}>
        <div style={{
          textAlign: 'center', color: '#E8ECF3', padding: 40,
          animation: 'dt-fade-in-up 0.4s ease-out',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 'var(--space-lg, 16px)' }}>📍</div>
          <h2 style={{
            fontSize: 'var(--text-2xl, 2rem)', marginBottom: 'var(--space-sm, 8px)',
            color: 'var(--color-teal, #3FA796)',
          }}>
{i18n.t('navigation.arrived')}
          </h2>
          <p style={{
            color: 'var(--color-text-secondary, #9BA6B9)',
            marginBottom: 'var(--space-xl, 24px)',
            fontSize: 'var(--text-md, 1rem)',
          }}>
            {destination.label}
          </p>
          <button
            onClick={onExitNavigation}
            style={{
              padding: '14px 40px',
              background: 'var(--color-teal, #3FA796)',
              color: '#fff', border: 'none',
              borderRadius: 'var(--radius-lg, 8px)',
              cursor: 'pointer',
              fontSize: 'var(--text-md, 1rem)', fontWeight: 600,
              transition: 'background var(--transition-fast, 150ms) ease, transform var(--transition-fast, 150ms) ease',
            }}
          >
            {i18n.t('navigation.finishNavigation')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {!networkOk && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2001,
          background: 'var(--color-red, #E8544C)', color: '#fff', textAlign: 'center',
          padding: '6px', fontSize: 'var(--text-xs, 0.625rem)', fontWeight: 700,
        }}>
          {i18n.t('navigation.networkOffline')}
        </div>
      )}

      {lastRecalcNotification && (
        <div style={{
          position: 'absolute', top: networkOk ? 0 : 22, left: 0, right: 0, zIndex: 2001,
          background: 'var(--color-teal, #3FA796)', color: '#fff', textAlign: 'center',
          padding: '8px 12px', fontSize: 'var(--text-sm, 0.75rem)', fontWeight: 700,
          animation: 'dt-fade-in-up 0.3s ease-out',
        }}>
          🔄 {lastRecalcNotification}
        </div>
      )}

      <div style={{
        position: 'absolute', top: 8, left: 8, right: 8, zIndex: 1000,
        display: 'flex', flexDirection: 'column', gap: 6,
        pointerEvents: 'none',
      }}>
        <div style={{
          background: 'var(--color-glass, rgba(18,27,46,0.92))',
          border: '1px solid var(--color-glass-border, rgba(242,169,60,0.15))',
          borderRadius: 'var(--radius-xl, 12px)',
          padding: 'var(--space-lg, 16px)',
          backdropFilter: 'blur(12px)',
          boxShadow: 'var(--shadow-lg, 0 8px 40px rgba(0,0,0,0.5))',
          pointerEvents: 'auto',
        }}>
          <div style={{
            display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
            marginBottom: 6,
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div key={currentStepIdx} style={{
                fontSize: 'var(--text-lg)', fontWeight: 700, color: '#FFFFFF',
                lineHeight: 1.3, marginBottom: 4,
                animation: 'dt-fade-in-up 0.3s ease-out',
              }}>
                {isRecalculating ? (
                  <span style={{ color: 'var(--color-teal, #3FA796)' }}>{i18n.t('navigation.recalculating')}</span>
                ) : instructionText}
              </div>
              {currentStep && currentStep.streetName && (
                <div style={{ fontSize: 'var(--text-sm, 0.75rem)', color: 'var(--color-text-secondary, #9BA6B9)' }}>
                  {i18n.t('navigation.via', { street: currentStep.streetName })}
                </div>
              )}
            </div>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 12,
            }}>
              <button
                onClick={() => setMuted(!muted)}
                style={{
                  background: 'var(--color-surface-alt, #182339)',
                  border: '1px solid var(--color-border-subtle, rgba(232,236,243,0.08))',
                  borderRadius: 'var(--radius-md, 6px)',
                  padding: '8px 10px', cursor: 'pointer',
                  fontSize: 'var(--text-md, 1rem)',
                  color: muted ? 'var(--color-red, #E8544C)' : 'var(--color-teal, #3FA796)',
                  pointerEvents: 'auto',
                  transition: 'background var(--transition-fast, 150ms) ease, color var(--transition-fast, 150ms) ease',
                }}
                title={muted ? i18n.t('navigation.unmuteTooltip') : i18n.t('navigation.muteTooltip')}
              >
                {muted ? '🔇' : '🔊'}
              </button>
            </div>
          </div>

          {distToNextManeuver > 0 && currentStepIdx < routeSteps.length - 1 && !isRecalculating && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2,
            }}>
              <div style={{
                height: 4, flex: 1, background: 'var(--color-surface-alt, #182339)',
                borderRadius: 2, overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%', width: `${Math.min(100, (routingDistance - distToDest) / routingDistance * 100)}%`,
                  background: 'var(--color-teal, #3FA796)',
                  borderRadius: 2, transition: 'width 0.5s ease',
                }} />
              </div>
              <span style={{ fontSize: 'var(--text-xs, 0.625rem)', color: 'var(--color-text-secondary, #9BA6B9)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                {distToNextManeuver < 1000 ? `${Math.round(distToNextManeuver)} m` : `${(distToNextManeuver / 1000).toFixed(1)} km`}
              </span>
            </div>
          )}
        </div>

        <div style={{
          display: 'flex', gap: 6, pointerEvents: 'auto',
        }}>
          <div style={{
            flex: 1,
            background: 'var(--color-glass, rgba(18,27,46,0.92))',
            border: '1px solid var(--color-glass-border, rgba(242,169,60,0.15))',
            borderRadius: 'var(--radius-lg, 8px)',
            padding: '8px 12px',
            backdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 'var(--text-xs, 0.625rem)',
          }}>
            <span style={{ color: 'var(--color-teal, #3FA796)', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
              🕐 {remainingTime}
            </span>
            <span style={{ color: 'var(--color-text-secondary, #9BA6B9)' }}>
              🛣️ {routingDistance >= 1000 ? `${(routingDistance / 1000).toFixed(1)} km` : `${Math.round(routingDistance)} m`}
            </span>
            <span style={{ color: 'var(--color-text-secondary, #9BA6B9)' }}>
              📍 {distToDest < 1000 ? `${Math.round(distToDest)} m` : `${(distToDest / 1000).toFixed(1)} km`}
            </span>
            {onToggleDataSaver && (
              <button
                onClick={onToggleDataSaver}
                style={{
                  background: 'transparent',
                  border: 'none', cursor: 'pointer',
                  fontSize: 'var(--text-xs, 0.625rem)',
                  color: dataSaver ? 'var(--color-teal, #3FA796)' : 'var(--color-text-secondary, #9BA6B9)',
                  padding: 0, marginLeft: 'auto',
                  fontWeight: dataSaver ? 600 : 400,
                }}
                title={dataSaver ? i18n.t('navigation.dataSaverTooltipOn') : i18n.t('navigation.dataSaverTooltipOff')}
              >
                📶 {dataSaver ? i18n.t('navigation.dataSaverOn') : i18n.t('navigation.dataSaverOff')}
              </button>
            )}
          </div>
          <button
            onClick={onExitNavigation}
            style={{
              background: 'var(--color-red-muted, rgba(232,84,76,0.15))',
              border: '1px solid var(--color-red-muted, rgba(232,84,76,0.15))',
              borderRadius: 'var(--radius-lg, 8px)',
              padding: '8px 14px', cursor: 'pointer',
              color: 'var(--color-red, #E8544C)',
              fontSize: 'var(--text-xs, 0.625rem)', fontWeight: 700,
              whiteSpace: 'nowrap',
              transition: 'background var(--transition-fast, 150ms) ease',
            }}
          >
            {i18n.t('navigation.exitNavigation')}
          </button>
        </div>
      </div>

      {deviationDetected && (
        <div style={{
          position: 'absolute', top: '45%', left: '50%', transform: 'translate(-50%, -50%)',
          zIndex: 1001, pointerEvents: 'none',
          animation: 'dt-fade-in-up 0.4s ease-out',
        }}>
          <div style={{
            background: 'var(--color-red-muted, rgba(232,84,76,0.15))', color: '#fff',
            padding: '10px 24px', borderRadius: 'var(--radius-full, 9999px)',
            fontSize: 'var(--text-sm, 0.75rem)', fontWeight: 700,
            boxShadow: '0 4px 20px rgba(232,84,76,0.4)',
          }}>
            {i18n.t('navigation.deviationDetected')}
          </div>
        </div>
      )}
    </>
  );
}