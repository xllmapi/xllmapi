export interface MeProfile {
  id: string;
  email: string;
  displayName: string;
  handle: string;
  role: "user" | "admin";
  inviteStatus: "active";
  avatarUrl?: string | null;
  phone?: string | null;
  hasPassword?: boolean;
}

export interface InvitationStats {
  limit: number | null;
  used: number;
  remaining: number | null;
  unlimited: boolean;
}
