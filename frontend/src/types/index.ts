export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface Sender {
  id: string;
  email: string;
  displayName?: string;
}

export interface Campaign {
  id: string;
  subject: string;
  body: string;
  startAt: string;
  delaySeconds: number;
  hourlyLimit: number;
  totalCount: number;
  createdAt: string;
}

export interface Job {
  id: string;
  recipient: string;
  status: 'PENDING' | 'SCHEDULED' | 'PROCESSING' | 'SENT' | 'FAILED';
  scheduledAt: string;
  sentAt?: string;
  failedAt?: string;
  errorMessage?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}
