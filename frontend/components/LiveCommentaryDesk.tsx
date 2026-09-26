import React, { useEffect, useRef, useState } from 'react';
import { finishMatch, postCommentary, updateScore } from '../services/api';
import { Commentary, Match } from '../types';
import { getMyMatchIds } from '../utils/matchStorage';

interface LiveCommentaryDeskProps {
  matches: Match[];
  selectedMatchId?: string | number | null;
  onSelectMatch?: (matchId: string | number) => void;
  onCommentaryPosted?: (commentary: Commentary) => void;
  onScoreUpdated?: (match: Match) => void;
  onRequestCreateTab?: () => void;
}

const EVENT_CHIPS = [
  { id: 'goal', label: 'Goal', icon: '⚽' },
  { id: 'card', label: 'Yellow Card', icon: '🟨' },
  { id: 'red_card', label: 'Red Card', icon: '🟥' },
  { id: 'shot', label: 'Shot on Target', icon: '🎯' },
  { id: 'substitution', label: 'Substitution', icon: '🔄' },
  { id: 'whistle', label: 'Whistle', icon: '⏱️' },
];

export const LiveCommentaryDesk: React.FC<LiveCommentaryDeskProps> = ({
  matches,
  selectedMatchId,
  onSelectMatch,
  onCommentaryPosted,
  onScoreUpdated,
  onRequestCreateTab,
}) => {
  const [creatorFilter, setCreatorFilter] = useState<'mine' | 'all'>('all');
  const [myMatchIds, setMyMatchIds] = useState<Set<string>>(() => getMyMatchIds());

  // Listen to match creation events in this browser session
  useEffect(() => {
    const updateIds = () => {
      setMyMatchIds(getMyMatchIds());
    };
    window.addEventListener('my_studio_matches_updated', updateIds);
    window.addEventListener('storage', updateIds);
    return () => {
      window.removeEventListener('my_studio_matches_updated', updateIds);
      window.removeEventListener('storage', updateIds);
    };
  }, []);

  const [currentMatchId, setCurrentMatchId] = useState<string | number | ''>(
    selectedMatchId || (matches.length > 0 ? matches[0].id : '')
  );

  const activeMatch = matches.find((m) => String(m.id) === String(currentMatchId));
  const isFinished = (activeMatch?.status || '').toLowerCase() === 'finished';
  const isOwnedByMe = activeMatch ? myMatchIds.has(String(activeMatch.id)) : false;
  const canControlScores = isOwnedByMe || (activeMatch?.source === 'studio');

  const [isConfirmingEnd, setIsConfirmingEnd] = useState(false);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
      }
    };
  }, []);

  // Filter lists
  const myCreatedMatches = matches.filter((m) => myMatchIds.has(String(m.id)));
  const visibleMatches = creatorFilter === 'mine' ? myCreatedMatches : matches;

  // Group matches for data provenance
  const studioMatches = matches.filter((m) => (m.source || '').toLowerCase() === 'studio');
  const apiMatches = matches.filter((m) => (m.source || '').toLowerCase() !== 'studio');

  // Auto-switch selected match when switching creatorFilter if current is not visible
  useEffect(() => {
    if (creatorFilter === 'mine') {
      if (myCreatedMatches.length > 0) {
        const isCurrentVisible = myCreatedMatches.some((m) => String(m.id) === String(currentMatchId));
        if (!isCurrentVisible) {
          handleMatchChange(String(myCreatedMatches[0].id));
        }
      } else {
        setCurrentMatchId('');
      }
    } else {
      if (matches.length > 0 && !currentMatchId) {
        handleMatchChange(String(matches[0].id));
      }
    }
  }, [creatorFilter, myCreatedMatches.length, matches.length]);

  // Score Stepper State
  const [homeScore, setHomeScore] = useState<number>(0);
  const [awayScore, setAwayScore] = useState<number>(0);
  const [isUpdatingScore, setIsUpdatingScore] = useState(false);
  const [isEndingMatch, setIsEndingMatch] = useState(false);

  // Commentary Form State
  const [minute, setMinute] = useState<number>(1);
  const [selectedEventType, setSelectedEventType] = useState<string>('goal');
  const [selectedTeamSide, setSelectedTeamSide] = useState<'home' | 'away' | 'neutral'>('home');
  const [actor, setActor] = useState('');
  const [message, setMessage] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successBadge, setSuccessBadge] = useState<string | null>(null);

  // Sync selected match ID from parent props
  useEffect(() => {
    if (selectedMatchId) {
      setCurrentMatchId(selectedMatchId);
    }
  }, [selectedMatchId]);

  // Sync score and calculate approximate minute whenever active match changes
  useEffect(() => {
    if (activeMatch) {
      setHomeScore(activeMatch.homeScore);
      setAwayScore(activeMatch.awayScore);

      if (activeMatch.startTime) {
        const elapsed = Math.floor((Date.now() - new Date(activeMatch.startTime).getTime()) / 60000);
        if (elapsed > 0 && elapsed <= 120) {
          setMinute(elapsed);
        } else {
          setMinute(45);
        }
      }
    }
  }, [activeMatch?.id, activeMatch?.homeScore, activeMatch?.awayScore, activeMatch?.startTime]);

  const showSuccessNotice = (text: string) => {
    setSuccessBadge(text);
    setTimeout(() => {
      setSuccessBadge(null);
    }, 2500);
  };

  const handleMatchChange = (id: string) => {
    setCurrentMatchId(id);
    if (onSelectMatch) {
      onSelectMatch(id);
    }
    setError(null);
  };

  // Score Update Handler
  const handleScoreUpdateSubmit = async () => {
    if (!activeMatch || isFinished) return;
    setIsUpdatingScore(true);
    setError(null);
    try {
      const updated = await updateScore(activeMatch.id, {
        homeScore,
        awayScore,
      });
      showSuccessNotice(`Score updated to ${homeScore} - ${awayScore}`);
      if (onScoreUpdated) {
        onScoreUpdated(updated);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update score';
      setError(msg);
    } finally {
      setIsUpdatingScore(false);
    }
  };

  // Final Whistle / End Match Handler
  const handleEndMatch = async () => {
    if (!activeMatch || isFinished) return;

    // Step 1: Prompt inline confirmation
    if (!isConfirmingEnd) {
      setIsConfirmingEnd(true);
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
      }
      confirmTimeoutRef.current = setTimeout(() => {
        setIsConfirmingEnd(false);
      }, 4000);
      return;
    }

    // Step 2: Confirmed - execute final whistle
    if (confirmTimeoutRef.current) {
      clearTimeout(confirmTimeoutRef.current);
    }
    setIsConfirmingEnd(false);
    setIsEndingMatch(true);
    setError(null);
    try {
      const updated = await finishMatch(activeMatch.id);
      showSuccessNotice('🏁 Match concluded! Scores and commentary are now locked.');
      if (onScoreUpdated) {
        onScoreUpdated(updated);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to finish match';
      setError(msg);
    } finally {
      setIsEndingMatch(false);
    }
  };

  // Custom Commentary Submit
  const handleCommentarySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeMatch) {
      setError('Please select a match first.');
      return;
    }
    if (isFinished) {
      setError('This match has ended. Commentary is locked.');
      return;
    }
    if (!message.trim()) {
      setError('Please enter commentary text.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const teamName =
      selectedTeamSide === 'home'
        ? activeMatch.homeTeam
        : selectedTeamSide === 'away'
          ? activeMatch.awayTeam
          : undefined;

    try {
      const created = await postCommentary(activeMatch.id, {
        message: message.trim(),
        minute: Number(minute) || undefined,
        eventType: selectedEventType || undefined,
        team: teamName,
        actor: actor.trim() || undefined,
        tags: [selectedEventType, activeMatch.sport],
      });

      setMessage('');
      setActor('');
      showSuccessNotice('Commentary published live!');
      if (onCommentaryPosted) {
        onCommentaryPosted(created);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to post commentary';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quick Action Presets
  const handleQuickGoal = async (side: 'home' | 'away') => {
    if (!activeMatch || isFinished) return;
    const scoringTeam = side === 'home' ? activeMatch.homeTeam : activeMatch.awayTeam;
    const nextHome = side === 'home' ? homeScore + 1 : homeScore;
    const nextAway = side === 'away' ? awayScore + 1 : awayScore;

    setHomeScore(nextHome);
    setAwayScore(nextAway);
    setIsSubmitting(true);
    setError(null);

    try {
      // 1. Post Commentary
      const comment = await postCommentary(activeMatch.id, {
        message: `GOAL! ${scoringTeam} strikes! Tremendous finish to find the back of the net!`,
        minute,
        eventType: 'goal',
        team: scoringTeam,
        tags: ['goal', activeMatch.sport],
      });

      // 2. Update Score
      const updated = await updateScore(activeMatch.id, {
        homeScore: nextHome,
        awayScore: nextAway,
      });

      showSuccessNotice(`Goal recorded for ${scoringTeam}! (${nextHome} - ${nextAway})`);
      if (onCommentaryPosted) onCommentaryPosted(comment);
      if (onScoreUpdated) onScoreUpdated(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Quick goal failed';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickCard = async () => {
    if (!activeMatch || isFinished) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const comment = await postCommentary(activeMatch.id, {
        message: `Yellow card issued following a mistimed challenge in the midfield.`,
        minute,
        eventType: 'card',
        tags: ['card', 'foul'],
      });
      showSuccessNotice('Yellow card commentary posted!');
      if (onCommentaryPosted) onCommentaryPosted(comment);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Quick card failed';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alert Notices */}
      {error && (
        <div className="p-3 bg-red-100 border-2 border-red-500 rounded-xl text-red-900 text-xs font-bold shadow-sm">
          ⚠️ {error}
        </div>
      )}

      {successBadge && (
        <div className="p-3 bg-green-100 border-2 border-green-600 rounded-xl text-green-900 text-xs font-bold shadow-sm flex items-center gap-2">
          <span>✅</span>
          <span>{successBadge}</span>
        </div>
      )}

      {/* Match Ownership / Creator Filter Toggle */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
          Match Filter
        </label>
        <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 border-2 border-black rounded-xl">
          <button
            type="button"
            onClick={() => setCreatorFilter('mine')}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${creatorFilter === 'mine'
              ? 'bg-brand-yellow text-black border-2 border-black shadow-hard-sm'
              : 'text-gray-600 hover:text-black border-2 border-transparent'
              }`}
          >
            <span>👤 My Created Matches</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-black border border-black ${creatorFilter === 'mine' ? 'bg-white text-black' : 'bg-gray-200 text-gray-700'
                }`}
            >
              {myCreatedMatches.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setCreatorFilter('all')}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${creatorFilter === 'all'
              ? 'bg-brand-yellow text-black border-2 border-black shadow-hard-sm'
              : 'text-gray-600 hover:text-black border-2 border-transparent'
              }`}
          >
            <span>🌐 All Matches</span>
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-black border border-black ${creatorFilter === 'all' ? 'bg-white text-black' : 'bg-gray-200 text-gray-700'
                }`}
            >
              {matches.length}
            </span>
          </button>
        </div>
      </div>

      {/* Match Selector Dropdown with Data Provenance optgroups */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
          Select Target Match
        </label>
        <select
          value={currentMatchId}
          onChange={(e) => handleMatchChange(e.target.value)}
          className="w-full px-3 py-2.5 border-2 border-black rounded-xl bg-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-hard-sm cursor-pointer"
        >
          {creatorFilter === 'mine' ? (
            myCreatedMatches.length === 0 ? (
              <option value="">No matches created in this session</option>
            ) : (
              myCreatedMatches.map((m) => (
                <option key={m.id} value={m.id}>
                  👑 [{m.sport.toUpperCase()}] {m.homeTeam} vs {m.awayTeam} ({m.status.toUpperCase()} · {m.homeScore}-{m.awayScore})
                </option>
              ))
            )
          ) : matches.length === 0 ? (
            <option value="">No matches available</option>
          ) : (
            <>
              {studioMatches.length > 0 && (
                <optgroup label="🎙️ Studio & Custom Matches (Editable)">
                  {studioMatches.map((m) => {
                    const isMine = myMatchIds.has(String(m.id));
                    return (
                      <option key={m.id} value={m.id}>
                        {isMine ? '👑 [YOURS] ' : '🎙️ '}[{m.sport.toUpperCase()}] {m.homeTeam} vs {m.awayTeam} ({m.status.toUpperCase()} · {m.homeScore}-{m.awayScore})
                      </option>
                    );
                  })}
                </optgroup>
              )}
              {apiMatches.length > 0 && (
                <optgroup label="🌐 Official API Fixtures (Protected)">
                  {apiMatches.map((m) => (
                    <option key={m.id} value={m.id}>
                      [{m.sport.toUpperCase()}] {m.homeTeam} vs {m.awayTeam} ({m.status.toUpperCase()} · {m.homeScore}-{m.awayScore})
                    </option>
                  ))}
                </optgroup>
              )}
            </>
          )}
        </select>

        {creatorFilter === 'mine' && myCreatedMatches.length === 0 && (
          <div className="mt-3 p-4 bg-yellow-50 border-2 border-black rounded-xl text-center space-y-2">
            <p className="text-xs font-bold text-gray-800">
              👤 You haven't created any matches in this browser session yet.
            </p>
            <p className="text-[11px] text-gray-600">
              Create a custom match in the Studio to broadcast commentary and adjust scores with full ownership.
            </p>
            {onRequestCreateTab && (
              <button
                type="button"
                onClick={onRequestCreateTab}
                className="px-3.5 py-1.5 bg-brand-yellow border-2 border-black rounded-xl text-xs font-bold shadow-hard-sm hover:bg-yellow-300 transition-all cursor-pointer"
              >
                ➕ Create Match Now
              </button>
            )}
          </div>
        )}
      </div>

      {!activeMatch ? (
        <div className="p-8 text-center border-2 border-dashed border-gray-300 rounded-xl">
          <p className="text-gray-500 text-sm font-medium">
            Please select or create a match to start broadcasting commentary and adjusting scores.
          </p>
        </div>
      ) : (
        <>
          {/* Guard 1: Status Lock Banner when Finished */}
          {isFinished && (
            <div className="p-3.5 bg-gray-100 border-2 border-black rounded-xl text-gray-800 text-xs font-bold shadow-sm flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🔒</span>
                <span>Match Finished — Score & Commentary Locked</span>
              </div>
              <span className="px-2 py-0.5 bg-white border border-black rounded font-mono text-[10px] uppercase font-bold text-gray-600">
                Archived
              </span>
            </div>
          )}

          {/* Quick Actions Preset Bar */}
          <div className="bg-brand-blue border-2 border-black rounded-xl p-4 shadow-hard-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-gray-800">
                ⚡ 1-Click Fast Actions
              </span>
              {!isOwnedByMe && !isFinished && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-black bg-white text-gray-700">
                  ℹ️ Goals restricted to creator
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleQuickGoal('home')}
                disabled={isFinished || !isOwnedByMe || isSubmitting}
                title={!isOwnedByMe ? 'Score updates are restricted to the match creator' : undefined}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-yellow-100 border-2 border-black rounded-lg text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>⚽</span>
                <span className="truncate">Goal {activeMatch.homeTeam} (+1)</span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickGoal('away')}
                disabled={isFinished || !isOwnedByMe || isSubmitting}
                title={!isOwnedByMe ? 'Score updates are restricted to the match creator' : undefined}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-yellow-100 border-2 border-black rounded-lg text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>⚽</span>
                <span className="truncate">Goal {activeMatch.awayTeam} (+1)</span>
              </button>

              <button
                type="button"
                onClick={handleQuickCard}
                disabled={isFinished || isSubmitting}
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white hover:bg-yellow-100 border-2 border-black rounded-lg text-xs font-bold shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>🟨</span>
                <span>Yellow Card</span>
              </button>
            </div>
          </div>

          {/* Live Score Stepper & End Match Controls */}
          <div className="bg-white border-2 border-black rounded-xl p-4 shadow-hard-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                  Score Stepper
                </span>
                {isFinished ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-black bg-gray-200 text-gray-700">
                    🔒 Finished (Locked)
                  </span>
                ) : isOwnedByMe ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-black bg-amber-100 text-amber-900 flex items-center gap-1">
                    <span>👑</span>
                    <span>Your Match (Editable)</span>
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-black bg-blue-50 text-blue-800">
                    👁️ Read-Only Scores
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* End Match Button - restricted to creator */}
                {!isFinished && isOwnedByMe && (
                  <button
                    type="button"
                    onClick={handleEndMatch}
                    disabled={isEndingMatch}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold border-2 border-black bg-red-100 hover:bg-red-200 text-red-900 transition-all cursor-pointer shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] active:translate-y-0.5"
                    title="End match and post final whistle commentary"
                  >
                    {isEndingMatch ? 'Ending...' : '🏁 End Match'}
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleScoreUpdateSubmit}
                  disabled={!isOwnedByMe || isFinished || isUpdatingScore || (homeScore === activeMatch.homeScore && awayScore === activeMatch.awayScore)}
                  className={`
                    px-3 py-1 rounded-lg text-xs font-bold border-2 border-black transition-all cursor-pointer
                    ${isOwnedByMe && !isFinished && (homeScore !== activeMatch.homeScore || awayScore !== activeMatch.awayScore)
                      ? 'bg-brand-yellow text-black hover:bg-yellow-300 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]'
                      : 'bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed'
                    }
                  `}
                >
                  {isUpdatingScore ? 'Updating...' : 'Save Score'}
                </button>
              </div>
            </div>

            {/* Ownership Warning Banner when not owned */}
            {!isOwnedByMe && !isFinished && (
              <div className="mb-3 p-2.5 bg-blue-50 border border-blue-300 rounded-lg text-[11px] font-semibold text-blue-900 flex items-center gap-2">
                <span>🔒</span>
                <span>
                  Live score adjustments and final whistle are restricted to the match creator in this browser session.
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              {/* Home Team Stepper */}
              <div className="border border-black rounded-lg p-2.5 bg-gray-50 flex items-center justify-between">
                <span className="text-xs font-bold truncate max-w-[100px]">{activeMatch.homeTeam}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isFinished || !canControlScores}
                    onClick={() => setHomeScore((s) => Math.max(0, s - 1))}
                    className="w-7 h-7 bg-white border border-black rounded font-bold hover:bg-gray-100 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-base w-6 text-center">{homeScore}</span>
                  <button
                    type="button"
                    disabled={isFinished || !canControlScores}
                    onClick={() => setHomeScore((s) => s + 1)}
                    className="w-7 h-7 bg-white border border-black rounded font-bold hover:bg-gray-100 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Away Team Stepper */}
              <div className="border border-black rounded-lg p-2.5 bg-gray-50 flex items-center justify-between">
                <span className="text-xs font-bold truncate max-w-[100px]">{activeMatch.awayTeam}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isFinished || !canControlScores}
                    onClick={() => setAwayScore((s) => Math.max(0, s - 1))}
                    className="w-7 h-7 bg-white border border-black rounded font-bold hover:bg-gray-100 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    -
                  </button>
                  <span className="font-mono font-bold text-base w-6 text-center">{awayScore}</span>
                  <button
                    type="button"
                    disabled={isFinished || !canControlScores}
                    onClick={() => setAwayScore((s) => s + 1)}
                    className="w-7 h-7 bg-white border border-black rounded font-bold hover:bg-gray-100 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Custom Commentary Publisher Form */}
          <form onSubmit={handleCommentarySubmit} className="space-y-4">
            {/* Event Type Chips */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1.5">
                Event Type
              </label>
              <div className="flex flex-wrap gap-1.5">
                {EVENT_CHIPS.map((chip) => {
                  const isSelected = selectedEventType === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      disabled={isFinished}
                      onClick={() => {
                        setSelectedEventType(chip.id);
                        if (!message) {
                          if (chip.id === 'goal') setMessage(`GOAL! Superb finish by ${activeMatch.homeTeam}!`);
                          if (chip.id === 'card') setMessage('Yellow card shown for persistent fouls.');
                          if (chip.id === 'red_card') setMessage('RED CARD! Player sent off for a dangerous tackle!');
                          if (chip.id === 'shot') setMessage('Great strike saved by the goalkeeper!');
                          if (chip.id === 'substitution') setMessage('Tactical change being made.');
                          if (chip.id === 'whistle') setMessage('Referee blows the whistle.');
                        }
                      }}
                      className={`
                        flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border-2 border-black transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
                        ${isSelected
                          ? 'bg-brand-yellow text-black shadow-hard-sm translate-x-[-1px] translate-y-[-1px]'
                          : 'bg-white text-gray-700 hover:bg-gray-100 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]'
                        }
                      `}
                    >
                      <span>{chip.icon}</span>
                      <span>{chip.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Minute & Team Alignment */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Match Minute
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="150"
                    disabled={isFinished}
                    value={minute}
                    onChange={(e) => setMinute(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-24 px-3 py-1.5 border-2 border-black rounded-xl bg-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] disabled:bg-gray-100 disabled:cursor-not-allowed"
                  />
                  <span className="text-xs text-gray-500 font-medium">Minutes played</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                  Associated Team
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isFinished}
                    onClick={() => setSelectedTeamSide('home')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg border border-black truncate max-w-[110px] disabled:opacity-50 ${selectedTeamSide === 'home' ? 'bg-brand-yellow' : 'bg-gray-100'
                      }`}
                  >
                    {activeMatch.homeTeam}
                  </button>
                  <button
                    type="button"
                    disabled={isFinished}
                    onClick={() => setSelectedTeamSide('away')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg border border-black truncate max-w-[110px] disabled:opacity-50 ${selectedTeamSide === 'away' ? 'bg-brand-yellow' : 'bg-gray-100'
                      }`}
                  >
                    {activeMatch.awayTeam}
                  </button>
                  <button
                    type="button"
                    disabled={isFinished}
                    onClick={() => setSelectedTeamSide('neutral')}
                    className={`px-2.5 py-1 text-xs font-bold rounded-lg border border-black disabled:opacity-50 ${selectedTeamSide === 'neutral' ? 'bg-brand-yellow' : 'bg-gray-100'
                      }`}
                  >
                    Neutral
                  </button>
                </div>
              </div>
            </div>

            {/* Optional Player / Actor */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                Player / Official (Optional)
              </label>
              <input
                type="text"
                disabled={isFinished}
                placeholder="e.g. Vinicius Jr., K. De Bruyne, Referee"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                className="w-full px-3 py-1.5 border-2 border-black rounded-xl bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>

            {/* Message Textarea */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
                Live Commentary Message *
              </label>
              <textarea
                rows={3}
                disabled={isFinished}
                placeholder={isFinished ? 'Match has concluded. Commentary is locked.' : 'Type real-time event commentary...'}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full px-3 py-2 border-2 border-black rounded-xl bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)] disabled:bg-gray-100 disabled:cursor-not-allowed"
                required
              />
            </div>

            {/* Submit Action */}
            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={isFinished || isSubmitting || !message.trim()}
                className={`
                  px-6 py-2.5 rounded-xl text-xs md:text-sm font-bold border-2 border-black transition-all cursor-pointer shadow-hard-sm
                  ${isFinished || isSubmitting || !message.trim()
                    ? 'bg-gray-200 text-gray-400 border-gray-300 cursor-not-allowed'
                    : 'bg-brand-yellow text-black hover:bg-yellow-300 active:translate-y-0.5'
                  }
                `}
              >
                {isSubmitting ? 'Broadcasting...' : isFinished ? '🔒 Locked' : '🎙️ Broadcast Live Commentary'}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
};
