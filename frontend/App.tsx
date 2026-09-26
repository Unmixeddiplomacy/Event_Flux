import React, { useEffect, useMemo, useState } from 'react';
import { useMatchData } from './hooks/useMatchData';
import { MatchCard } from './components/MatchCard';
import { LiveFeed } from './components/LiveFeed';
import { StatusIndicator } from './components/StatusIndicator';
import { BroadcasterStudio } from './components/BroadcasterStudio';

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

const App: React.FC = () => {
  const pageSize = 6;
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedSport, setSelectedSport] = useState<string>('all');
  const [isStudioOpen, setIsStudioOpen] = useState(false);

  const {
    matches,
    isLoading,
    error,
    commentary,
    isCommentaryLoading,
    wsError,
    status,
    activeMatchId,
    newMatchesCount,
    dismissNewMatches,
    watchMatch,
    unwatchMatch,
    reloadMatches,
    updateMatchLocally,
  } = useMatchData();

  // Dynamically extract available sports with match counts
  const sportsList = useMemo(() => {
    const sportCounts = new Map<string, number>();
    matches.forEach((m) => {
      const s = (m.sport || 'other').toLowerCase();
      sportCounts.set(s, (sportCounts.get(s) || 0) + 1);
    });

    const sports = Array.from(sportCounts.entries()).map(([sport, count]) => ({
      key: sport,
      label: sport.charAt(0).toUpperCase() + sport.slice(1),
      count,
      icon: getSportIcon(sport),
    }));

    return [
      { key: 'all', label: 'All Sports', count: matches.length, icon: '⚡' },
      ...sports,
    ];
  }, [matches]);

  // Filter matches by selected sport
  const filteredMatches = useMemo(() => {
    if (selectedSport === 'all') return matches;
    return matches.filter(
      (m) => (m.sport || '').toLowerCase() === selectedSport.toLowerCase()
    );
  }, [matches, selectedSport]);

  const totalPages = Math.max(1, Math.ceil(filteredMatches.length / pageSize));

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const pagedMatches = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return filteredMatches.slice(startIndex, startIndex + pageSize);
  }, [filteredMatches, currentPage, pageSize]);

  const handleSportSelect = (sportKey: string) => {
    setSelectedSport(sportKey);
    setCurrentPage(1);
  };

  return (
    <div className="min-h-screen p-4 md:p-8 font-sans">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-brand-yellow border-2 border-black rounded-2xl p-6 shadow-hard">
          <div>
            <h1 className="text-3xl font-black tracking-tight text-brand-dark mb-1">
              Event_Flux
            </h1>
            <p className="text-sm font-medium opacity-80">Real-time match data & live commentary</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setIsStudioOpen(true)}
              className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs md:text-sm font-bold border-2 border-black bg-white hover:bg-yellow-100 shadow-hard-sm active:translate-y-0.5 cursor-pointer transition-all"
            >
              <span>🎙️</span>
              <span>Broadcaster Studio</span>
            </button>
            <div className="flex flex-col items-end gap-2">
              <StatusIndicator status={status} />
              {wsError && (
                <span className="text-xs font-mono bg-red-100 text-red-700 border border-red-200 px-2 py-1 rounded">
                  WS: {wsError}
                </span>
              )}
            </div>
          </div>
        </header>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Match List */}
          <main className="lg:col-span-2 space-y-6">
            
            {/* Header & Match Count */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-xl font-bold border-l-4 border-brand-blue pl-3">Current Matches</h2>
              <span className="text-xs font-mono bg-black text-white px-2.5 py-1 rounded-md self-start sm:self-auto">
                {isLoading ? 'Loading...' : `${filteredMatches.length} Matches`}
              </span>
            </div>

            {/* Sports Filter Bar */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {sportsList.map((sport) => {
                const isSelected = selectedSport === sport.key;
                return (
                  <button
                    key={sport.key}
                    onClick={() => handleSportSelect(sport.key)}
                    className={`
                      flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs md:text-sm font-bold border-2 border-black whitespace-nowrap transition-all cursor-pointer
                      ${
                        isSelected
                          ? 'bg-brand-yellow text-black shadow-hard-sm translate-x-[-1px] translate-y-[-1px]'
                          : 'bg-white text-gray-700 hover:bg-gray-100 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]'
                      }
                    `}
                  >
                    <span>{sport.icon}</span>
                    <span>{sport.label}</span>
                    <span
                      className={`text-[11px] px-1.5 py-0.2 rounded-full border border-black font-semibold ${
                        isSelected ? 'bg-white text-black' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {sport.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* New Matches Alert */}
            {newMatchesCount > 0 && (
              <div className="flex items-center justify-between gap-3 bg-brand-yellow border-2 border-black rounded-xl px-4 py-3 shadow-hard-sm">
                <span className="text-sm font-bold">
                  {newMatchesCount} new match{newMatchesCount > 1 ? 'es' : ''} added
                </span>
                <button
                  onClick={dismissNewMatches}
                  className="px-3 py-1 rounded-full text-xs font-bold border-2 border-black bg-white hover:bg-gray-50 transition-all cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Loading Indicator */}
            {isLoading && (
              <div className="p-12 text-center border-2 border-dashed border-gray-300 rounded-2xl">
                <div className="animate-spin w-8 h-8 border-4 border-brand-yellow border-t-black rounded-full mx-auto mb-4"></div>
                <p className="font-medium text-gray-500">Loading matches...</p>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border-2 border-red-500 text-red-900 p-6 rounded-xl text-center shadow-sm">
                <div className="flex justify-center mb-3 text-red-500">
                  <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold mb-1">Connection Error</h3>
                <p className="font-mono text-sm bg-red-100 py-1 px-2 rounded inline-block mb-4 border border-red-200">{error}</p>
                <p className="text-sm opacity-80 mb-6 max-w-md mx-auto">
                  The application could not reach the API. Please ensure the API server is online and accessible.
                </p>
                <button 
                  onClick={reloadMatches}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold text-sm transition-all shadow-md active:translate-y-0.5 cursor-pointer"
                >
                  Retry Connection
                </button>
              </div>
            )}

            {/* Empty Matches State */}
            {!isLoading && !error && filteredMatches.length === 0 && (
              <div className="p-12 text-center border-2 border-black rounded-2xl bg-gray-50">
                <p className="font-bold text-lg mb-1">No matches found</p>
                <p className="text-sm text-gray-500 mb-4">
                  {selectedSport !== 'all'
                    ? `No current or upcoming matches found for ${selectedSport}.`
                    : 'No matches are currently available.'}
                </p>
                {selectedSport !== 'all' && (
                  <button
                    onClick={() => handleSportSelect('all')}
                    className="px-4 py-2 bg-brand-yellow text-black border-2 border-black rounded-xl font-bold text-xs shadow-hard-sm hover:bg-yellow-300 transition-all cursor-pointer"
                  >
                    View All Sports
                  </button>
                )}
              </div>
            )}

            {/* Matches Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pagedMatches.map((match) => (
                <MatchCard 
                  key={match.id} 
                  match={match} 
                  // eslint-disable-next-line eqeqeq
                  isActive={activeMatchId == match.id}
                  onWatch={watchMatch}
                  onUnwatch={unwatchMatch}
                />
              ))}
            </div>

            {/* Pagination */}
            {!isLoading && !error && filteredMatches.length > pageSize && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <span className="text-xs font-medium text-gray-500">
                  Page {currentPage} of {totalPages}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className={`
                      px-3 py-1.5 rounded-lg text-xs font-bold border-2 border-black transition-all cursor-pointer
                      ${currentPage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-gray-50'}
                    `}
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className={`
                      px-3 py-1.5 rounded-lg text-xs font-bold border-2 border-black transition-all cursor-pointer
                      ${currentPage === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-gray-50'}
                    `}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </main>

          {/* Right Column: Live Feed (Sticky on Desktop) */}
          <aside className="lg:col-span-1 h-[500px] lg:h-[calc(100vh-140px)] lg:sticky lg:top-8">
            <LiveFeed messages={commentary} isActive={!!activeMatchId} isLoading={isCommentaryLoading} />
          </aside>
        </div>

        {/* Broadcaster Studio Slide-Over Drawer */}
        <BroadcasterStudio
          isOpen={isStudioOpen}
          onClose={() => setIsStudioOpen(false)}
          matches={matches}
          selectedMatchId={activeMatchId}
          onWatchMatch={watchMatch}
          onReload={reloadMatches}
          onMatchUpdated={updateMatchLocally}
        />
      </div>
    </div>
  );
};

export default App;
