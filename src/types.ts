export type Bindings = {
  OSHI_SHORT_URLS: KVNamespace;
  ADMIN_EMAILS: string;
  DEV_AUTH_EMAIL?: string;
};

export type MappingStatus = 'pending' | 'approved' | 'disabled' | 'rejected';

export interface Mapping {
  slug: string;
  url: string;
  title: string;
  description: string;
  photo: string;
  author: string;
  contact: string;
  notes: string;
  listed: boolean;
  status: MappingStatus;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
}

export interface SubmitBody {
  url: string;
  title: string;
  slug?: string;
  description?: string;
  photo?: string;
  author?: string;
  contact?: string;
  notes?: string;
  listed?: string;
}
