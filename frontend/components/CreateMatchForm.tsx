import React, { useState } from 'react';
import { createMatch } from '../services/api';
import { Match } from '../types';
import { addMyMatchId } from '../utils/matchStorage';

interface CreateMatchFormProps {
  onMatchCreated: (newMatch: Match) => void;
  onCancel?: () => void;
}

const PRESET_SPORTS = [
  { id: 'football', label: 'Football', icon: '⚽' },
  { id: 'basketball', label: 'Basketball', icon: '🏀' },
  { id: 'cricket', label: 'Cricket', icon: '🏏' },
  { id: 'tennis', label: 'Tennis', icon: '🎾' },
  { id: 'baseball', label: 'Baseball', icon: '⚾' },
  { id: 'custom', label: 'Custom', icon: '🏆' },
];

const toLocalDateTimeInput = (date: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${y}-${m}-${d}T${h}:${min}`;
};

export const CreateMatchForm: React.FC<CreateMatchFormProps> = ({
  onMatchCreated,
  onCancel,
}) => {
  const now = new Date();
  const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const [selectedSport, setSelectedSport] = useState('football');
  const [customSport, setCustomSport] = useState('');
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const [homeScore, setHomeScore] = useState(0);
  const [awayScore, setAwayScore] = useState(0);
  const [startTime, setStartTime] = useState(toLocalDateTimeInput(now));
  const [endTime, setEndTime] = useState(toLocalDateTimeInput(twoHoursLater));

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const resetForm = () => {
    const freshNow = new Date();
    const freshEnd = new Date(freshNow.getTime() + 2 * 60 * 60 * 1000);
    setHomeTeam('');
    setAwayTeam('');
    setHomeScore(0);
    setAwayScore(0);
    setCustomSport('');
    setSelectedSport('football');
    setStartTime(toLocalDateTimeInput(freshNow));
    setEndTime(toLocalDateTimeInput(freshEnd));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    // Validation
    const resolvedSport = selectedSport === 'custom' ? customSport.trim().toLowerCase() : selectedSport;
    if (!resolvedSport) {
      setError('Please specify a sport.');
      return;
    }

    if (!homeTeam.trim()) {
      setError('Home team name is required.');
      return;
    }

    if (!awayTeam.trim()) {
      setError('Away team name is required.');
      return;
    }

    if (startTime && endTime) {
      const startParsed = new Date(startTime);
      const endParsed = new Date(endTime);
      if (endParsed <= startParsed) {
        setError('End time must be chronologically after start time.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        sport: resolvedSport,
        homeTeam: homeTeam.trim(),
        awayTeam: awayTeam.trim(),
        homeScore: Math.max(0, homeScore),
        awayScore: Math.max(0, awayScore),
        source: 'studio',
        startTime: startTime ? new Date(startTime).toISOString() : undefined,
        endTime: endTime ? new Date(endTime).toISOString() : undefined,
      };

      const created = await createMatch(payload);
      addMyMatchId(created.id);
      setSuccessMsg(`Match "${created.homeTeam} vs ${created.awayTeam}" created!`);
      resetForm();
      onMatchCreated(created);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create match';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Alert Banners */}
      {error && (
        <div className="p-3 bg-red-100 border-2 border-red-500 rounded-xl text-red-900 text-xs font-bold shadow-sm">
          ⚠️ {error}
        </div>
      )}

      {successMsg && (
        <div className="p-3 bg-green-100 border-2 border-green-600 rounded-xl text-green-900 text-xs font-bold shadow-sm">
          ✅ {successMsg}
        </div>
      )}

      {/* Sport Selector Chips */}
      <div>
        <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-2">
          Sport
        </label>
        <div className="flex flex-wrap gap-2">
          {PRESET_SPORTS.map((s) => {
            const isSelected = selectedSport === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSelectedSport(s.id)}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border-2 border-black transition-all cursor-pointer
                  ${
                    isSelected
                      ? 'bg-brand-yellow text-black shadow-hard-sm translate-x-[-1px] translate-y-[-1px]'
                      : 'bg-white text-gray-700 hover:bg-gray-100 shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]'
                  }
                `}
              >
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </button>
            );
          })}
        </div>

        {selectedSport === 'custom' && (
          <div className="mt-2.5">
            <input
              type="text"
              placeholder="Enter sport name (e.g. rugby, handball)..."
              value={customSport}
              onChange={(e) => setCustomSport(e.target.value)}
              className="w-full px-3 py-2 border-2 border-black rounded-xl bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
              required
            />
          </div>
        )}
      </div>

      {/* Teams Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
            Home Team *
          </label>
          <input
            type="text"
            placeholder="e.g. Real Madrid"
            value={homeTeam}
            onChange={(e) => setHomeTeam(e.target.value)}
            className="w-full px-3 py-2 border-2 border-black rounded-xl bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
            Away Team *
          </label>
          <input
            type="text"
            placeholder="e.g. Barcelona"
            value={awayTeam}
            onChange={(e) => setAwayTeam(e.target.value)}
            className="w-full px-3 py-2 border-2 border-black rounded-xl bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
            required
          />
        </div>
      </div>

      {/* Initial Scores */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
            Initial Home Score
          </label>
          <input
            type="number"
            min="0"
            value={homeScore}
            onChange={(e) => setHomeScore(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-full px-3 py-2 border-2 border-black rounded-xl bg-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
            Initial Away Score
          </label>
          <input
            type="number"
            min="0"
            value={awayScore}
            onChange={(e) => setAwayScore(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-full px-3 py-2 border-2 border-black rounded-xl bg-white text-sm font-bold focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
          />
        </div>
      </div>

      {/* Schedule / Times */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
            Start Time
          </label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full px-3 py-2 border-2 border-black rounded-xl bg-white text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
          />
        </div>

        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 mb-1">
            End Time (Approx.)
          </label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full px-3 py-2 border-2 border-black rounded-xl bg-white text-xs md:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-brand-yellow shadow-[1px_1px_0px_0px_rgba(0,0,0,1)]"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="px-4 py-2 rounded-xl text-xs md:text-sm font-bold border-2 border-black bg-white hover:bg-gray-100 transition-all cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={isSubmitting}
          className={`
            px-6 py-2.5 rounded-xl text-xs md:text-sm font-bold border-2 border-black transition-all cursor-pointer shadow-hard-sm
            ${
              isSubmitting
                ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                : 'bg-brand-yellow text-black hover:bg-yellow-300 active:translate-y-0.5'
            }
          `}
        >
          {isSubmitting ? 'Creating Match...' : '🚀 Create & Publish Match'}
        </button>
      </div>
    </form>
  );
};
