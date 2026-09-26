import React, { useEffect, useRef, useState } from 'react';
import { Match } from '../types';
import { isMyMatch } from '../utils/matchStorage';

interface MatchCardProps {
  match: Match;
  isActive: boolean;
  onWatch: (id: string | number) => void;
  onUnwatch: (id: string | number) => void;
}

const getSportIcon = (sport?: string) => {
  switch (sport?.toLowerCase()) {
    case 'football':
    case 'soccer':
      return '⚽';
    case 'cricket':
      return '🏏';
    case 'basketball':
      return '🏀';
    case 'tennis':
      return '🎾';
    case 'rugby':
      return '🏉';
    case 'baseball':
      return '⚾';
    default:
      return '🏆';
  }
};

export const MatchCard: React.FC<MatchCardProps> = ({ match, isActive, onWatch, onUnwatch }) => {
  // Handle case-insensitive status check from API
  const statusLower = match.status.toLowerCase();
  const isLive = statusLower === 'live';
  const [homePulse, setHomePulse] = useState(false);
  const [awayPulse, setAwayPulse] = useState(false);
  const [isOwned, setIsOwned] = useState(() => isMyMatch(match.id));
  const prevScoreRef = useRef({ home: match.homeScore, away: match.awayScore });
  const pulseTimeoutRef = useRef<{ home?: ReturnType<typeof setTimeout>; away?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    setIsOwned(isMyMatch(match.id));
    const handleUpdate = () => setIsOwned(isMyMatch(match.id));
    window.addEventListener('my_studio_matches_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('my_studio_matches_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, [match.id]);
  
  const actionLabel = (() => {
    if (isLive) {
      return isActive ? 'Watching Live' : 'Watch Live';
    }
    if (statusLower === 'finished') {
      return isActive ? 'Viewing Recap' : 'View Recap';
    }
    return isActive ? 'Viewing Match' : 'View Match';
  })();

  useEffect(() => {
    const prevScore = prevScoreRef.current;
    const homeChanged = prevScore.home !== match.homeScore;
    const awayChanged = prevScore.away !== match.awayScore;

    if (homeChanged) {
      setHomePulse(true);
      if (pulseTimeoutRef.current.home) {
        clearTimeout(pulseTimeoutRef.current.home);
      }
      pulseTimeoutRef.current.home = setTimeout(() => {
        setHomePulse(false);
      }, 900);
    }

    if (awayChanged) {
      setAwayPulse(true);
      if (pulseTimeoutRef.current.away) {
        clearTimeout(pulseTimeoutRef.current.away);
      }
      pulseTimeoutRef.current.away = setTimeout(() => {
        setAwayPulse(false);
      }, 900);
    }

    prevScoreRef.current = { home: match.homeScore, away: match.awayScore };

    return () => {
      if (pulseTimeoutRef.current.home) {
        clearTimeout(pulseTimeoutRef.current.home);
      }
      if (pulseTimeoutRef.current.away) {
        clearTimeout(pulseTimeoutRef.current.away);
      }
    };
  }, [match.homeScore, match.awayScore]);
  
  // Format status for display (Capitalize first letter)
  const displayStatus = match.status.charAt(0).toUpperCase() + match.status.slice(1).toLowerCase();

  return (
    <div className={`
      relative p-5 rounded-2xl border-2 border-black bg-white transition-all duration-200
      ${isActive ? 'shadow-hard translate-x-[-2px] translate-y-[-2px] ring-2 ring-brand-yellow ring-offset-2' : 'hover:shadow-hard-sm'}
    `}>
      {/* Header: Sport, Provenance & Status */}
      <div className="flex justify-between items-start mb-4 gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-gray-700 bg-gray-50 border border-black rounded-full px-2.5 py-0.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
            <span>{getSportIcon(match.sport)}</span>
            <span>{match.sport}</span>
          </span>
          {match.source === 'studio' ? (
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-900 bg-purple-100 border border-black rounded-full px-2 py-0.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              🎙️ Studio Match
            </span>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-wider text-blue-900 bg-blue-50 border border-black rounded-full px-2 py-0.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]">
              🌐 Official API
            </span>
          )}
          {isOwned && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-900 bg-amber-100 border border-black rounded-full px-2 py-0.5 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] flex items-center gap-1">
              <span>👑</span>
              <span>Your Match</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLive && (
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 border border-black"></span>
            </span>
          )}
          <span className={`text-sm font-medium ${isLive ? 'text-red-600' : 'text-gray-600'}`}>
            {displayStatus}
          </span>
        </div>
      </div>

      {/* Teams & Score */}
      <div className="flex flex-col gap-3 mb-6">
        <div className="flex justify-between items-center">
          <span className="font-bold text-lg text-brand-dark line-clamp-1">{match.homeTeam}</span>
          <span
            className={`
              font-bold text-2xl border border-black rounded-lg px-3 py-1 min-w-[3rem] text-center transition-colors
              ${homePulse ? 'bg-brand-yellow animate-pulse' : 'bg-gray-100'}
            `}
          >
            {match.homeScore}
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="font-bold text-lg text-brand-dark line-clamp-1">{match.awayTeam}</span>
          <span
            className={`
              font-bold text-2xl border border-black rounded-lg px-3 py-1 min-w-[3rem] text-center transition-colors
              ${awayPulse ? 'bg-brand-yellow animate-pulse' : 'bg-gray-100'}
            `}
          >
            {match.awayScore}
          </span>
        </div>
      </div>

      {/* Footer: Action */}
      <div className="flex items-center justify-between mt-auto pt-4 border-t-2 border-gray-100 border-dashed">
        <span className="text-xs text-gray-500 font-medium">
          {new Date(match.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onWatch(match.id)}
            disabled={isActive}
            className={`
              px-4 py-2 rounded-full font-bold text-sm border-2 border-black transition-all
              ${isActive 
                ? 'bg-brand-blue text-black cursor-default opacity-100' 
                : 'bg-brand-yellow text-black hover:bg-yellow-300 active:translate-y-0.5'
              }
            `}
          >
            {actionLabel}
          </button>
          {isActive && (
            <button
              onClick={() => onUnwatch(match.id)}
              className="px-3 py-2 rounded-full font-bold text-xs border-2 border-black bg-white hover:bg-gray-50 transition-all"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
