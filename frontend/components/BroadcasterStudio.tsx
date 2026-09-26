import React, { useEffect, useState } from 'react';
import { CreateMatchForm } from './CreateMatchForm';
import { LiveCommentaryDesk } from './LiveCommentaryDesk';
import { Commentary, Match } from '../types';

interface BroadcasterStudioProps {
  isOpen: boolean;
  onClose: () => void;
  matches: Match[];
  selectedMatchId?: string | number | null;
  onWatchMatch?: (id: string | number) => void;
  onReload?: () => void;
  onMatchUpdated?: (match: Match) => void;
}

export const BroadcasterStudio: React.FC<BroadcasterStudioProps> = ({
  isOpen,
  onClose,
  matches,
  selectedMatchId,
  onWatchMatch,
  onReload,
  onMatchUpdated,
}) => {
  const [activeTab, setActiveTab] = useState<'create' | 'commentary'>('commentary');
  const [targetMatchId, setTargetMatchId] = useState<string | number | undefined>(
    selectedMatchId || (matches.length > 0 ? matches[0].id : undefined)
  );

  // Sync selected match ID from props
  useEffect(() => {
    if (selectedMatchId) {
      setTargetMatchId(selectedMatchId);
    }
  }, [selectedMatchId]);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Listen for Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleMatchCreated = (newMatch: Match) => {
    if (onReload) {
      onReload();
    }
    if (onWatchMatch) {
      onWatchMatch(newMatch.id);
    }
    setTargetMatchId(newMatch.id);
    // Auto-switch to commentary desk so broadcaster can immediately post live events
    setActiveTab('commentary');
  };

  const handleScoreUpdated = (updatedMatch?: Match) => {
    if (updatedMatch && onMatchUpdated) {
      onMatchUpdated(updatedMatch);
    }
    if (onReload) {
      onReload();
    }
  };

  const handleCommentaryPosted = (comment: Commentary) => {
    // If the broadcaster posted commentary to a match they're watching, ensure feed refreshed
    if (onWatchMatch && comment.matchId) {
      onWatchMatch(comment.matchId);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-300"
      />

      <div className="fixed inset-y-0 right-0 max-w-full flex pl-6 sm:pl-10">
        <div className="w-screen max-w-xl bg-white border-l-4 border-black flex flex-col shadow-2xl relative">
          
          {/* Drawer Header */}
          <div className="p-5 bg-brand-yellow border-b-2 border-black flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🎙️</span>
              <div>
                <h2 className="text-lg md:text-xl font-black text-brand-dark leading-tight">
                  Broadcaster Studio
                </h2>
                <p className="text-xs font-semibold text-gray-700">
                  Live match creation & commentary desk
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-9 h-9 rounded-xl border-2 border-black bg-white hover:bg-gray-100 flex items-center justify-center font-black text-base shadow-hard-sm active:translate-y-0.5 cursor-pointer transition-all"
              aria-label="Close studio drawer"
            >
              ✕
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b-2 border-black bg-gray-50 p-2 gap-2">
            <button
              onClick={() => setActiveTab('commentary')}
              className={`
                flex-1 py-2 px-3 rounded-xl text-xs md:text-sm font-bold border-2 border-black transition-all cursor-pointer text-center
                ${
                  activeTab === 'commentary'
                    ? 'bg-brand-blue text-black shadow-hard-sm'
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }
              `}
            >
              🎙️ Live Desk & Scores
            </button>
            <button
              onClick={() => setActiveTab('create')}
              className={`
                flex-1 py-2 px-3 rounded-xl text-xs md:text-sm font-bold border-2 border-black transition-all cursor-pointer text-center
                ${
                  activeTab === 'create'
                    ? 'bg-brand-blue text-black shadow-hard-sm'
                    : 'bg-white text-gray-600 hover:bg-gray-100'
                }
              `}
            >
              ➕ Create New Match
            </button>
          </div>

          {/* Drawer Content */}
          <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
            {activeTab === 'commentary' ? (
              <LiveCommentaryDesk
                matches={matches}
                selectedMatchId={targetMatchId}
                onSelectMatch={(id) => {
                  setTargetMatchId(id);
                  if (onWatchMatch) onWatchMatch(id);
                }}
                onCommentaryPosted={handleCommentaryPosted}
                onScoreUpdated={handleScoreUpdated}
                onRequestCreateTab={() => setActiveTab('create')}
              />
            ) : (
              <CreateMatchForm
                onMatchCreated={handleMatchCreated}
                onCancel={() => setActiveTab('commentary')}
              />
            )}
          </div>

          {/* Drawer Footer Status */}
          <div className="p-3 bg-gray-100 border-t-2 border-black flex items-center justify-between text-xs text-gray-600 font-mono">
            <span>Real-time WebSocket Producer</span>
            <span className="bg-white px-2 py-0.5 rounded border border-gray-300 font-bold">
              Sub-50ms Fanout
            </span>
          </div>

        </div>
      </div>
    </div>
  );
};
