import { API_BASE_URL } from "../constants";
import {
  Commentary,
  CommentaryResponse,
  CreateCommentaryPayload,
  CreateMatchPayload,
  Match,
  MatchResponse,
  UpdateScorePayload,
} from "../types";

export const fetchMatches = async (limit = 50): Promise<MatchResponse> => {
  try {
    const response = await fetch(`${API_BASE_URL}/matches?limit=${limit}`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    // Propagate error to be handled by the UI layer
    throw error;
  }
};

export const fetchMatchCommentary = async (
  matchId: string | number,
  limit = 100
): Promise<CommentaryResponse> => {
  try {
    const response = await fetch(
      `${API_BASE_URL}/matches/${matchId}/commentary?limit=${limit}`,
      {
        method: "GET",
      }
    );

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    throw error;
  }
};

export const createMatch = async (payload: CreateMatchPayload): Promise<Match> => {
  const response = await fetch(`${API_BASE_URL}/matches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to create match: ${response.status}`);
  }

  return data.data;
};

export const postCommentary = async (
  matchId: string | number,
  payload: CreateCommentaryPayload
): Promise<Commentary> => {
  const response = await fetch(`${API_BASE_URL}/matches/${matchId}/commentary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to post commentary: ${response.status}`);
  }

  return data.data;
};

export const updateScore = async (
  matchId: string | number,
  payload: UpdateScorePayload
): Promise<Match> => {
  const response = await fetch(`${API_BASE_URL}/matches/${matchId}/score`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to update score: ${response.status}`);
  }

  return data.data;
};

export const finishMatch = async (matchId: string | number): Promise<Match> => {
  const response = await fetch(`${API_BASE_URL}/matches/${matchId}/finish`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Failed to finish match: ${response.status}`);
  }

  return data.data;
};
