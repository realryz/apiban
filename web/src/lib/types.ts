export type BanStatus = 'active' | 'expired' | 'revoked';

export type Ban = {
  id: number;
  player_name: string;
  identifiers: string[];
  reason: string;
  banned_by: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  revoked_by: string | null;
  status: BanStatus;
};

export type Player = {
  id: number;
  name: string;
  identifiers: string[];
};

export type UserKey = {
  id: number;
  name: string;
  discord_id: string;
  discord_name: string;
  created_at: number;
  last_used_at: number | null;
};

export type Players = { online: boolean; last_heartbeat: number | null; players: Player[] };
export type BanList = { bans: Ban[]; total: number };
export type BanResult = { message: string; ban: Ban };
